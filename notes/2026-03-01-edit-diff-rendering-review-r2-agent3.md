# Review: Edit Diff Rendering — Data Integrity (Round 2, Agent 3)

**Reviewer focus:** Type contract consistency, serialization correctness, truncation logic, string processing edge cases.

**Prior round issues:**
1. `formatDiffSide` truncation logic (must-fix) — char-slicing before line-splitting
2. Hardcoded background color (must-fix) — should use theme variable
3. "Edit Edit" display (medium) — text should be file path

**Files reviewed:**
- `shared/types.ts`
- `server/message-processor.ts`
- `src/components/panels/TerminalMessageRenderer.tsx`
- `server/state.ts`

---

## Round 1 Issue Verification

### Issue 1 — `formatDiffSide` truncation logic: FIXED

The function now correctly splits into lines first, then applies the line limit, then applies the char budget on the already-prefixed result:

```ts
function formatDiffSide(content: string, prefix: string): string {
  const allLines = content.split('\n');
  const display = allLines.length > DIFF_MAX_LINES ? allLines.slice(0, DIFF_MAX_LINES) : allLines;
  let result = display.map(l => `${prefix} ${l}`).join('\n');
  if (result.length > DIFF_MAX_CHARS) {
    result = result.slice(0, DIFF_MAX_CHARS);
    const lastNewline = result.lastIndexOf('\n');
    if (lastNewline > 0) result = result.slice(0, lastNewline);
  }
  const displayedCount = result.split('\n').length;
  if (allLines.length > displayedCount) {
    result += `\n${prefix} ... +${allLines.length - displayedCount} more lines`;
  }
  return result;
}
```

The core problem from R1 (char-slicing the raw content *before* line-splitting, producing garbled partial lines and incorrect "more lines" counts) is resolved. Lines are split first from the original content (`allLines`), then limited to `DIFF_MAX_LINES`, then prefixed and joined, and only then is the char budget applied — trimming to the last complete newline boundary. The "more lines" count compares `allLines.length` (total original lines) against `displayedCount` (lines actually in the output after both limits), which is now a single consistent source of truth.

**Verdict:** Fixed correctly.

### Issue 2 — Hardcoded background color: FIXED

The diff block in `TerminalMessageRenderer.tsx` uses `var(--term-input-bg)` (line 102):

```tsx
style={{ backgroundColor: 'var(--term-input-bg)' }}
```

This variable is defined in `themes.ts` as `isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'` and declared in the `TerminalThemeVars` type interface (`types.ts` line 36). It adapts correctly across all 6 themes including light and colorblind variants.

**Verdict:** Fixed correctly.

**Note:** The `markdownToHtml` function in the same file still uses hardcoded `rgba(255,255,255,0.08)` for inline code backgrounds (lines 19 and 25). This was flagged in other review tracks and is out of scope for this diff-rendering plan, but it remains a pre-existing issue.

### Issue 3 — "Edit Edit" display: FIXED

In `message-processor.ts`, the Edit tool branch now sets `msg.text` to the file path instead of the tool name (lines 213-217):

```ts
if (name === 'Edit' && input && typeof input === 'object') {
  const inp = input as Record<string, unknown>;
  if (typeof inp.file_path === 'string') {
    msg.text = inp.file_path;
  }
  ...
}
```

The initial assignment is `{ type: 'tool_use', text: name, toolName: name }` (line 212), so for non-Edit tools `text` and `toolName` both remain the tool name. For Edit tools, `text` is overwritten with the file path, so the renderer displays "Edit path/to/file.ts" — `toolName` in accent color, `text` (file path) in dim text. This matches the plan's verification criteria.

**Verdict:** Fixed correctly.

---

## New Issues Check

### No new issues found

I examined the following areas for regressions or new problems introduced by the fixes:

**1. Type contract consistency:** `TerminalMessage.diffRemoved` and `diffAdded` remain optional strings in `shared/types.ts` (lines 18-19). The server writes them conditionally (only when `inp.old_string` / `inp.new_string` are strings), and the client checks with `message.diffRemoved || message.diffAdded` before rendering. The `satisfies ServerMessage` assertion on `broadcastTerminal`'s JSON payload (state.ts line 221) ensures the terminal_data envelope is type-checked. No contract mismatch.

**2. Serialization path:** `broadcastTerminal` calls `appendTerminalMessages` (stores to buffer) then `JSON.stringify` for WebSocket send. Both paths handle the full `TerminalMessage` object including optional `diffRemoved`/`diffAdded`. The `terminal_replay` path in the subscribe handler sends the same `TerminalMessage[]` from `getTerminalMessages`. Diff fields survive the full roundtrip: server creation -> buffer storage -> JSON serialization -> client Zustand store -> renderer.

**3. `formatDiffSide` edge cases:**
- **Empty string:** `formatDiffSide("", "-")` produces `"- "` (one line with prefix and trailing space). This renders as a visible but semantically empty diff line. Acceptable for v1 — the plan notes this as an impl-note. The conditional `if (typeof inp.old_string === 'string')` means truly absent fields produce no diff, and only explicit empty strings produce the empty line.
- **Single-line content:** Works correctly — `allLines` has 1 element, no truncation triggers, no "more lines" suffix.
- **Exactly 20 lines / exactly 2000 chars:** Both boundary conditions are handled without off-by-one. `allLines.length > DIFF_MAX_LINES` uses strict `>`, so exactly 20 lines pass through without truncation. The char check `result.length > DIFF_MAX_CHARS` likewise uses strict `>`.
- **Content with trailing newline:** `"foo\n".split('\n')` produces `["foo", ""]`, so a trailing newline creates an extra empty line entry. This is standard JS behavior and doesn't cause problems — the empty line gets prefixed to `"- "` which is visually fine.
- **Very long single line (>2000 chars):** After prefixing and joining, `result` exceeds `DIFF_MAX_CHARS`. The char-budget trim does `result.slice(0, 2000)` then looks for `lastIndexOf('\n')`. If there's only one line, `lastNewline` is `-1` or `0`, so the `if (lastNewline > 0)` guard prevents trimming to nothing. The result is a truncated single line (cut mid-content). The "more lines" count then shows `allLines.length - 1` which is `0`, so no suffix is added. This means a very long single line gets silently truncated without indicator. This is a minor edge case — see impl-note below.

**4. Buffer merging (state.ts):** The `appendTerminalMessages` function only merges consecutive `assistant_text` messages. `tool_use` messages with diff data are never merged. Confirmed no data loss path.

**5. Renderer (TerminalMessageRenderer.tsx):** The diff block renders inside the `tool_use` case (lines 99-115). It uses `whiteSpace: 'pre-wrap'` which correctly preserves the prefixed formatting from `formatDiffSide`. The theme variable `--term-input-bg` is applied. No `dangerouslySetInnerHTML` is used for diff content — it's plain text via `{message.diffRemoved}`.

---

## Impl-notes

### 1. [Impl-note] Very long single line truncated without indicator

When `old_string` or `new_string` is a single line exceeding 2000 characters, `formatDiffSide` truncates via `result.slice(0, DIFF_MAX_CHARS)` but the "more lines" check sees `allLines.length - displayedCount = 1 - 1 = 0` and adds no suffix. The user sees a cut-off line with no visual cue. Consider adding a "... (truncated)" indicator when char-budget trimming removes content from the last displayed line. Fine to address during implementation.

### 2. [Impl-note] Empty `old_string` produces visible empty diff line

Carried from R1. When `old_string` is `""` (pure insertion), `formatDiffSide("", "-")` returns `"- "`. This renders as a single red line with just a dash. Consider skipping `diffRemoved` when `old_string === ""`. Low priority — the visual impact is minimal.

---

## Summary

| # | R1 Issue | Status |
|---|----------|--------|
| 1 | `formatDiffSide` char-before-line truncation (must-fix) | **Fixed** |
| 2 | Hardcoded background color (must-fix) | **Fixed** |
| 3 | "Edit Edit" display (medium) | **Fixed** |

| # | New Issue | Severity |
|---|-----------|----------|
| — | None | — |

| # | Impl-note | Description |
|---|-----------|-------------|
| 1 | Single long line truncated silently | No "truncated" indicator when char-budget cuts a single line |
| 2 | Empty `old_string` empty diff line | Carried from R1 — `"- "` rendered for pure insertions |

**Overall assessment:** All three Round 1 issues have been properly addressed. The `formatDiffSide` truncation logic now correctly splits lines first, applies limits in the right order, and computes "more lines" from a single consistent source. The background color uses a theme-aware CSS variable. The Edit tool display shows the file path instead of repeating the tool name. No new issues were introduced by the fixes. The type contracts remain consistent across all boundaries (shared types -> server processor -> WebSocket serialization -> client store -> renderer). The implementation is ready to proceed.
