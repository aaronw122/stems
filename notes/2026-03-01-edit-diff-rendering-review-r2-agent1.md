# Architect Review (Round 2): Edit Diff Rendering

**Reviewer:** Agent 1 (Architect)
**Plan:** `notes/2026-03-01-edit-diff-rendering.md`
**Files reviewed:** `shared/types.ts`, `server/message-processor.ts`, `src/components/panels/TerminalMessageRenderer.tsx`

---

## Round 1 Issue Verification

### Issue 1: `formatDiffSide` truncation logic — FIXED

**R1 problem:** Char-slicing before line-splitting could produce a garbled partial last line, and the "more lines" count was computed from the original content's line count rather than the count of actually-displayed lines after char truncation.

**Current state (lines 68-83 of message-processor.ts):** The function now:
1. Splits into lines first (`allLines`)
2. Applies the line limit (slice to `DIFF_MAX_LINES`)
3. Joins with prefixes, then checks the char budget
4. On char overflow, trims back to the last complete newline (`lastIndexOf('\n')`)
5. Computes `displayedCount` from the final result's actual line count
6. Appends "more lines" using `allLines.length - displayedCount`

This is correct. The "more lines" count accurately reflects how many original lines are not displayed, regardless of whether truncation was by line limit, char limit, or both.

**Verdict: Fixed. No residual issues.**

---

### Issue 2: Hardcoded `rgba(255,255,255,0.03)` background — FIXED

**R1 problem:** The diff container used a hardcoded white-based rgba background that wouldn't work on light themes.

**Current state (line 102 of TerminalMessageRenderer.tsx):** Now uses `var(--term-input-bg)`, which resolves to `rgba(255,255,255,0.05)` on dark themes and `rgba(0,0,0,0.05)` on light themes (confirmed in `themes.ts` line 146). This is the same variable used by the terminal input areas in `TerminalPeek.tsx`, so it's consistent with the existing design system.

**Verdict: Fixed. No residual issues.**

---

### Issue 3: `text` and `toolName` both "Edit" — FIXED

**R1 problem:** For Edit tool calls, both `text` and `toolName` were set to the tool name, producing `Edit Edit` in the rendered output.

**Current state (lines 212-217 of message-processor.ts):** The message is initialized with `text: name, toolName: name`, but immediately after, for Edit tools, `msg.text` is overwritten with `inp.file_path` when available. This means the rendered output shows `Edit path/to/file.ts` — tool name in the styled span, file path in the dim text span.

One subtlety: if `file_path` is missing or not a string, the fallback is still `name` (i.e., "Edit"). This is acceptable — the Edit tool's `file_path` is a required parameter in Claude's tool schema, so the missing case is a defensive guard, not a realistic path.

**Verdict: Fixed. No residual issues.**

---

## New Issues Introduced by Fixes

None found. The fixes are minimal and surgical — no new data flow paths, no new type contracts, no new component structure. Specifically verified:

- **Type contract unchanged:** `diffRemoved` and `diffAdded` remain `string | undefined` on `TerminalMessage`. No new fields were added.
- **No regression on non-Edit tools:** The `file_path` override (line 215-217) is gated behind `name === 'Edit'`, so other tool_use messages still get `text: name` as before.
- **Theme variable exists and is typed:** `--term-input-bg` is declared in `types.ts` line 36 and computed in `themes.ts` line 146 for all theme variants. No missing-variable risk.
- **Terminal replay:** `TerminalMessage` objects with diff fields serialize through `JSON.stringify` identically to before. Replay works.

---

## Overall Assessment

All three Round 1 issues are properly resolved. No new issues introduced. The implementation matches the updated plan.

**Recommendation: Approve — no blocking issues, no new findings.**
