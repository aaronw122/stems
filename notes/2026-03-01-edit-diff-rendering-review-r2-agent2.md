# Review: Edit Tool Diff Rendering — Round 2
**Reviewer:** Frontend/UX specialist (Agent 2, R2)
**Plan file:** `notes/2026-03-01-edit-diff-rendering.md`
**Prior round:** `notes/2026-03-01-edit-diff-rendering-review-r1-agent2.md`

---

## Round 1 Issue Verification

### Issue 1: `formatDiffSide` truncation logic bug — FIXED

**R1 problem:** The function split two different strings (`content` for line count, `text` for char-truncated output), producing a garbled partial line at the truncation boundary and an inaccurate "+N more lines" count.

**What changed:** `formatDiffSide()` (lines 68-83 of `server/message-processor.ts`) now follows the recommended approach:
1. Splits `content` into `allLines` once (line 69)
2. Applies the line limit first: `allLines.slice(0, DIFF_MAX_LINES)` (line 70)
3. Joins the prefixed display lines, then checks char budget (line 72)
4. When char-truncating, trims to `lastIndexOf('\n')` to avoid garbled partial lines (lines 75-76)
5. Recomputes `displayedCount` from the final result (line 78), and uses `allLines.length` as the denominator for the "+N more" count (line 79-80)

This is correct. The two truncation dimensions (line count, then char budget) are applied in sequence on a single source, and the "more lines" message always references the original line count. No further issue.

---

### Issue 2: Hardcoded background color breaks light themes — FIXED

**R1 problem:** The diff container used `backgroundColor: 'rgba(255,255,255,0.03)'`, which is invisible on light-background themes.

**What changed:** `TerminalMessageRenderer.tsx` line 102 now uses:
```tsx
style={{ backgroundColor: 'var(--term-input-bg)' }}
```

This references the theme-aware token defined in `src/themes/themes.ts` line 146:
```ts
'--term-input-bg': isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
```

This resolves correctly for all 6 themes — dark variants get a white-on-dark tint, light variants get a black-on-light tint. The same variable is already used for the terminal input area (`TerminalPeek.tsx` lines 238, 260), so this is visually consistent with the rest of the terminal chrome.

No further issue.

---

### Issue 3: "Edit Edit" display — text should be file path — FIXED

**R1 problem:** `msg.text` was set to the tool name, producing `Edit Edit` in the UI (tool name shown twice: once from `toolName`, once from `text`).

**What changed:** `server/message-processor.ts` lines 213-217:
```ts
if (name === 'Edit' && input && typeof input === 'object') {
  const inp = input as Record<string, unknown>;
  if (typeof inp.file_path === 'string') {
    msg.text = inp.file_path;
  }
```

When the Edit tool has a `file_path` in its input, `msg.text` is set to the file path instead of the tool name. The renderer then displays `toolName` ("Edit") followed by `text` (the file path), producing something like `Edit src/foo.ts`.

The fallback is also correct: if `file_path` is missing or not a string (unlikely but defensive), `msg.text` retains the default value of `name` ("Edit"), which gracefully degrades to the old "Edit Edit" behavior rather than crashing. This is fine for v1 — the Claude CLI Edit tool always provides `file_path`, so the fallback should never fire in practice.

No further issue.

---

## New Issue Scan

I reviewed the full implementation across all four files for new problems introduced by these changes.

### No new plan-level issues found

The implementation is clean and well-scoped. The three Round 1 fixes were applied as recommended without introducing new architectural concerns.

---

## Impl-notes (not plan-level, log for implementation)

- **Impl-note 1 (carried from R1):** The diff block still has no `font-family: monospace` declaration. Diff content renders in the parent's system-ui font. Monospace would improve column alignment for diffs that include indentation changes. Trivial to add during implementation.

- **Impl-note 2 (carried from R1):** No `aria-label` or screen-reader context on the diff block. A future accessibility pass could add `role="group" aria-label="File diff"`.

- **Impl-note 3 (new):** The `markdownToHtml` function (lines 18-19, 23-24) uses hardcoded `rgba(255,255,255,0.08)` for inline code backgrounds. This has the same light-theme issue that was just fixed for the diff block. Not introduced by this change (pre-existing), and not in scope for the diff rendering plan, but worth noting for a future cleanup pass.

- **Impl-note 4 (new):** The diff file path displayed via `msg.text` is the full absolute path (e.g., `/Users/aaron/Projects/stems/src/components/Foo.tsx`). In the terminal peek at `text-xs`, long paths may overflow or dominate the line. A future enhancement could show a relative or truncated path. Not blocking for v1.

---

## Summary

| Round 1 Issue | Status |
|---------------|--------|
| `formatDiffSide` truncation logic bug | Fixed correctly |
| Hardcoded background breaks light themes | Fixed correctly — uses `var(--term-input-bg)` |
| "Edit Edit" duplicate display | Fixed correctly — shows file path |

| New Issues | Count |
|------------|-------|
| Plan-level (Critical/Must-fix/Medium/Low) | 0 |
| Impl-notes | 4 (2 carried, 2 new) |

All three Round 1 issues have been properly addressed. No new plan-level issues were introduced. The implementation is ready to proceed.
