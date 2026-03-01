# Review R2: Get Terminal Connected to Claude CLI

**Reviewer:** CLI/Terminal Integration Specialist (Agent 2)
**Date:** 2026-02-28
**Plan file:** `notes/2026-02-28-terminal-claude-connection.md` (rev 2)
**Prior review:** `notes/2026-02-28-terminal-claude-connection-review-r1-agent2.md`

---

## R1 Issue Resolution Status

| R1 # | R1 Severity | Finding | Status in Rev 2 |
|-------|-------------|---------|------------------|
| 1 | Low | Bug 1 (containerRef) already fixed | **Fixed** -- removed from plan entirely; replaced with the real missing flag (`--include-partial-messages`) |
| 2 | Must-fix | One-shot sessions silently discard stdin | **Fixed** -- now Bug 3 in rev 2 with three fix options clearly laid out |
| 3 | Medium | `--verbose` may produce non-JSON stdout | **Not addressed** -- see Finding 1 below |
| 4 | Must-fix | Missing `--input-format stream-json` on one-shot | **Fixed** -- folded into Bug 3 / Step 3 as option 1 (recommended) |
| 5 | Must-fix | Plan used wrong field names (`type`/`allow` vs `kind`/`granted`) | **Fixed** -- the rev 2 plan no longer documents the WS payload schema inline, so there's no stale field-name documentation to conflict with the code |
| 6 | Impl-note | Race between `result` and `proc.exited` | Impl-note; not expected in plan. Still valid during implementation |
| 7 | Impl-note | Per-character deltas cause high-frequency renders | Impl-note; not expected in plan. Still valid during implementation |
| 8 | Impl-note | Idle timer cleared before exit code checked | Impl-note; not expected in plan. Still valid during implementation |
| 9 | Low | Smoke test for `needs-human` unrealistic with `--dangerously-skip-permissions` | **Not addressed** -- see Finding 5 below |
| 10 | Low | Multiple event types hit noisy `default` case | **Partially addressed** -- Bug 6 now covers `model_usage_metrics` specifically, but the broader set of Anthropic streaming protocol events (`content_block_start`, `content_block_stop`, `message_start`, `message_stop`, `message_delta`) still fall through to the default case. See Finding 4 |

**Summary:** The three Must-fix issues (2, 4, 5) are all resolved. The stale Bug 1 (Low) is resolved. Two items (Medium #3 and Low #9) were not addressed. One (Low #10) was partially addressed.

---

## New Findings in Rev 2

### 1. `--verbose` flag still present in spawn args -- may produce non-JSON stdout

**Severity:** Medium
**Section:** Bug 1 / Step 1 (spawn args)

This was raised as R1 Finding #3 and remains unaddressed. The actual `session.ts:62` includes `--verbose` in the args array:

```ts
const args = [CLAUDE_BIN, '-p', '--verbose', '--output-format', 'stream-json', '--dangerously-skip-permissions'];
```

The plan's rev 2 adds `--include-partial-messages` to these args (correct), but does not mention `--verbose` at all. The `--verbose` flag can cause Claude CLI to emit diagnostic/lifecycle messages to stdout that are not valid JSON. The stream parser's `parseStreamLine` will return `null` for non-JSON lines, silently dropping them, which is fine in isolation. However, there is a real risk if a verbose diagnostic line arrives in the same TCP chunk as a JSON event and the newline-splitting logic receives a partial JSON line fused with verbose text. The current buffer-based line splitter in `pipeFrom` handles this correctly for newline-delimited output, but `--verbose` may emit lines that don't end with `\n` or that interleave with JSON on the same line.

The plan should either:
- Explicitly state that `--verbose` is intentionally included and has been verified to produce separate lines
- Or recommend removing `--verbose` (since stderr already captures diagnostic output, and the stream parser handles all event types)

This is the same risk identified in R1, reiterated because it wasn't addressed and could cause intermittent stream corruption that's difficult to debug.

---

### 2. `--include-partial-messages` flag validity needs verification

**Severity:** Medium
**Section:** Bug 1 / Step 1

The plan treats `--include-partial-messages` as the critical missing flag, and the entire streaming architecture depends on it. However, the plan does not include a verification step for this flag specifically. Step 5 verifies that interactive `-p` mode works, but doesn't isolate whether `--include-partial-messages` is the correct flag name for Claude CLI.

Claude CLI flags evolve across versions. If the flag name is wrong (e.g., it's actually `--stream-deltas`, `--emit-partial`, or integrated into `--output-format stream-json` by default), the spawn will either fail silently (flag ignored) or error out. The plan labels this as "Critical" but doesn't include a way to validate that the flag exists before building the rest of the pipeline around it.

**Suggested fix:** Add a verification substep to Step 1: run `claude --help` or `claude -p --help` and confirm `--include-partial-messages` appears in the output. If it doesn't, check `claude -p --output-format stream-json --help` or consult the CLI documentation. This takes 30 seconds and prevents building on a wrong assumption.

**Why this is plan-level:** If the flag doesn't exist or has a different name, Steps 1, 5, and 7 all need revision, and the core streaming architecture assumption is invalid.

---

### 3. `send_input` handler doesn't call `clearHumanNeeded` -- Bug 2 fix is specified but not reflected in the files-to-modify table completely

**Severity:** Low
**Section:** Bug 2 / Step 2 / Files to Modify

The plan correctly specifies the fix: remove `clearHumanNeeded()` from `processEvent` in `stream-parser.ts`, and add it to the `send_input` handler in `server/index.ts`. The Files to Modify table at the bottom also reflects both files. This is internally consistent.

However, looking at the actual `send_input` handler in `server/index.ts:226-239`, the handler dispatches to `sendInput()` from `session.ts` based on `payload.kind`, but `sendInput()` in `session.ts` has no concept of `clearHumanNeeded` -- it just writes to stdin. The plan's Step 2 says to add `clearHumanNeeded()` to the `send_input` handler in `index.ts`, which is correct. But `clearHumanNeeded` is a closure inside `createStreamParser` in `stream-parser.ts` -- it's not exported or accessible from `index.ts`.

To call `clearHumanNeeded` from `index.ts`, one of these must happen:
- Export `clearHumanNeeded` from the stream parser (breaks encapsulation, and each parser instance has its own closure)
- Move the human-needed state management to `state.ts` where it's accessible from both modules
- Have `index.ts` directly call `updateNode` to clear the human-needed fields (duplicating logic)

The plan doesn't address this API boundary. During implementation, the developer will discover that `clearHumanNeeded` can't simply be called from `index.ts` without restructuring.

**Suggested fix:** Specify in Step 2 that clearing human-needed state from `index.ts` should be done via `updateNode(nodeId, { needsHuman: false, nodeState: 'running', humanNeededType: null, humanNeededPayload: null })` directly, or by exporting a `clearHumanNeeded(nodeId)` function from `state.ts`. This is a small change but the plan should name the approach to avoid confusion.

**Why this is plan-level:** The fix as written implies calling a function that isn't accessible. The implementer needs to know the approach upfront, otherwise they'll spend time figuring out the right module boundary.

---

### 4. Noisy event suppression (Bug 6) should use an allowlist, not individual cases

**Severity:** Low
**Section:** Bug 6 / Step 6

The plan identifies `model_usage_metrics` as noisy, but the real issue is broader. Claude CLI's `--output-format stream-json` with `--include-partial-messages` will emit the full Anthropic streaming protocol, which includes:

- `message_start`
- `content_block_start`
- `content_block_delta` (handled)
- `content_block_stop`
- `message_delta`
- `message_stop`
- `model_usage_metrics`

Of these, only `content_block_delta` and `assistant` carry displayable content. The current `default` case stringifies all unknown events into the terminal, which means `message_start`, `content_block_start`, `content_block_stop`, `message_delta`, and `message_stop` will all produce noise like:

```
[message_start] {"type":"message_start","message":{"id":"msg_...","type":"message"...}}
```

The plan's Step 6 says "add cases for `model_usage_metrics` and any other noisy event types." The "and any other" is vague. The implementation should either:
- Add explicit silent cases for all known Anthropic protocol events
- Or invert the default: only broadcast to terminal for event types in an explicit display-worthy set (`assistant`, `content_block_delta`, `tool_use`, `tool_result`, `result`, `error`), and silently ignore everything else

The second approach is more resilient to new event types being added to the protocol.

R1 Finding #10 raised this same point. The rev 2 plan partially addressed it by adding Bug 6 for `model_usage_metrics` specifically, but didn't adopt the broader allowlist approach.

---

### 5. Smoke test Step 7.8 remains unrealistic

**Severity:** Low
**Section:** Step 7, item 8

R1 Finding #9 noted that testing `needs-human` state is difficult with `--dangerously-skip-permissions` on all sessions. The rev 2 plan's Step 7.8 still says:

> Test input during a `needs-human` state (when Claude asks a question) -- confirm the question state persists until user responds

With `--dangerously-skip-permissions`, Claude will auto-approve all tool use and is unlikely to emit `AskUserQuestion`. This smoke test step will either be skipped or produce false confidence. The plan should note how to actually trigger this state for testing, or flag it as "defer to supervised-mode implementation."

---

### 6. Terminal buffer replay (Bug 4 / Step 4) -- no `terminal_replay` message type in `ServerMessage`

**Severity:** Must-fix
**Section:** Bug 4 / Step 4

The plan says to replay buffered lines when a client subscribes, either as "a batch of `terminal_output` messages" or "a single `terminal_replay` message." Looking at the actual `ServerMessage` union type in `shared/types.ts:74-81`, there is no `terminal_replay` variant -- only `terminal_data`. The plan's Step 4 mentions adding a `terminal_replay` message type as an option but doesn't commit to one approach.

More importantly, the `subscribe_terminal` handler in `server/index.ts:186-189` currently just calls `subscribeTerminal(msg.nodeId, ws)` which only adds the WebSocket to a subscription set. The server-side terminal buffer exists in `state.ts` (`terminalBuffers` map with `getTerminalLines()`), but the subscribe handler doesn't use it.

The fix is straightforward -- call `getTerminalLines(nodeId)` in the subscribe handler and send the result as a `terminal_data` message to the subscribing client (not broadcast). But the plan should specify:

1. That replay should use the existing `terminal_data` message type (not invent a new one) to avoid client-side changes
2. That replay should be sent only to the subscribing client (`ws.send(...)`) not broadcast to all clients
3. That the client's `useTerminal` store should handle receiving replay data correctly -- since `appendLines` is additive, replaying into an already-populated buffer would create duplicates. The client should clear its buffer for that nodeId before replaying, or the server should only replay if the client's buffer is empty (which it always is on fresh subscribe, but not on reconnect).

**Why this is plan-level:** Without specifying the message type and send-vs-broadcast distinction, implementation will require a decision that affects both the server message handler and the client store. Getting the deduplication wrong means users see doubled output on reconnect.

---

### 7. `sendInput` for interactive mode sends `user_message` but may need `user_input` for question responses

**Severity:** Medium
**Section:** Bug 2 / Bug 3 / Step 2-3

Looking at `session.ts:188-194`, the `sendInput` function for interactive sessions wraps all input as:

```ts
const msg = JSON.stringify({ type: 'user_message', content: text });
```

This is correct for sending a new conversational turn to Claude. However, when responding to an `AskUserQuestion` tool use, the Claude CLI stream-json protocol may expect a different input format -- specifically a tool result or user response type, not a new `user_message`.

The `send_input` handler in `index.ts:226-238` dispatches based on `payload.kind`:
- `question_answer` sends `payload.answer` as raw text via `sendInput`
- `permission` sends `'yes'` or `'no'` as raw text via `sendInput`
- `text_input` sends `payload.text` as raw text via `sendInput`

All three end up as `{ type: 'user_message', content: '<the text>' }` JSON on stdin. For `AskUserQuestion` responses, the CLI may expect a specific response format tied to the tool use ID. If so, the response will be misinterpreted as a new turn rather than an answer to the pending question.

**Impl-note upgrade rationale:** This could silently break the entire human-needed response flow. However, since `--dangerously-skip-permissions` suppresses most interactive scenarios, and the exact stream-json input protocol for tool responses needs empirical verification, this is on the boundary between plan-level and impl-level.

**Suggested fix:** Step 5 (manual verification) should explicitly test sending a response to `AskUserQuestion` via stdin in stream-json format, to verify whether `user_message` is the correct wrapper or whether a different format is needed.

---

## Impl-notes (carried forward from R1, still valid)

These don't need plan-level fixes but should be kept in mind during implementation:

- **R1 #6:** Race between `result` event (marks completed) and `proc.exited` handler (may mark crashed). Gate the `proc.exited` crash transition on current state not being `completed`.
- **R1 #7:** Per-character `content_block_delta` events cause high-frequency WebSocket messages and React re-renders. Consider batching in `broadcastTerminal` or coalescing deltas in the stream parser.
- **R1 #8:** `pipeFrom` clears the idle timer in its `finally` block, but if stdout closes before `proc.exited` resolves, a clean exit without a `result` event leaves the session in `running` state permanently.

---

## Summary Table

| # | Severity | Finding | New/Carried |
|---|----------|---------|-------------|
| 1 | Medium | `--verbose` flag risk unaddressed from R1 | Carried (R1 #3) |
| 2 | Medium | `--include-partial-messages` flag existence not verified | New |
| 3 | Low | `clearHumanNeeded` is a parser closure, not callable from `index.ts` | New |
| 4 | Low | Noisy event suppression should use allowlist, not individual cases | Carried (R1 #10) |
| 5 | Low | Smoke test 7.8 still unrealistic with skip-permissions | Carried (R1 #9) |
| 6 | Must-fix | Terminal replay needs specified message type, send-not-broadcast, and dedup strategy | New |
| 7 | Medium | `user_message` may be wrong format for `AskUserQuestion` responses | New |
