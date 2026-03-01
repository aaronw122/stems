# Terminal Rendering Plan Review — Backend Data Pipeline

**Reviewer focus:** Backend data handling correctness, message processor coverage, type contracts, race conditions, streaming vs. complete message handling.

**Files reviewed:**
- `plans/claude-terminal-theming.md` (revision 3)
- `server/message-processor.ts`
- `server/state.ts`
- `server/session.ts`
- `server/index.ts`
- `server/context-summary.ts`
- `shared/types.ts`
- `src/hooks/useTerminal.ts`
- `src/hooks/useWebSocket.ts`
- `src/components/panels/TerminalMessageRenderer.tsx`
- `@anthropic-ai/claude-agent-sdk` SDK type definitions

---

## Findings

### [Must-fix] tool_result blocks come from `user` messages, not `assistant` messages

**Location:** `server/message-processor.ts` lines 162-177, Plan Step 1 "Message processor mappings"

**Issue:** The message processor's `handleAssistant()` function processes `block.type === 'tool_result'` inside `assistant` message content. However, in the Anthropic API message protocol, `tool_result` blocks are part of **user messages** (`role: 'user'`), not assistant messages. The SDK emits `SDKUserMessage` (type `'user'`) with `tool_use_result` content when relaying tool execution results. The `assistant` message's `BetaMessage.content[]` contains `text`, `tool_use`, and `thinking` blocks — never `tool_result`.

The current code iterates `msg.message.content` on `SDKAssistantMessage` and checks for `tool_result`. This branch will never match because assistant messages don't contain tool_result blocks. The actual tool results flow through `SDKUserMessage` events (type `'user'`), which the message processor ignores entirely (they fall through to the `default` case in `processMessage`).

This means **tool results are never displayed in the terminal**. The `tool_result` TerminalMessage type exists but is never populated.

**Suggested fix:** To surface tool results, the processor needs to handle `SDKUserMessage` events (msg.type === `'user'`). Parse `msg.tool_use_result` or `msg.message.content` for tool_result blocks there. Alternatively, capture tool results from `stream_event` content_block deltas when they arrive (the SDK streams tool execution results as content blocks before assembling them into user messages). This is an architectural decision that affects where in the stream tool results become available and how they pair with their originating tool_use.

---

### [Medium] `handleAssistant` does not process `thinking` content blocks

**Location:** `server/message-processor.ts` `handleAssistant()` lines 156-216

**Issue:** The `assistant` message's `BetaMessage.content[]` can include blocks with `type: 'thinking'` (extended thinking / adaptive thinking). These blocks are not handled in the for-loop's if/else chain. They silently fall through without any processing. The plan explicitly defers thinking indicators (line 112: "Deferred: thinking indicators"), but the current code doesn't even log or skip them explicitly — they're invisible non-matches in the content block iteration.

While the plan says this is deferred, the current code structure creates a subtle issue: if a `thinking` block appears before a `text` block, `tryExtractTitle` won't see the thinking text (which is fine), but if the block type check order ever changes, or if new block types are added (like `redacted_thinking`), the else-if chain won't catch them and they'll silently vanish.

**Suggested fix:** Add an explicit `else if (block.type === 'thinking')` branch (even if it's a no-op with a comment) to make the handling intentional rather than accidental. This is low cost and prevents future confusion.

---

### [Medium] `tool_use_summary` messages are silently dropped — missed opportunity for terminal display

**Location:** `server/message-processor.ts` `processMessage()` default case, lines 350-361

**Issue:** The SDK emits `SDKToolUseSummaryMessage` (type `'tool_use_summary'`) with a `summary` string and `preceding_tool_use_ids`. This is a compact, human-readable summary of what a batch of tool uses accomplished. The message processor drops these in the `default` case.

In the context of terminal rendering, `tool_use_summary` messages are exactly what a GUI mini-terminal should display — they're the equivalent of what Claude Code shows in its own terminal as the one-line summary after a tool execution completes (e.g., "Read 3 files, edited 2"). Without these, the terminal only shows the tool_use name ("Edit") but not the summarized outcome.

**Suggested fix:** Add a case for `msg.type === 'tool_use_summary'` that emits a `TerminalMessage` of type `tool_result` (or a new type) with `text: msg.summary`. This would significantly improve terminal readability. Not architecturally blocking — can be added later — but the plan should note this as a known gap.

---

### [Medium] `task_started` / `task_progress` / `task_notification` messages are dropped — subagent activity invisible

**Location:** `server/message-processor.ts` `processMessage()` default case

**Issue:** The SDK emits `SDKTaskStartedMessage`, `SDKTaskProgressMessage`, and `SDKTaskNotificationMessage` (all type `'system'` with subtypes `task_started`, `task_progress`, `task_notification`) for subagent (Agent tool) activity. These carry the `description`, `task_type`, progress updates, and completion summaries for subagents.

The message processor only handles `system` messages with `subtype === 'init'` (line 324). All task-related system messages are silently skipped. This means when a session spawns subagents via the Agent tool, the terminal shows the `tool_use` for "Agent" but nothing about what the subagent is doing, its progress, or its completion.

The reference document (`notes/claude-code-terminal-rendering-reference.md` line 100) specifically notes that subagent display should use `subagent_type` as the display name and show progress/completion. None of this is captured by the current processor or addressed in the plan.

**Suggested fix:** Add handling for `system` messages with subtypes `task_started`, `task_progress`, and `task_notification`. Map `task_started` to a `tool_use`-style message showing the subagent type and description. Map `task_notification` (completion) to a `system`-style message with the summary. This could use existing TerminalMessage types or warrant a new `subagent` type. At minimum, the plan should acknowledge this gap.

---

### [Low] `toolName` field on `tool_result` messages is set to `tool_use_id`, not the actual tool name

**Location:** `server/message-processor.ts` line 164

**Issue:** When processing (what the code believes are) tool_result blocks, the `toolName` is set from `block.tool_use_id`:
```typescript
const toolName = 'tool_use_id' in block ? String(block.tool_use_id) : undefined;
```
This would produce a UUID-like string (e.g., `toolu_01A...`), not a human-readable tool name like "Read" or "Edit". The `TerminalMessageRenderer` displays `toolName` visually, so users would see an opaque ID instead of the tool name.

To resolve the tool name, you'd need to correlate the `tool_use_id` back to the preceding `tool_use` block that had the same ID. This requires maintaining a `Map<string, string>` of `tool_use_id -> tool_name` from the `tool_use` blocks seen in assistant messages.

**Suggested fix:** Add a `toolUseIdToName` map in the processor closure. Populate it when processing `tool_use` blocks (`toolUseIdToName.set(block.id, block.name)`). Look up from it when processing tool results. This is a data correlation issue that's straightforward to implement.

---

### [Low] `isSuccess` field on `TerminalMessage` is never populated

**Location:** `shared/types.ts` line 16, `server/message-processor.ts` (all message emission sites)

**Issue:** The `TerminalMessage` interface defines `isSuccess?: boolean`, and the `TerminalMessageRenderer` uses it to determine the bullet color for `tool_result` messages (line 101-103 of the renderer: `message.isSuccess === false ? 'var(--term-tool-error)' : 'var(--term-tool-success)'`). However, no code path in the message processor ever sets `isSuccess` on any emitted message.

This means all tool_result bullets will always show the success color (green), even for failed tool executions. The field exists in the type contract but has no data source.

**Suggested fix:** When processing tool results (from wherever they're sourced — see finding #1), determine success/failure from the result content. For `SDKToolUseSummaryMessage`, check if the summary indicates an error. For tool_result blocks in user messages, check for `is_error` fields. This requires understanding how the SDK signals tool failure.

---

### [Impl-note] `stream_event` handler only processes `content_block_delta` with `text_delta` — misses `tool_use` input deltas

**Location:** `server/message-processor.ts` `handleStreamEvent()` lines 230-249

**Issue:** The stream event handler only matches `content_block_delta` with `delta.type === 'text_delta'`. The SDK also streams `content_block_delta` with `delta.type === 'input_json_delta'` for tool_use input being built incrementally. These are ignored, which is fine because the complete tool_use is captured in the `assistant` message.

However, there are other stream event types: `content_block_start` (which carries the block type and, for tool_use, the tool name before input arrives), `content_block_stop`, `message_start`, `message_delta`, `message_stop`. None of these are processed.

For the current plan this is correct — `content_block_start` for tool_use would be redundant with the assistant message handler. But if you ever want to show "tool X is running..." before the tool completes, you'd need `content_block_start`.

**Suggested fix:** No action needed now. The comment in the plan noting that text was "already streamed via stream_event deltas" (line 159) correctly describes the deduplication strategy. Just be aware that future real-time tool progress display would require handling more stream event types.

---

### [Impl-note] No deduplication guard between `stream_event` text deltas and `assistant` message text blocks

**Location:** `server/message-processor.ts` `handleStreamEvent()` and `handleAssistant()`

**Issue:** Text content is streamed incrementally via `stream_event` (`content_block_delta` / `text_delta`) and then the complete text appears in the `assistant` message's `content[]` as a `text` block. The code handles this correctly: `handleStreamEvent` emits `assistant_text` messages for each delta, and `handleAssistant` skips `text` blocks (line 158-161, "Text was already streamed... skip to avoid duplication").

This works but relies on ordering: `stream_event` messages always arrive before the `assistant` message for the same turn. The SDK guarantees this (streaming events precede the completed message), so this is safe. Noting for documentation purposes only.

**Suggested fix:** None needed. The current approach is correct. Consider adding a brief comment in the code noting the SDK ordering guarantee that makes this deduplication safe.

---

### [Impl-note] `permission` humanNeededType but no SDK signal for permission requests

**Location:** `server/message-processor.ts` lines 86-99, `shared/types.ts` line 28

**Issue:** The `HumanNeededType` includes `'permission'` and the `send_input` handler in `server/index.ts` handles `permission` responses (lines 247-248, 289-291). However, the message processor has no code path that calls `setHumanNeeded('permission', ...)`. Since the server spawns sessions with `permissionMode: 'bypassPermissions'` (session.ts line 41), permission requests won't occur in practice.

But if the permission mode ever changes, the processor doesn't have logic to detect permission-request tool_use blocks from the SDK. The SDK doesn't emit a special message type for permission requests — they come through as `tool_use` blocks in `assistant` messages that would normally require user approval. With `bypassPermissions`, the SDK auto-approves them.

**Suggested fix:** This is correctly handled for the current architecture (bypass mode means no permission prompts). If bypass mode is ever removed, add detection for specific tool names or SDK messages that indicate a permission gate. Low priority since this is by design.

---

### [Impl-note] Server-side buffer merge can split non-text messages

**Location:** `server/state.ts` `appendTerminalMessages()` lines 26-42

**Issue:** The merge logic only coalesces consecutive `assistant_text` messages. This is correct. However, when the buffer exceeds `MAX_SERVER_MESSAGES` (200), trimming with `merged.slice(merged.length - MAX_SERVER_MESSAGES)` could slice in the middle of a conceptual group (e.g., a `tool_use` message followed by its `tool_result`). This means the replay buffer might start with an orphaned `tool_result` that has no preceding `tool_use`.

For display purposes this is merely cosmetic — the renderer handles each message independently. But for the `context-summary.ts` summarization, which serializes messages to plain text (line 26: `messages.map(m => m.text).join('\n')`), an orphaned tool_result at the start of the buffer could produce slightly misleading context.

**Suggested fix:** Accept this as a known limitation. The buffer is a ring buffer for display, not an audit log. The 200-message limit is generous enough that this rarely matters. No plan change needed.

---

### [Impl-note] Plan does not mention `tool_use_summary` for enriching tool_use display text

**Location:** Plan Step 1, "Message processor mappings"

**Issue:** The plan's mapping for `tool_use` is `{ type: 'tool_use', text: name, toolName: name }`, meaning the display text for a tool_use message is just the tool name (e.g., "Edit", "Bash"). Claude Code's actual terminal shows richer summaries like `Edit(server/index.ts)` or `Bash(git status)` — these come from `SDKToolUseSummaryMessage` events or from extracting key parameters from the tool input.

The current implementation could extract a brief summary from `block.input` for common tools (e.g., for `Edit`/`Write`: the `file_path`; for `Bash`: the `command`; for `Read`: the `file_path`). This would make the mini-terminal much more useful.

**Suggested fix:** Consider adding an `extractToolSummary(name, input)` helper that returns a one-line summary for known tools. Map to the `text` field of the `tool_use` TerminalMessage. This is an enhancement, not a bug.

---

### [Impl-note] TerminalMessage type may benefit from a `timestamp` field

**Location:** `shared/types.ts` TerminalMessage interface

**Issue:** Messages have no timestamp. For replay scenarios (subscribe_terminal sends buffered messages), the client can't show time gaps between messages or "5 minutes ago" indicators. The server-side buffer also can't age out stale messages.

**Suggested fix:** Consider adding `timestamp?: number` (epoch ms) to TerminalMessage. Populate it in the message processor with `Date.now()`. Useful for future features like elapsed time display, message grouping, or stale session detection. Not blocking for current plan scope.

---

## Summary

| Severity | Count | Key themes |
|----------|-------|------------|
| Must-fix | 1 | tool_result blocks in wrong message type handler — results never display |
| Medium | 3 | Thinking blocks unhandled, tool_use_summary dropped, subagent messages invisible |
| Low | 2 | toolName set to UUID not name, isSuccess never populated |
| Impl-note | 5 | Stream event coverage, dedup safety, permission mode, buffer trimming, missing timestamps |

The most impactful finding is #1: the tool_result processing targets the wrong SDK message type, so tool execution results will never appear in the terminal. This is an architectural gap in how the message processor maps SDK events to terminal messages and would cause significant rework if discovered late.

The three Medium findings (#2, #3, #4) represent missed SDK message types that would make the terminal more useful. They can be added incrementally but the plan should at least acknowledge them so implementers don't assume the current mapping is exhaustive.
