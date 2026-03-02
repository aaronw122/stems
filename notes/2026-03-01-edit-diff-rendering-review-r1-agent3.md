# Review: Edit Diff Rendering Plan — Data Integrity (Agent 3)

**Reviewer focus:** Type contract consistency across shared/server/client boundaries, serialization/deserialization correctness, truncation and data transformation logic, WebSocket message fidelity, and edge cases in string processing.

**Files reviewed:**
- Plan: `notes/2026-03-01-edit-diff-rendering.md`
- Implementation: `shared/types.ts`, `server/message-processor.ts`, `src/components/panels/TerminalMessageRenderer.tsx`, `server/state.ts`
- Supporting: `src/hooks/useWebSocket.ts`, `src/hooks/useTerminal.ts`

---

## Issues

### 1. [Must-fix] `formatDiffSide` truncation uses two different sources for line counting, producing incorrect "more lines" counts

**Plan section:** Section 2 — `server/message-processor.ts`

**Problem:** The `formatDiffSide` function splits two different strings into lines:

```ts
let text = content;
if (text.length > DIFF_MAX_CHARS) {
  text = text.slice(0, DIFF_MAX_CHARS);   // truncated copy
}
const allLines = content.split('\n');      // lines from ORIGINAL
const lines = text.split('\n');            // lines from TRUNCATED
const display = lines.length > DIFF_MAX_LINES ? lines.slice(0, DIFF_MAX_LINES) : lines;
```

When `content` exceeds `DIFF_MAX_CHARS`, `text` is truncated mid-stream. The `text.slice(0, 2000)` will likely cut a line in half, so `lines` (from truncated text) may contain a partial final line that gets displayed. Then the "more lines" suffix compares `allLines.length` (original) against `display.length` (truncated + line-limited), which double-counts the truncation — the count is neither "lines dropped by char truncation" nor "lines dropped by line limit", but a muddled combination.

Concrete example: Content has 50 lines, 4000 chars. Char truncation at 2000 cuts mid-line-25. `allLines` = 50, `lines` = 25 (with partial last line), `display` = 20 (line-limited). Suffix says "+30 more lines" but the 20th displayed line is correct content while line 25 in `lines` is garbled.

**Why this is plan-level:** The plan specifies "truncating at 20 lines / 2000 chars" as a design constraint. The implementation has a logic error in how those two limits interact. The truncation strategy itself needs to be corrected — char truncation should happen *after* line splitting, or the partial line from char truncation should be dropped.

**Suggested fix:** Split into lines first, then apply both limits:

```ts
function formatDiffSide(content: string, prefix: string): string {
  const allLines = content.split('\n');
  const display = allLines.slice(0, DIFF_MAX_LINES);
  // Apply char limit to the displayed portion
  let result = '';
  let charCount = 0;
  let linesUsed = 0;
  for (const line of display) {
    const prefixed = `${prefix} ${line}`;
    if (charCount + prefixed.length > DIFF_MAX_CHARS) break;
    result += (linesUsed > 0 ? '\n' : '') + prefixed;
    charCount += prefixed.length + 1;
    linesUsed++;
  }
  const remaining = allLines.length - linesUsed;
  if (remaining > 0) {
    result += `\n${prefix} ... +${remaining} more lines`;
  }
  return result;
}
```

---

### 2. [Medium] Plan does not mention that `tool_use` text field becomes redundant with `toolName` for Edit calls

**Plan section:** Section 2 — `server/message-processor.ts`

**Problem:** In the implementation, the `tool_use` message is constructed as:

```ts
const msg: TerminalMessage = { type: 'tool_use', text: name, toolName: name };
```

Both `text` and `toolName` are set to `name` (e.g., `"Edit"`). The renderer then displays both:

```tsx
<span style={{ color: 'var(--term-tool-name)' }}>{message.toolName}</span>
<span style={{ color: 'var(--term-text-dim)' }}>{message.text}</span>
```

For Edit tool calls, this renders "Edit Edit" — the tool name in accent color followed by the same string in dim text. The plan says "● Edit summary line" as expected output but doesn't address that the summary text is just the tool name repeated.

**Why this is plan-level:** This is a visual design inconsistency that the plan should address — the `text` field for `tool_use` Edit messages should contain the file path or a more useful summary rather than duplicating the tool name. This affects the user-facing output described in the Verification section.

**Suggested fix:** For Edit tool calls, set `text` to the file path from `inp.file_path` (truncated if needed) rather than the tool name. Example: `"Edit src/components/Foo.tsx"` where `toolName` is `"Edit"` and `text` is the file path. This matches Claude Code CLI's native output format.

---

### 3. [Low] Plan claims "No `dangerouslySetInnerHTML`" but this only applies to the diff block — the parent component uses it for `assistant_text`

**Plan section:** Section 3 — Safety claim

**Problem:** The plan states "No `dangerouslySetInnerHTML` — plain text, safe from injection" as a notable property. This is accurate for the diff rendering specifically, but could be misleading since the same component file *does* use `dangerouslySetInnerHTML` for `assistant_text` messages (line 78 of `TerminalMessageRenderer.tsx`). The diff data itself is rendered as plain text via `{message.diffRemoved}`, which is correct.

**Why this is plan-level (barely):** This is a documentation accuracy issue in the plan. No architectural change needed — just noting that the safety claim is scoped to the diff block, not the component as a whole.

**Suggested fix:** Clarify in the plan: "Diff block uses plain text rendering (no `dangerouslySetInnerHTML`) — diff strings from `old_string`/`new_string` are safe from injection."

---

### 4. [Impl-note] Empty string handling in `formatDiffSide`

When `old_string` is `""` (empty string, valid for Edit tool insertions), `formatDiffSide("", "-")` returns `"- "` — a single prefix with trailing space. This renders as a visible but empty diff line. Not wrong per se, but the plan could note that empty `old_string` is expected for pure insertions. This is fine to handle during implementation — e.g., skip `diffRemoved` when `old_string` is empty.

---

### 5. [Impl-note] Server-side buffer merging in `appendTerminalMessages` only merges `assistant_text` — diff data on `tool_use` messages is preserved

Verified: The `appendTerminalMessages` function in `state.ts` only merges consecutive `assistant_text` messages. Since diff data lives on `tool_use` messages, it is not affected by the merge logic. The `terminal_replay` path also sends the full `TerminalMessage[]` array including diff fields, so replayed messages will render diffs correctly. No issue here — just confirming the data path is intact.

---

## Summary

| # | Severity | Issue |
|---|----------|-------|
| 1 | **Must-fix** | `formatDiffSide` char-truncation and line-truncation interact incorrectly, producing garbled partial lines and wrong "more lines" counts |
| 2 | **Medium** | Edit tool `text` field duplicates `toolName`, causing "Edit Edit" in the rendered output |
| 3 | **Low** | Plan's safety claim about `dangerouslySetInnerHTML` is accurate but could be misread as applying to the whole component |
| 4 | Impl-note | Empty `old_string` produces a visible but empty diff line |
| 5 | Impl-note | Server buffer merging and replay path correctly preserve diff data (no issue) |

**Overall assessment:** The type contracts are consistent across all boundaries — `TerminalMessage` with `diffRemoved`/`diffAdded` as optional strings flows correctly through `shared/types.ts` → `message-processor.ts` → `broadcastTerminal` → WebSocket JSON serialization → client `useTerminal` store → `TerminalMessageRenderer`. The main issue is the `formatDiffSide` truncation logic (Issue 1), which will produce visibly incorrect output for diffs exceeding 2000 characters. Issue 2 is a UX gap the plan should address.
