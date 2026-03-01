# Terminal Rendering Review — R2 Agent 1 (Frontend Rendering Specialist)

**Scope:** Plan `plans/claude-terminal-theming.md` (rev 5), focused on frontend rendering correctness.
**Files reviewed:** Plan (rev 5), `TerminalMessageRenderer.tsx`, `TerminalPeek.tsx`, `useTerminal.ts`, `shared/types.ts`, `server/message-processor.ts`, `src/styles/flow.css`

---

## R1 Fix Verification

### 1. Tool call renders as `ToolName ToolName` — FIXED in plan, NOT fixed in code

**Plan status:** Fixed. The plan (lines 143-191) now specifies `extractToolSummary(name, input)` with per-tool input extraction logic, and the mapping uses `text: extractToolSummary(name, input)` instead of `text: name`.

**Code status:** NOT yet implemented. `message-processor.ts` line 190 still reads:
```typescript
messages.push({ type: 'tool_use', text: name, toolName: name });
```
This is expected since these steps haven't been implemented yet (Step 1 depends on the SDK migration). The plan correctly specifies the fix. No issue.

### 2. tool_result blocks in wrong handler — FIXED in plan, NOT fixed in code

**Plan status:** Fixed. Lines 193-219 now specify `handleUser()` for `SDKUserMessage` with tool_result extraction, `toolUseIdToName` map, and removal of the dead `tool_result` branch from `handleAssistant()`.

**Code status:** NOT yet implemented. `message-processor.ts` lines 162-177 still have the dead `tool_result` handling in `handleAssistant()`, and there is no `case 'user'` in `processMessage()`. Again expected — the plan is correct.

### 3. Missing `└` connector — FIXED in plan, NOT fixed in code

**Plan status:** Fixed. Lines 355-368 specify the `└` connector. Lines 401-418 show the full collapsible tool_result with `└`.

**Code status:** NOT yet implemented. `TerminalMessageRenderer.tsx` lines 100-111 still use a colored bullet. Expected.

### 4. No running/error state — FIXED in plan, partially in types

**Plan status:** Fixed. Lines 108, 306-337 specify the `status` field and spinner rendering.

**Code/types status:** The `TerminalMessage` interface in `shared/types.ts` is MISSING the `status` and `toolUseId` fields that the plan specifies. Current interface (lines 12-18):
```typescript
export interface TerminalMessage {
  type: TerminalMessageType;
  text: string;
  toolName?: string;
  isSuccess?: boolean;
  costUsd?: number;
}
```
Plan specifies (lines 103-111):
```typescript
export interface TerminalMessage {
  type: TerminalMessageType;
  text: string;
  toolName?: string;
  toolUseId?: string;
  status?: 'running' | 'success' | 'error';
  isSuccess?: boolean;
  costUsd?: number;
}
```
This is expected — the type changes land as part of Step 1 implementation. The plan is correct.

### 5. No collapse/expand — FIXED in plan

**Plan status:** Fixed. Lines 390-421 specify collapse/expand with local `useState`, 3-line threshold, click to toggle. The note at line 421 correctly flags that `useState` inside a switch case requires extraction to a sub-component (`ToolResultMessage`).

### 6. "Completed" system message removed — FIXED in plan

**Plan status:** Fixed. Lines 502-515 specify removing the `messages.push({ type: 'system', text: 'Completed', ... })` line.

**Code status:** NOT yet implemented. `message-processor.ts` line 275 still pushes the "Completed" message. Expected.

---

## New Issues Found

### [Must-fix] Plan specifies `updateToolStatus` (Option 2) but never defines the server-to-client protocol for triggering it

**Location:** Plan lines 370-388 (Tool use status tracking)

**Issue:** The plan recommends Option 2 — a `updateToolStatus(nodeId, toolUseId, status)` method on the Zustand store. It then says (line 388): "The server broadcasts a new message type for status updates, or piggybacks on the `tool_result` message with the `toolUseId` so the client can correlate."

This is hand-waved. The plan doesn't specify:
1. What server-to-client message carries the status update. There's no `tool_status_update` message type in the `ServerMessage` union (`shared/types.ts` lines 93-101).
2. Whether `toolUseId` is included on `tool_result` messages in the `terminal_data` payload. The `tool_result` mapping (line 137) does not mention `toolUseId` on the outgoing `TerminalMessage`, and `handleUser()` (lines 207-211) only emits `type`, `text`, `toolName`, and `isSuccess`.
3. How the client knows to call `updateToolStatus`. The `useWebSocket` hook handles `terminal_data` by calling `appendMessages`. There's no path from receiving a `tool_result` message to calling `updateToolStatus`.

**Impact:** Without a defined protocol, the implementer would discover during client integration that there's no way to trigger the status update from the server. They'd need to design the protocol themselves, which could go several ways (new message type, piggybacking on existing messages, or doing the correlation entirely client-side).

**Suggested fix:** Pick one approach and specify it completely. The cleanest option: include `toolUseId` on `tool_result` messages, and have the client's `appendMessages` do the correlation. When appending a `tool_result` that has a `toolUseId`, find the matching `tool_use` in the buffer and update its status. This keeps it in the store layer without a new message type. Specifically:
1. Add `toolUseId` to the `tool_result` mapping in `handleUser()`.
2. In `useTerminal.appendMessages()`, after appending, scan incoming messages for `tool_result` entries with `toolUseId`, find matching `tool_use` entries in the buffer, and set their `status`.
3. Drop the `updateToolStatus` store method — the correlation happens inside `appendMessages`.

---

### [Medium] Collapse/expand `useState` hook inside switch case — plan notes the issue but doesn't show the corrected code

**Location:** Plan lines 401-421

**Issue:** The plan shows the full `tool_result` case with `useState` inline in the switch (lines 401-418), then adds a note at line 421 saying it "must be extracted into a sub-component (e.g., `ToolResultMessage`)." But the plan's code snippet is the WRONG version — it shows the hook inside the switch, which will violate React's rules of hooks and crash at runtime. The plan never shows what `ToolResultMessage` looks like or how the switch case dispatches to it.

An implementer following the code snippets literally will hit a React error. They'd need to read the note and refactor on their own, which is fine for an experienced dev but could cause confusion.

**Suggested fix:** Replace the inline code snippet with the sub-component version:
```tsx
// In TerminalMessageRenderer switch:
case 'tool_result':
  return <ToolResultMessage message={message} />;

// Separate component:
function ToolResultMessage({ message }: { message: TerminalMessage }) {
  const lines = message.text.split('\n');
  const isLong = lines.length > 3;
  const [isExpanded, setIsExpanded] = useState(!isLong);
  // ...rest of the rendering
}
```

---

### [Medium] `handleUser()` references `SDKUserMessage` type but it's not imported

**Location:** Plan lines 199-203

**Issue:** The plan specifies `case 'user': { messages.push(...handleUser(msg as SDKUserMessage)); }` and `function handleUser(msg: SDKUserMessage)`. But looking at the current imports in `message-processor.ts` (lines 7-14), `SDKUserMessage` is not imported from `@anthropic-ai/claude-agent-sdk`. The existing imports are: `SDKMessage`, `SDKAssistantMessage`, `SDKPartialAssistantMessage`, `SDKResultSuccess`, `SDKResultError`, `SDKSystemMessage`.

The plan should specify adding `SDKUserMessage` to the import list, or at minimum note that the type needs to be imported. If `SDKUserMessage` doesn't exist in the SDK package, the implementer would need to use a different type or `unknown` with manual type narrowing.

**Suggested fix:** Add to the plan: "Import `SDKUserMessage` from `@anthropic-ai/claude-agent-sdk`" in the `handleUser()` section. Or verify the SDK exports this type and note the verification.

---

### [Medium] `extractToolSummary` returns empty string for unknown tools, producing visually broken output

**Location:** Plan lines 148-177, specifically the `default` case at line 176

**Issue:** The `extractToolSummary` function's `default` case returns `''` (empty string). Combined with the renderer (plan lines 322-336), an unknown tool would render as:
```
● ToolName [empty space]
```
The `message.text` condition on line 330 checks `message.text &&`, which is falsy for `''`, so the dim span is not rendered. This is correct — no empty span. But it means unknown tools show only the name with no summary, while known tools with empty inputs (e.g., `Glob` with no pattern) also return the tool name as fallback. The inconsistency is minor, but the default should probably return `name` (the tool name) to be consistent with the per-tool fallbacks.

Wait — re-reading more carefully, the per-tool cases return `name` as their fallback when the specific field is missing (e.g., line 152: `return typeof inp.file_path === 'string' ? inp.file_path : name`). But the `default` returns `''`. This means:
- Known tool with missing input: shows `● ToolName ToolName` (toolName from the field + name from text)
- Unknown tool: shows `● ToolName` (toolName only, empty text hidden)

The known-tool fallback case brings back the original `ToolName ToolName` problem. If `Read` is called with no `file_path`, `extractToolSummary` returns `'Read'`, and the renderer shows `Read Read`.

**Suggested fix:** Change all per-tool fallbacks to return `''` instead of `name`, since the tool name is already displayed via `message.toolName`. The `default` case returning `''` is correct; the per-tool fallbacks returning `name` are wrong.

---

### [Low] `useTerminal.appendMessages` merge logic doesn't handle `tool_result` following `assistant_text`

**Location:** `useTerminal.ts` lines 26-37; plan lines 370-388

**Issue:** The `appendMessages` function has special merge logic for consecutive `assistant_text` messages. If tool status tracking is added to `appendMessages` (as suggested for the must-fix above), the function would need to scan the incoming batch for `tool_result` messages and correlate them with `tool_use` messages already in the buffer. This is a design consideration — the current merge logic only looks at the boundary between buffer tail and batch head, so adding a full-buffer scan for `toolUseId` correlation would be a different kind of operation.

This isn't a bug yet but a design constraint that the implementer should be aware of. If the `updateToolStatus` method approach (Option 2 in the plan) is used instead, this concern goes away — the store handles status updates via a separate method.

---

### [Low] Plan's "Issue Fixes" section for removing "Completed" message says line 275, but actual code may shift

**Location:** Plan line 509

**Issue:** The plan references `message-processor.ts:275` for the Completed message push. This matches the current code (line 275). However, once `handleUser()`, `extractToolSummary()`, and the `toolUseIdToName` map are added (all specified earlier in the plan), the line numbers will shift significantly. The plan should reference the function name (`handleResultSuccess`) rather than line numbers, or just omit line numbers.

This is a nit — the plan already says "handleResultSuccess()" in the section header. But the line reference could confuse an implementer who applies changes in a different order.

---

### [Impl-note] Spinner CSS is defined in the plan but not in flow.css

**Location:** Plan lines 339-353 (CSS for `.term-tool-spinner` and `@keyframes term-spin`)

**Issue:** The plan specifies the spinner CSS but doesn't say which file it goes in. The CSS classes for message types are in `flow.css` (lines 117-159), so the spinner should go there too. Currently `flow.css` has no `.term-tool-spinner` class. This is obvious during implementation but worth noting for completeness.

---

### [Impl-note] R1 `isSuccess` finding still applies — plan doesn't address it

**Location:** R1 review Impl-note "No rendering for tool_result isSuccess field"

**Issue:** The R1 review noted that `isSuccess` is never set by the message processor. The plan's `handleUser()` spec (line 211) now says: "Determines success/failure from the `is_error` field on the tool_result block" and "Emits `{ type: 'tool_result', text: truncated, toolName: resolvedName, isSuccess: !isError }`". This addresses the concern — `isSuccess` will be populated from the SDK's `is_error` field.

However, the current renderer still uses `isSuccess` to color a bullet (`●`) — but the plan now specifies `└` instead of a bullet. The `isSuccess` field is still on the type, used in the intermediate code, but the updated plan rendering (lines 401-418) doesn't reference `isSuccess` at all — the `└` is always dim. So `isSuccess` is now dead on the renderer side. It's still useful as metadata (and the `tool_result` CSS class in `flow.css` could use it), but the plan's code snippets for the renderer ignore it.

**Suggested fix:** Either remove `isSuccess` from the renderer entirely (keep it on the type for potential future use), or use it to color the `└` connector (green for success, red for error). The latter would be more informative.

---

### [Impl-note] R1 findings still applicable

These R1 impl-notes were not addressed by the rev 5 changes and still apply:

1. **Markdown regex order** — bold inside inline code is incorrectly processed
2. **Fenced code blocks as inline `<code>`** — no block-level styling
3. **Empty message text** — empty DOM elements with padding/margin
4. **Hardcoded code background** — `rgba(255,255,255,0.08)` won't work on light themes
5. **Dead CSS classes** — `.term-msg-*` classes in flow.css unused by renderer
6. **`<pre>` wrapping `<div>` children** — spacing inconsistencies
7. **`appendMessages` merge boundary** — only merges at buffer/batch boundary
8. **Title bar hardcoded color** — `text-[#4a4a4a]` won't adapt to themes
9. **`--term-btn-text` contrast** — potential low contrast on some themes
10. **Heading colors** — no blue color as reference specifies

These are all impl-notes (not blocking), documented here for continuity.

---

## Internal Consistency Check

The plan is internally consistent after the rev 5 edits. Specifically:

- The `TerminalMessage` type definition (lines 103-111) includes `toolUseId` and `status`, matching the tool_use mapping (line 135) and the renderer (lines 314-336).
- The `extractToolSummary` function (lines 148-177) is referenced in the mapping (line 135) and the renderer code (line 330 checks `message.text`).
- The `handleUser()` spec (lines 199-219) is consistent with the `case 'user'` addition (lines 199-204).
- The collapse/expand spec (lines 390-421) is self-consistent, with the hook-in-switch caveat noted.
- The "Completed" removal (lines 502-515) is consistent — only removes the terminal message, keeps the `updateNode` cost tracking.
- The protocol types (lines 117-124) match `shared/types.ts` lines 98-99.

One inconsistency: The plan's `TerminalMessage` type (line 107) includes `toolUseId?: string`, but the `tool_result` mapping in `handleUser()` (line 211) doesn't mention emitting `toolUseId` on the result message. The `toolUseId` is used to populate `toolUseIdToName`, but the `tool_result` TerminalMessage needs it too for client-side correlation (see must-fix above).

---

## Summary

| Severity | Count | Items |
|----------|-------|-------|
| Must-fix | 1 | `updateToolStatus` protocol undefined — no path from server to client for status updates |
| Medium | 3 | `useState` in switch case (wrong code shown), `SDKUserMessage` not imported, `extractToolSummary` per-tool fallbacks re-introduce `ToolName ToolName` |
| Low | 2 | `appendMessages` design constraint for status tracking, line number references will shift |
| Impl-note | 3 | Spinner CSS file unspecified, `isSuccess` now dead in renderer, R1 impl-notes still apply (10 items) |

The must-fix is the status tracking protocol gap. The plan defines a store method (`updateToolStatus`) and hand-waves the transport ("broadcasts a new message type or piggybacks"). An implementer following this plan would build the store method, then discover there's no way to call it from the WebSocket handler because the protocol doesn't define how status updates reach the client. This would require backtracking to redesign the message flow.

The three medium items are correctness issues that would surface during implementation but wouldn't require architectural rework — they're straightforward fixes once noticed.
