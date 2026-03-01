# SDK/API Domain Specialist Review — Agent SDK Migration Plan (Round 1)

## Critical Issues

### C1: `sendInput` SDKUserMessage format is wrong — will silently fail multi-turn conversations

**Plan section:** Step 1, `sendInput` bullet

The plan says sendInput should push `{ type: 'user', message: { role: 'user', content: text } }` to the MessageChannel. Per the actual SDK type definition, `SDKUserMessage` requires:

```typescript
type SDKUserMessage = {
  type: "user";
  uuid?: UUID;
  session_id: string;          // REQUIRED — not optional
  message: MessageParam;       // Anthropic SDK MessageParam
  parent_tool_use_id: string | null;  // REQUIRED — not optional
  isSynthetic?: boolean;
  tool_use_result?: unknown;
};
```

The plan omits `session_id` (required field) and `parent_tool_use_id` (required field). Without `session_id`, the SDK subprocess will likely reject or silently drop the message. The `message.content` also needs to be in Anthropic `MessageParam` format: `{ role: 'user', content: [{ type: 'text', text: '...' }] }` (array of content blocks), not a bare string.

**Suggested fix:** Document the full SDKUserMessage shape in the plan. The session should capture `session_id` from the initial `system` init message and include it on all subsequent user messages. `parent_tool_use_id` should be `null` for top-level user messages.

### C2: AskUserQuestion handling is fundamentally different in SDK vs CLI — plan's approach will break

**Plan section:** Step 2, Message type mapping (assistant row) and general architecture

The plan says the message-processor will detect `AskUserQuestion` from `assistant` message `tool_use` content blocks and set human-needed state. In the current CLI approach, AskUserQuestion appears as a `tool_use` event and the response is sent as text via stdin.

In the SDK, **AskUserQuestion is handled through the `canUseTool` callback**, not through the message stream. The SDK invokes `canUseTool(toolName, input, options)` when Claude calls AskUserQuestion, and execution **blocks** until the callback returns a `PermissionResult`. The assistant message will contain the tool_use block, but responding to it requires `canUseTool` — you cannot simply push a user message into the AsyncIterable to answer it.

This is an architectural gap: the plan's MessageChannel pattern (push user messages as `SDKUserMessage`) cannot answer AskUserQuestion or permission requests. The plan needs a `canUseTool` callback that bridges to the WebSocket protocol.

**Suggested fix:** Add a `canUseTool` callback to the `query()` options that:
1. For `AskUserQuestion`: sets human-needed state on the node, stores the pending Promise resolve function, and waits for the WebSocket `send_input` handler to resolve it
2. For other tools (when not in bypassPermissions mode): similar bridge pattern
3. This replaces the "detect AskUserQuestion from assistant message" approach entirely

### C3: `permissionMode: 'bypassPermissions'` requires `allowDangerouslySkipPermissions: true`

**Plan section:** Step 1, `spawnSession` bullet

The plan specifies `options: { permissionMode: 'bypassPermissions', ... }` but omits `allowDangerouslySkipPermissions: true`. Per the SDK docs:

> `allowDangerouslySkipPermissions` — Enable bypassing permissions. **Required** when using `permissionMode: 'bypassPermissions'`

Without this flag, the SDK will throw an error at initialization.

**Suggested fix:** Add `allowDangerouslySkipPermissions: true` to the options in the plan's `spawnSession` specification.


## Must-fix Issues

### M1: SDK `stream_event` messages wrap Anthropic events differently than described

**Plan section:** Step 2, Message type mapping table

The plan maps `stream_event (content_block_delta)` as the mechanism for streaming text deltas. In the SDK, streaming partial messages are emitted as `SDKPartialAssistantMessage` with type `"stream_event"` and an `event` field containing a `BetaRawMessageStreamEvent` (from the Anthropic SDK). The structure is:

```typescript
{
  type: "stream_event",
  event: BetaRawMessageStreamEvent,  // NOT a top-level delta
  parent_tool_use_id: string | null,
  uuid: UUID,
  session_id: string
}
```

The plan's current stream-parser handles `content_block_delta` as a top-level event type. In the SDK, it's nested inside `msg.event` on a `stream_event` message. The message-processor needs to unwrap `msg.event.type` to get the actual Anthropic streaming event (which may be `content_block_delta`, `content_block_start`, `message_start`, etc.).

**Suggested fix:** Update the message type mapping table. For `stream_event` messages, the processor should inspect `msg.event.type` to dispatch:
- `msg.event.type === 'content_block_delta'` with `msg.event.delta.type === 'text_delta'` for streaming text
- Other event subtypes can be ignored (they're lifecycle events)

### M2: `result` message has subtypes and different shapes for success vs error

**Plan section:** Step 2, `result` row in message type mapping

The plan says to extract `total_cost_usd` and `usage` from the result message but doesn't distinguish between the success and error variants. The SDK `SDKResultMessage` is a discriminated union:

- **Success:** `subtype: 'success'` — has `result: string`, `total_cost_usd`, `usage: NonNullableUsage`
- **Error:** `subtype: 'error_max_turns' | 'error_during_execution' | 'error_max_budget_usd' | ...` — has `errors: string[]` instead of `result`

Both variants have `total_cost_usd` and `usage`, but the error variants should set the node to `crashed` with human-needed state, not `completed`. The usage field uses `input_tokens` and `output_tokens` (not `input` and `output` as in the current code's accumulation).

**Suggested fix:** Update the result message mapping to handle both `subtype: 'success'` and error subtypes. Map success to `completed` and error subtypes to `crashed` + human-needed. Note the `usage.input_tokens`/`output_tokens` field names explicitly.

### M3: `tool_use` and `tool_result` are not separate SDK message types — extraction approach needs documenting

**Plan section:** Step 2, implied from current stream-parser.ts event handling

The current stream-parser handles `tool_use` and `tool_result` as separate top-level event types. In the SDK, tool_use blocks are embedded within `SDKAssistantMessage.message.content[]` (as content blocks of type `tool_use`). The plan's message type mapping table only lists `system`, `assistant`, `stream_event`, and `result` — it omits explaining how tool_use blocks (needed for file tracking, stage detection, overlap tracking) will be extracted from assistant messages.

This matters because the existing stage detection (`Edit`/`Write` -> executing, `Bash` test commands -> testing) and file overlap tracking depend on seeing individual tool_use events. These need to be extracted from iterating `assistant.message.content[]`.

**Suggested fix:** Add explicit guidance in Step 2 that tool_use detection comes from iterating `assistant.message.content[]` blocks where `block.type === 'tool_use'`, extracting `block.name` and `block.input`. This replaces the old `tool_use` event type handling. Note that `tool_result` data is not directly surfaced as a separate SDK message — tool results appear in `SDKUserMessage.tool_use_result` on synthetic user messages.

### M4: Consider V2 SDK interface as an alternative to custom MessageChannel

**Plan section:** Step 1, overall architecture

The plan proposes a custom `MessageChannel` class implementing `AsyncIterable<SDKUserMessage>` for multi-turn conversations with the V1 `query()` API. The V2 SDK interface (`unstable_v2_createSession`) provides exactly this pattern natively:

- `spawnSession` -> `unstable_v2_createSession(options)`
- `sendInput` -> `session.send(text)`
- `killSession` -> `session.close()`
- Processing responses -> `for await (const msg of session.stream())`

This eliminates the MessageChannel class entirely and avoids tricky coordination between the AsyncIterable and the query generator (race conditions between `close()` and pending `next()`, backpressure, error propagation).

However, V2 is labeled "unstable preview" and may have breaking changes. This is a design tradeoff the plan should explicitly address.

**Suggested fix:** Either (a) switch to V2 with a note about the instability risk, or (b) keep V1 but add explicit documentation of the MessageChannel's edge cases: what happens when `close()` is called while `next()` is pending, error propagation through the generator, and whether the channel needs a maximum buffer size.


## Medium Issues

- **M5:** The plan specifies `settingSources: ['user', 'project', 'local']` which is correct, but worth highlighting that the SDK default when `settingSources` is omitted is `[]` (loads NO settings). If this option is accidentally dropped during implementation, CLAUDE.md files and project settings silently stop loading.

- **M6:** `shared/types.ts` `SendInputPayload` may need updating. The `question_answer` kind currently sends a bare string answer. With the SDK's `canUseTool` / AskUserQuestion pattern, the response needs to include the `answers` map (question text -> selected option label) and the original `questions` array. The WebSocket protocol may need a new payload kind for structured question answers.

- **M7:** The plan's `killSession` calls `abortController.abort()`, `channel.close()`, and `query.close()`. The SDK `Query.close()` "forcefully ends the query and cleans up all resources." Calling both `abort()` and `close()` may cause double-cleanup or errors. The plan should specify a single canonical shutdown path.

- **M8:** Plan risk #4 mentions "current code strips CLAUDECODE env var." The SDK has an `env` option defaulting to `process.env`. If Stems is itself running inside a Claude Code session, the child process may inherit problematic env vars. The SDK may or may not strip these internally — this needs explicit testing during verification.

- **M9:** The `systemPrompt.append` field is a single string. The current codebase may pass both overlap context and parent task context. These need to be joined before passing as `append`. The plan should note this concatenation in Step 1.


## Low Issues

- **L1:** Execution Strategy has Agent A (session.ts) and Agent B (message-processor.ts) working in parallel, but session.ts calls `processMessage()` from message-processor.ts. Define the `createMessageProcessor` return type as a shared interface contract before agents start.

- **L2:** The SDK `SDKResultMessage` includes `duration_ms`, `duration_api_ms`, `num_turns`, and `modelUsage` fields not currently tracked. These could enhance the GUI — worth noting as a follow-up.

- **L3:** Verification section doesn't include testing idle timeout behavior with SDK message cadence. New SDK message types (`SDKStatusMessage`, `SDKToolProgressMessage`) should also reset the idle timer.

- **L4:** `SDKToolUseSummaryMessage` exists in the SDK but isn't in the plan's message mapping. These could provide cleaner stage detection than parsing assistant content blocks.


## Impl-notes

### Message handling edge cases
- `SDKPartialAssistantMessage` wraps Anthropic `BetaRawMessageStreamEvent` — the exact event subtypes (`content_block_start`, `content_block_delta`, `content_block_stop`, `message_start`, `message_delta`, `message_stop`) need to be enumerated and handled or explicitly ignored during implementation
- `SDKCompactBoundaryMessage` (type `system`, subtype `compact_boundary`) is a new message type not present in CLI streaming — decide whether to surface it in the terminal or suppress
- `SDKRateLimitEvent` should probably trigger a human-needed state or at least terminal output, similar to how errors work
- `SDKStatusMessage` and `SDKToolProgressMessage` exist as new message types — decide during implementation whether to surface them in the terminal

### Multi-turn coordination (V1 AsyncIterable approach)
- If `query()` finishes iterating (generator completes) after a `result` message but the channel is still open, the channel needs cleanup. Test what happens when the generator completes but messages are still buffered in the channel
- Race between `session.close()` cleanup and in-flight `processMessage()` calls — the message processor may try to update a node that's already been cleaned up
- The Promise-based blocking in MessageChannel (`next()` returns a Promise that resolves when `push()` is called) is the correct approach but needs careful testing under load

### Bun compatibility
- SDK spawns a subprocess internally. The `executable` option can be set to `'bun'` — verify that auto-detection picks up Bun correctly, or set it explicitly
- The SDK's internal process management (stdout/stderr parsing, IPC) may have Node-specific assumptions. Test early.

### Cost tracking
- `total_cost_usd` may be cumulative across the entire session (not per-turn) in multi-turn mode. If cumulative, delta tracking is needed: store previous total, subtract to get per-turn cost. Verify with a multi-turn test.
- `modelUsage` breakdown by model name is new — useful for future GUI iterations

### Error handling
- SDK may throw exceptions from `query()` that aren't yielded as messages — `for await` will throw, not yield an error message. The `consumeQuery` wrapper needs a try/catch around the entire async iteration
- The `SDKAssistantMessage.error` field can be `'authentication_failed'`, `'billing_error'`, `'rate_limit'`, `'invalid_request'`, `'server_error'`, or `'unknown'` — each may need different human-needed types
- When the SDK process crashes (OOM, segfault), the async generator should throw — handle this in `consumeQuery`

### Permission model nuance
- Using `bypassPermissions` means `canUseTool` never fires for regular tools — only `AskUserQuestion` still triggers it (per the SDK docs, AskUserQuestion always goes through `canUseTool` regardless of permission mode). This simplifies the initial migration but means future permission modes will need the full `canUseTool` bridge
- If Stems later wants to support non-bypass permission modes, the `canUseTool` callback bridge from C2 becomes essential infrastructure, not optional
