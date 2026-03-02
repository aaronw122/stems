# Review: Edit Tool Diff Rendering Plan
**Reviewer:** Frontend/UX specialist (Agent 2, R1)
**Plan file:** `notes/2026-03-01-edit-diff-rendering.md`

---

## Issues

### 1. [Must-fix] Hardcoded diff background breaks on light themes

**Section:** `TerminalMessageRenderer.tsx` rendering / Plan Section 3

**Problem:** The diff container uses a hardcoded `backgroundColor: 'rgba(255,255,255,0.03)'` (line 103 of the renderer). This assumes a dark background. On the three light themes (`light`, `light-daltonized`, `light-ansi`), where `--term-bg` is `rgb(245,245,245)`, white-on-white at 3% opacity is invisible — there is no visual containment at all. The plan claims "Existing theme variables work across all 6 themes including colorblind variants" but this background literal contradicts that.

**Why plan-level:** The plan explicitly states 6-theme compatibility as a design goal. Getting this wrong means the diff block has no visual boundary on 50% of supported themes. Fixing this during implementation would require either a new CSS variable or a conditional expression — an architectural choice, not a tweak.

**Fix:** Either:
- (a) Add a `--term-diff-bg` token to `ThemeTokens` (light themes get `rgba(0,0,0,0.03)`, dark themes keep `rgba(255,255,255,0.03)`), or
- (b) Use a theme-aware expression already available, e.g. `--term-input-bg` which is already resolved per-variant (`rgba(255,255,255,0.05)` dark / `rgba(0,0,0,0.05)` light) and exists for exactly this kind of subtle tinted background.

Option (b) avoids adding a new variable. Mention whichever approach in the plan.

---

### 2. [Medium] Duplicate tool name rendered in `tool_use` row

**Section:** Plan Section 3 / `TerminalMessageRenderer.tsx` lines 86-97

**Problem:** The message processor sets both `text` and `toolName` to the same value (the tool name string): `{ type: 'tool_use', text: name, toolName: name }`. The renderer then displays both: `toolName` in `--term-tool-name` color, and `text` in `--term-text-dim` color. For Edit tool calls, this produces:

```
● Edit Edit
```

This is a pre-existing issue (not introduced by the diff plan), but the plan adds a diff block directly below this duplicated line, making it more visually prominent. The plan should acknowledge this or include a fix.

**Why plan-level:** The diff block hangs off the tool_use summary line. If the summary line itself is wrong, the diff rendering inherits a confusing parent context. Also, fixing the summary text later changes the visual hierarchy the diff block was designed around.

**Fix:** In the plan's message-processor section, note that `text` should carry meaningful summary info (e.g. the file path from `inp.file_path`) rather than duplicating the tool name. For Edit specifically: `text: inp.file_path ?? name` would produce `● Edit src/foo.ts` followed by the diff — much more useful.

---

### 3. [Medium] `formatDiffSide` truncation logic uses two different line sources

**Section:** Plan Section 2 / `server/message-processor.ts` lines 68-81

**Problem:** The function splits `content` (original, full string) into `allLines`, but splits `text` (char-truncated string) into `lines`. When `DIFF_MAX_CHARS` truncation fires, `text.split('\n')` produces a final line that is a mid-line fragment. This fragment gets displayed as a diff line, then the "more lines" count is computed against `allLines.length` (which can be much larger). The result is:

1. A garbled partial line at the truncation boundary
2. An inaccurate "+N more lines" count (counts lines that were char-truncated away, not just line-truncated)

**Why plan-level:** The plan specifies truncation behavior ("truncating at 20 lines / 2000 chars") as a feature with a specific user-facing message format. Getting the truncation semantics wrong produces confusing output. The two truncation dimensions (lines vs chars) need a single coherent strategy decided at plan time.

**Fix:** Pick one truncation dimension as primary. Recommended: split into lines first, take up to `DIFF_MAX_LINES`, then check total char length of those lines. If still over `DIFF_MAX_CHARS`, trim the line array further. Always compute the "+N more" count from the original `allLines.length`. Outline this in the plan.

---

### 4. [Low] Plan verification section omits light theme testing

**Section:** Verification (Section 5)

**Problem:** The verification checklist says to confirm rendering works, but does not mention switching themes. Given the light-theme background issue above and 6 defined themes, the plan should include at least one verification step for a light theme and one for a colorblind variant.

**Fix:** Add to verification: "6. Switch to light theme and a daltonized theme — confirm diff block background and colors remain visible and distinguishable."

---

## Impl-notes (not plan-level, log for implementation)

- **Impl-note 1:** The `text-xs leading-4` on the diff container (line 101 of renderer) gives a 16px line height on ~12px text. This is reasonable but may feel loose for dense diffs. Can be tightened during implementation if it looks off.

- **Impl-note 2:** The diff block has no `font-family: monospace` declaration. Since it lives inside a `<pre>`-like context with `whiteSpace: pre-wrap`, the diff lines will render in the parent's font (system-ui). Monospace would improve diff readability. Low priority, trivial to add.

- **Impl-note 3:** No `aria-label` or screen-reader context on the diff block. A future accessibility pass could add `role="group" aria-label="File diff"` or similar. Not blocking.

- **Impl-note 4:** The `ml-5` indent on the diff block is a Tailwind spacing value (1.25rem). If the tool summary bullet/icon width ever changes, this indent could misalign. Minor, fine for v1.

---

## Summary

| Severity | Count | Issues |
|----------|-------|--------|
| Must-fix | 1 | Hardcoded dark-only diff background |
| Medium | 2 | Duplicate tool name in summary; truncation logic incoherence |
| Low | 1 | No light/colorblind theme in verification steps |
| Impl-note | 4 | Spacing, monospace font, a11y, indent coupling |

The plan is clean and well-scoped overall. The must-fix is a real theme compatibility gap that the plan's own goals surface — easy to address by referencing an existing CSS variable. The medium issues are worth deciding at plan time to avoid rework during implementation.
