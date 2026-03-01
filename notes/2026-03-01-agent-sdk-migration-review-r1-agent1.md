# Architect Review — Agent SDK Migration Plan (Round 1)

Reviewed: `plans/agent-sdk-migration.md`
Reviewer focus: Architecture, migration path, state management, race conditions, WebSocket bridge integrity

---

## Critical Issues

### C1. Missing `hasSession()` from plan's API surface — breaks `send_input` deferred spawn logic

**Section:** Step 1 (Rewrite `server/session.ts`)

The plan lists four exported functions: `spawnSession`, `sendInput`, `killSession`, and `consumeQuery` (internal). It does not mention `hasSession()`.

`index.ts` imports and calls `hasSession(nodeId)` in the `send_input` handler (line 241, 253) to determine whether to do a deferred spawn or forward input to an existing session. Without `hasSession()`, the deferred spawn path (interactive mode, where no prompt is provided at node creation) is broken — the server either always spawns a new session or always tries to send to a non-existent one.

**Impact:** Interactive (no-prompt) sessions cannot work. First user message either crashes or gets silently dropped.

**Fix:** Add `hasSession(nodeId): boolean` to the Step 1 API. It's a one-liner (`return sessions.has(nodeId)`), but it must be explicitly part of the contract since Agent B and Agent C both depend on it.

---

### C2. Missing `killAllSessions()` — breaks graceful shutdown

**Section:** Step 1 (Rewrite `server/session.ts`) / Step 3 (Update `server/index.ts`)

The plan lists `killSession(nodeId)` but not `killAllSessions()`. `index.ts` lines 425/432 call `killAllSessions()` in both the SIGTERM and SIGINT handlers. Without it, graceful shutdown leaves SDK sessions (and their child processes) running.

**Impact:** Server restart or Ctrl+C leaves orphaned Claude processes consuming resources. In development with `--watch`, this compounds on every file change.

**Fix:** Add `killAllSessions()` to Step 1's API. With the SDK, this means iterating all sessions and calling `abortController.abort()` + `channel.close()` on each. Also need to consider whether `query.close()` is sufficient for cleanup or if the abort controller is the primary mechanism — this determines the implementation of both `killSession` and `killAllSessions`.

---

### C3. Session lifecycle race between `consumeQuery` completion and `killSession`

**Section:** Step 1 — `consumeQuery` and `killSession` descriptions

The plan says `consumeQuery` "on completion: delete session" and `killSession` also deletes the session (via `channel.close()` / `query.close()`). This creates a race:

1. User calls `killSession(nodeId)` → aborts controller, closes channel, closes query
2. Concurrently, `consumeQuery` catches the abort/close → tries to delete session and set node state

This mirrors an existing race in the current codebase (the `proc.exited` handler vs `killSession` both delete from `sessions` and touch node state), but the plan doesn't acknowledge or address it for the new architecture. With the SDK, the abort propagation path may be different — `consumeQuery`'s `for await` loop will throw on abort, hitting the error path which "sets node crashed." A killed session should not be marked as crashed.

**Impact:** Killing a running session marks the node as "crashed" instead of cleaning up silently. Users see false error states on intentionally terminated sessions.

**Fix:** `consumeQuery` must distinguish abort errors from real errors. Check `abortController.signal.aborted` before setting crashed state. Current code has a partial guard for this (line 141: `if (node.nodeState !== 'completed')`) but the plan drops this safeguard without replacement.

---

## Must-fix Issues

### M1. `tool_use` and `tool_result` events missing from SDK message type mapping

**Section:** Step 2 — Message type mapping table

The current `stream-parser.ts` handles six event types: `assistant`, `content_block_delta`, `tool_use`, `tool_result`, `result`, `error`, plus several suppressed types. The plan's message type mapping table in Step 2 only lists: `system`, `assistant`, `stream_event (content_block_delta)`, `result (success)`, `result (error)`, and "Others (ignore)."

`tool_use` events drive three critical behaviors:
1. **File overlap tracking** (`trackFileEdit` for Edit/Write tools) — without this, parallel sessions silently overwrite each other's files
2. **Stage transitions** (planning → executing → testing) — UI shows wrong status
3. **AskUserQuestion detection** — without this, the human-needed flag never sets, and the node just sits with no indication that user input is required

`tool_result` events drive terminal output (showing truncated tool output).

The plan's "Preserve" bullet mentions "file overlap tracking, stage transitions" but the mapping table has no entry for the events that carry this data. Agent B implementing to the mapping table will miss these.

**Impact:** Parallel agents will silently conflict on files. Nodes will never transition past "planning" stage. User questions from Claude will never surface in the UI.

**Fix:** Add explicit `tool_use` and `tool_result` rows to the message type mapping table with their SDK equivalents. The SDK may represent these as sub-events within `assistant` messages (tool_use blocks in `message.content[]`) or as separate message types — this needs to be specified so Agent B knows where to look.

---

### M2. Cost tracking model unspecified — risk of double-counting or zero-counting

**Section:** Step 2 (message type mapping) and Risks section (risk #3)

The plan acknowledges in Risks that `total_cost_usd` "might be cumulative across turns" but doesn't specify a solution in the message-processor design. The current code accumulates cost per `result` event (line 272: `costUsd: node.costUsd + costUsd`), treating each result as a delta.

If the SDK's cost is cumulative across the entire conversation (not per-turn), this accumulation pattern will double-count costs. If it's per-query-call (and there's only one query call per session), the `result` event may only fire once at session end, so mid-session cost tracking won't exist.

**Impact:** Cost display is either wildly inflated (double-counting) or zero until session ends (no intermediate updates). Neither matches user expectations.

**Fix:** Specify the cost tracking strategy in the plan. Two options:
- If SDK costs are cumulative: store last-seen cost, compute delta on each result event
- If SDK costs are per-turn: accumulate as-is (current pattern)
Add a validation step in Step 2's "Preserve" section to log and verify cost values during initial testing.

---

### M3. `nodeState: 'running'` transition missing from `spawnSession`

**Section:** Step 1 — `spawnSession` description

Current `spawnSession` (line 112-115) explicitly sets `nodeState: 'running'` and broadcasts the update after spawning the process. The plan's Step 1 description of `spawnSession` says it "creates MessageChannel, pushes initial prompt, calls query(), starts consumeQuery()" but does not mention the state transition.

If `consumeQuery` starts processing and broadcasts terminal data before the node transitions to `running`, the UI will show terminal output for a node that's still in `idle` state. The deferred spawn path in `index.ts` also relies on state being set to `running` to visually indicate the session started.

**Impact:** Nodes appear stuck in `idle` state while actually running. UI indicators break.

**Fix:** Add explicit `updateNode(nodeId, { nodeState: 'running' })` + `broadcast` to `spawnSession` description in Step 1, before calling `consumeQuery`.

---

### M4. Plan does not account for `clearHumanNeeded` on stream activity (idle auto-clear)

**Section:** Step 2 — missing from message-processor design

Current `stream-parser.ts` (lines 172-175) clears the `idle` human-needed flag whenever any stream event arrives. This is critical: if a session is flagged as idle (no activity for 2 minutes) but then resumes activity, the idle flag should automatically clear. The plan's message-processor design doesn't mention this behavior.

Without it, a session that pauses for 2 minutes and then resumes will stay in `needs-human` state with an `idle` badge forever, even though it's actively working.

**Impact:** Nodes falsely remain in `needs-human` state after resuming activity.

**Fix:** Add to Step 2's design: "On any message received, if the node's `humanNeededType` is `'idle'`, call `clearHumanNeeded(nodeId)`."

---

### M5. Parallel agent boundary creates integration risk between session.ts and message-processor.ts

**Section:** Execution Strategy — Bucket 1

Agent A builds `session.ts` with `consumeQuery` calling `processMessage()`. Agent B builds `message-processor.ts` defining `processMessage()`. But the contract between them is underspecified:

1. **What type is `processMessage`'s parameter?** The plan says `SDKMessage` but this is a placeholder — the actual SDK type name and import path aren't specified. If Agent A and Agent B assume different type names, they'll produce incompatible code.
2. **What does `createMessageProcessor` return?** The plan says `{ processMessage(msg: SDKMessage), cleanup() }`. Agent A needs to know this exact interface to call it correctly in `consumeQuery`. The `cleanup()` function is new (doesn't exist in current stream-parser) — what should it clean up? Just the idle timer?
3. **Who owns the idle timer?** The plan puts it in message-processor (Step 2: "Preserve: idle timeout"), but `consumeQuery` in session.ts also needs to know about cleanup on session end. If cleanup is only called from `consumeQuery`, it needs to be in the contract.

**Impact:** Agent A and Agent B produce code that doesn't compile together. Agent C spends its entire budget on integration debugging instead of testing.

**Fix:** Add an explicit interface contract section between Steps 1 and 2:
```typescript
// Contract between session.ts and message-processor.ts
interface MessageProcessor {
  processMessage(msg: <exact SDK type>): void;
  cleanup(): void;  // Clears idle timer, releases resources
}
```
Specify the exact SDK import and message type that both agents should use.

---

## Medium Issues

- **Step 2 mapping table references `stream_event (content_block_delta)` as a wrapper type.** The SDK may emit `content_block_delta` directly (not wrapped in a `stream_event` envelope). Verify against SDK docs during implementation.

- **`sendInput` message format differs from current.** Plan says push `{ type: 'user', message: { role: 'user', content: text } }`. Current code sends `{ type: 'user_message', content: text }`. The SDK format may be neither — verify against SDK's MessageChannel expected input shape.

- **No mention of what happens to stderr.** Current code drains stderr from the CLI process and broadcasts it to the terminal. The SDK may surface errors through the async generator instead of stderr. If stderr still exists (SDK spawns a subprocess internally), it's swallowed silently. Plan says to remove `drainStderr` but doesn't specify how diagnostic output reaches the terminal.

- **Step 3 claims "everything else stays the same" but `cleanupStaleProcesses()` removal also affects the top-level `await` at index.ts line 305.** This is a module-level side effect that runs before server.start. If removed, verify no other startup logic depends on it completing first.

- **`settingSources: ['user', 'project', 'local']` in the plan's query options** — these values need validation against the actual SDK API. If the SDK doesn't accept a `settingSources` option or uses different enum values, the session will fail to start or use wrong settings.

---

## Low Issues

- **Step 4 says "keep `server/cli-paths.ts`"** but only `CLAUDE_BIN` is used by `context-summary.ts` and `GH_BIN` by `pr-tracker.ts`. With the SDK migration, `CLAUDE_BIN` is no longer imported by session.ts — this is fine but worth noting that `cli-paths.ts` becomes a utility only for non-session uses.

- **Verification step 4 ("Send a follow-up message → verify context maintained")** doesn't specify what "context maintained" means observably. Suggest: "Claude references information from the first message in its second response."

- **The plan doesn't mention updating the `Session` interface type.** Currently it holds `{ process: Subprocess, nodeId, interactive }`. The new version needs `{ channel: MessageChannel, abortController: AbortController, query: AsyncGenerator, nodeId }`. Minor, but worth specifying so the sessions Map type is clear.

- **No rollback strategy mentioned.** If the SDK doesn't work under Bun (Risk #2), what's the fallback? Keep the old session.ts on a branch? The plan would benefit from noting that the current code should be preserved in git history (which it naturally is, but stating rollback = git revert makes it explicit).

---

## Impl-notes

### Message shape validation
- SDK message content block structure (text blocks, tool_use blocks, etc.) needs runtime validation initially — add debug logging in `processMessage` for unrecognized shapes
- The `assistant` message may contain mixed content blocks (text + tool_use interleaved); ensure iteration handles all block types, not just the first

### Multi-turn state
- MessageChannel's backpressure behavior when the SDK isn't pulling: if the user pushes multiple messages rapidly via WebSocket while the SDK is processing, does the channel queue them? Unbounded queue could be a memory issue for long sessions
- What happens if `sendInput` is called after `consumeQuery` has finished (session completed)? Need a guard — the channel may already be closed

### AbortController lifecycle
- Does `abortController.abort()` propagate through the SDK's internal subprocess? If the SDK spawns claude CLI internally, verify that aborting actually kills the child process and doesn't leave orphans
- Test: spawn session, abort, check for lingering claude processes with `pgrep`

### Error classification
- SDK may throw different error types for rate limits vs. actual failures. The plan maps both to "set crashed" but rate limits should probably set human-needed with a "rate limited, will retry" message instead

### Bun compatibility specifics
- AsyncIterable/AsyncGenerator protocol differences between Node and Bun
- SDK may use Node-specific APIs (child_process, fs) that have subtle Bun incompatibilities
- Test with `bun --bun` flag to force Bun's native modules vs. Node compatibility shims

### Idle timer edge case
- If the SDK batches messages (sends multiple messages in rapid succession), the idle timer resets on each one, which is correct. But if the SDK has internal processing pauses > 2 minutes (e.g., waiting for Claude API response during a very long tool execution), the idle timer will fire falsely. May need to extend the timeout or only start it after receiving a `result` event.

### Terminal output fidelity
- Current code pushes tool names, truncated tool results, and text to terminal lines. The SDK may change the order or grouping of these messages. Verify that terminal output still reads coherently (e.g., "[Tool: Edit]" appears before "[Result: Edit]")
