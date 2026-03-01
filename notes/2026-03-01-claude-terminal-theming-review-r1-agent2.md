# Claude Terminal Theming Plan Review — Agent SDK Integration Perspective

**Reviewer:** Agent SDK Integration Specialist (agent 2)
**Date:** 2026-03-01
**Plan reviewed:** `plans/claude-terminal-theming.md`
**Cross-referenced:** `plans/agent-sdk-migration.md`, `server/stream-parser.ts`, `server/session.ts`, `server/state.ts`, `server/index.ts`, `server/context-summary.ts`, `shared/types.ts`, `src/hooks/useTerminal.ts`, `src/hooks/useWebSocket.ts`, `src/components/panels/TerminalPeek.tsx`

---

## Issue 1 — Stream parser event types assume CLI format, not Agent SDK messages

**Severity:** Critical

**Section:** Step 1 — "Stream parser changes (per event type)"

**Problem:** The plan maps CLI stream-json event types (`assistant`, `content_block_delta`, `tool_use`, `tool_result`, `result`, `error`) to new `TerminalMessage` types. But `plans/agent-sdk-migration.md` specifies that the Agent SDK replaces these CLI events with a fundamentally different message taxonomy: `system`, `assistant` (with different content block structure), `stream_event` (wrapping `content_block_delta`), and `result` (with `success`/`error` subtypes). The SDK uses typed `SDKMessage` objects, not newline-delimited JSON strings.

Concretely:
- CLI emits `tool_use` as a top-level event type. The SDK embeds tool_use blocks inside `assistant` message `content[]` arrays.
- CLI emits `tool_result` as a top-level event type. The SDK may not expose tool results as discrete events at all — it processes them internally.
- CLI emits `content_block_delta` as a top-level event. The SDK wraps this in `stream_event`.
- CLI emits `result` with `cost_usd` and `usage` fields. The SDK uses `total_cost_usd` and may use different field names/nesting.

The theming plan builds its entire `TerminalMessage` mapping on the CLI event taxonomy. If the SDK migration lands first (or concurrently), every mapping in this section is wrong. If the theming plan lands first and then the SDK migration happens, every mapping needs to be rewritten.

**Impact:** This is the central architectural concern. The `TerminalMessage` extraction logic is the bridge between the backend event model and the frontend rendering model. Building it against a format that's about to be replaced means either: (a) the work gets thrown away, or (b) both plans collide at implementation time.

**Fix:** The plan must acknowledge the SDK migration as a hard sequencing dependency. Either:
1. **Land SDK migration first**, then write the `TerminalMessage` extraction against `message-processor.ts` (the SDK equivalent of `stream-parser.ts`).
2. **Design `TerminalMessage` extraction as an adapter layer** in `message-processor.ts` directly, making theming part of the SDK migration. Add a column to the SDK migration's "Message type mapping" table that includes the `TerminalMessage` output for each SDK message type.
3. **If theming must ship before the SDK migration**, explicitly document that the stream-parser mappings in Step 1 will be rewritten when `message-processor.ts` replaces `stream-parser.ts`, and ensure the `TerminalMessage` type interface itself is SDK-compatible.

Option 2 is cleanest.

---

## Issue 2 — `terminal_data` and `terminal_replay` protocol change needs coordinated migration with buffer type

**Severity:** Must-fix

**Section:** Step 1 — "Protocol change" + Step 5 — "Update useTerminal Store"

**Problem:** The plan changes the WebSocket `terminal_data` message from `{ lines: string[] }` to `{ messages: TerminalMessage[] }`. But it misses that the server-side terminal buffer in `state.ts` (`terminalBuffers: Map<string, string[]>`) stores raw strings and is consumed by two separate systems:

1. **`broadcastTerminal()`** — sends lines to WebSocket subscribers via `terminal_data` messages.
2. **`getTerminalLines()`** — consumed by `context-summary.ts` to summarize session output for child tasks, and by `index.ts` for `terminal_replay` on subscribe.

If the buffer type changes from `string[]` to `TerminalMessage[]`:
- `context-summary.ts` calls `getTerminalLines()` and does `lines.join('\n')` to build a prompt for Claude. With `TerminalMessage[]`, this would produce `[object Object]\n[object Object]...`.
- The `terminal_replay` message in `index.ts` (line 196) sends `lines: bufferedLines` — if the buffer is now `TerminalMessage[]` but the protocol field is called `lines`, there's a type mismatch (though it would still serialize as JSON, the client would receive the wrong shape unless `terminal_replay` is also updated).

**Fix:** The plan's Step 1 lists `server/state.ts` as needing a buffer type update, but it needs to also list `server/context-summary.ts` as a modified file that must serialize `TerminalMessage[]` back to plain text for the summarization prompt. And `terminal_replay` in `index.ts` must send `messages` instead of `lines` to match the protocol change. Add `context-summary.ts` to the modified files table and add a note about the replay message format.

---

## Issue 3 — `sendInput` echo to terminal needs SDK-compatible implementation

**Severity:** Medium

**Section:** Step 1 — "User message echo"

**Problem:** The plan says "In `server/index.ts`, when handling `send_input`, also broadcast `{ type: 'user_message', text }` to the terminal." This means the server creates a `TerminalMessage` and broadcasts it to the frontend. But under the Agent SDK, user messages are pushed to a `MessageChannel` (per the migration plan), not written to stdin. The SDK may or may not echo user messages as events in the query stream.

If the SDK doesn't emit user messages as events (which is typical for programmatic APIs — you already know what you sent), the plan's approach of broadcasting user_message from `index.ts` is actually correct and SDK-compatible. However, if the SDK *does* echo user messages, you'd get duplicate user messages in the terminal.

**Fix:** Add a note that the server-side `user_message` echo in `index.ts` is the canonical source of user messages in the terminal, and that the message processor (whether `stream-parser.ts` or `message-processor.ts`) should NOT emit `user_message` type messages from the stream. This prevents duplication under either the CLI or SDK model.

---

## Issue 4 — `thinking` message type has no corresponding event in CLI or SDK

**Severity:** Medium

**Section:** Step 1 — "New type: TerminalMessageType"

**Problem:** The `TerminalMessageType` includes `'thinking'` (with the description "Cogitated for Xs"), but neither the current stream parser nor the SDK migration plan shows a corresponding event type that would produce this. The current stream parser handles these CLI event types: `assistant`, `content_block_delta`, `tool_use`, `tool_result`, `result`, `error`, `model_usage_metrics`, `system`, `content_block_start/stop`, `message_start/delta/stop`, `ping`. None of these is a "thinking" event.

Claude Code's "Thinking..." / "Cogitated for Xs" indicators are generated client-side by the Claude Code CLI's own rendering layer — they're not part of the stream-json output. They're inferred from timing between events (e.g., gap between `message_start` and first `content_block_delta`).

The `TerminalMessage` type defines `durationSec?: number` and `type: 'thinking'`, but the plan's "Stream parser changes" section has no mapping that produces a `thinking` message. This type exists in the interface but has no producer.

**Fix:** Either:
1. Remove `thinking` from `TerminalMessageType` and the renderer table (simplest — defer to a future enhancement).
2. Add a "Stream parser changes" entry that explains how `thinking` messages are synthesized: e.g., emit `{ type: 'thinking', text: 'Thinking...' }` on `content_block_start` when the block is type `thinking`, and emit `{ type: 'thinking', text: 'Cogitated for Xs', durationSec }` on the corresponding `content_block_stop` with a timestamp delta. Note: this only works if Claude Code actually sends `thinking` content blocks — if not, this feature is unimplementable from stream data alone.

---

## Issue 5 — Missing `permission` event handling in TerminalMessageType

**Severity:** Medium

**Section:** Step 1 — "New type: TerminalMessageType"

**Problem:** The `TerminalMessageType` union doesn't include a type for permission requests, even though the current stream parser detects `AskUserQuestion` tool calls (setting `humanNeeded`). Permission requests are a core part of Claude Code's terminal UI — they show prominent colored blocks asking the user to approve tool execution.

The theme color tables include `permission: rgb(177,185,249)` as a token, and the intent spec explicitly lists permission indicators as part of the visual fidelity goal, but there's no `TerminalMessageType` variant to render permission/question blocks distinctly from regular `tool_use` messages.

**Fix:** Add `'permission_request'` or `'question'` to `TerminalMessageType` to render AskUserQuestion and permission prompts with their distinct visual treatment (using the `permission` theme token). Add a stream-parser mapping entry: when `tool_use` event has `name === 'AskUserQuestion'`, emit `{ type: 'question', text: questionText }` instead of (or in addition to) a generic `tool_use` message.

---

## Issue 6 — Theme token set doesn't map 1:1 to extracted Claude Code color tokens

**Severity:** Low

**Section:** Step 2 — "Theme tokens (CSS custom properties)"

**Problem:** The extracted Claude Code theme colors (Step "Extracted Theme Colors") include tokens like `claude`, `success`, `error`, `warning`, `permission`, `suggestion`, `remember`, `planMode`, `autoAccept`, `bashBorder`, `secondaryBorder`. The CSS custom properties in Step 2 use a different naming scheme: `--term-tool-success`, `--term-tool-error`, `--term-tool-name`, `--term-thinking-indicator`, etc. But the plan never defines which extracted color maps to which CSS variable.

For example:
- What color does `--term-tool-name` use? Is it `secondaryText`? `claude`?
- What does `--term-thinking-indicator` map to? `planMode`? `claude`?
- Where do `warning`, `suggestion`, `remember`, `planMode`, `autoAccept`, `bashBorder` get used?

Without explicit mappings, the implementer will have to guess or reverse-engineer from Claude Code's rendering, which defeats the purpose of having extracted the color tables.

**Fix:** Add a mapping table in Step 2 that shows: `CSS Variable -> Source Token -> Example Value (Dark)`. For example:
- `--term-text` -> `text` -> `rgb(255,255,255)`
- `--term-tool-success` -> `success` -> `rgb(78,186,101)`
- `--term-thinking-indicator` -> `claude` -> `rgb(215,119,87)`
- etc.

---

## Issue 7 — Light/daltonized themes have fewer tokens than dark; plan doesn't address missing tokens

**Severity:** Low

**Section:** Step 2 — "Extracted Theme Colors"

**Problem:** The Dark theme has 13 tokens. Light has 9 (missing `remember`, `planMode`, `autoAccept`, `bashBorder`). Dark Daltonized has 8 (missing `remember`, `planMode`, `autoAccept`, `bashBorder`, `secondaryBorder`). Light Daltonized has 6 (missing even more). The plan defines a single `ThemeTokens` interface with a fixed set of CSS variables but doesn't address what happens when a theme preset doesn't have a value for a token.

**Fix:** Add a note that missing tokens in lighter/daltonized themes should fall back to a sensible default — either the dark theme's value for that token, or a generic value. Define the fallback strategy (e.g., `bashBorder` defaults to `secondaryBorder` defaults to `secondaryText`).

---

## Issue 8 — `server/state.ts` file listed in Step 1 but `broadcastTerminal` signature change not specified

**Severity:** Must-fix

**Section:** Step 1 — "Files to modify"

**Problem:** Step 1 lists `server/state.ts` as needing a "buffer type update from `string[]` to `TerminalMessage[]`". But `broadcastTerminal()` in `state.ts` (line 160) currently takes `(nodeId: string, lines: string[])` and constructs a `ServerMessage` with `{ type: 'terminal_data', nodeId, lines }` using `satisfies ServerMessage`. Changing the buffer type requires changing:
- The `broadcastTerminal()` parameter type from `string[]` to `TerminalMessage[]`
- The `appendTerminalLines()` function signature and storage
- The `getTerminalLines()` return type
- The `ServerMessage` union type for `terminal_data` (already noted in the plan)
- The `ServerMessage` union type for `terminal_replay` (NOT noted in the plan)

The `terminal_replay` message type in `shared/types.ts` (line 80) is `{ type: 'terminal_replay'; nodeId: string; lines: string[] }` — this also needs to change to `messages: TerminalMessage[]` to match.

**Fix:** Add `terminal_replay` to the protocol change section in Step 1, and explicitly list all function signatures in `state.ts` that need updating. Also update Step 6 (useWebSocket) to handle `terminal_replay` with the new `messages` field, not just `terminal_data`.

---

## Issue 9 — AnsiToHtml removal may break tool_result rendering

**Severity:** Impl-note

**Section:** Step 4 — "Update TerminalPeek"

**Problem:** The plan says "Remove `AnsiToHtml` import and converter (keep `ansi-to-html` dep for tool_result only)". This is contradictory — it says remove the import but keep the dep for tool_result. If tool results from CLI/SDK contain ANSI escape codes (they do — Bash tool output commonly includes colored output), something needs to convert them. The plan doesn't specify where the ANSI-to-HTML conversion happens for `tool_result` messages specifically.

**Fix:** Clarify: use `AnsiToHtml` only inside `TerminalMessageRenderer` for `tool_result` type messages, and remove it from the top-level `TerminalPeek` rendering. Or pre-process ANSI in the server-side message processor before broadcasting.

---

## Issue 10 — `stderr` output from CLI has no TerminalMessage type mapping

**Severity:** Impl-note

**Section:** Step 1 — "Stream parser changes"

**Problem:** The current `session.ts` has a `drainStderr()` function that broadcasts stderr output as plain strings to the terminal: `broadcastTerminal(nodeId, [\`[stderr] ${text}\`])`. The theming plan changes `broadcastTerminal` to accept `TerminalMessage[]` but doesn't specify what `TerminalMessage` type stderr output should map to. Under the Agent SDK, stderr handling may not exist (the SDK manages subprocess internals), but during the CLI phase this is an active code path.

**Fix:** During implementation, map stderr output to `{ type: 'error', text: \`[stderr] ${text}\` }` or `{ type: 'system', text }` in `session.ts`.

---

## Issue 11 — Implementation order note about Step 1 and Steps 4+5+6 is correct but incomplete

**Severity:** Low

**Section:** "Implementation Order"

**Problem:** The plan notes "Steps 1 and 4+5+6 must land together or the client breaks (server sends `messages` but client expects `lines`)." This is correct, but the same concern applies to `terminal_replay` in `index.ts` — if the server sends `messages` but the `terminal_replay` handler in `useWebSocket.ts` calls `setLines(msg.nodeId, msg.lines)`, the replay data silently becomes `undefined` (since the field name changed from `lines` to `messages`). This could cause the terminal to show empty on reconnect/subscribe even though data exists.

**Fix:** Add `terminal_replay` protocol update to the "must land together" note, and mention `useWebSocket.ts` replay handling as part of the atomic changeset.

---

## Summary

| Severity | Count | Key issues |
|----------|-------|------------|
| Critical | 1 | Event type taxonomy assumes CLI format, not Agent SDK |
| Must-fix | 2 | Buffer type change breaks context-summary + terminal_replay protocol gap |
| Medium | 3 | Thinking type has no producer, permission type missing, user_message duplication risk |
| Low | 3 | Token mapping table missing, fallback strategy for incomplete themes, implementation order incomplete |
| Impl-note | 2 | AnsiToHtml scope unclear, stderr type mapping |

The critical issue (Issue 1) is the most important: this plan and the Agent SDK migration plan are on a collision course. The `TerminalMessage` type interface is sound and can survive the SDK migration, but the extraction logic (which CLI events produce which `TerminalMessage` types) will be thrown away when `stream-parser.ts` is replaced by `message-processor.ts`. The plan needs an explicit sequencing decision.
