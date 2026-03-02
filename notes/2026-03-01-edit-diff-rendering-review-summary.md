# Plan Review Summary

**Plan:** notes/2026-03-01-edit-diff-rendering.md
**Rounds:** 2
**Status:** Clean — no blocking issues remain

## Issues Found & Fixed

### Round 1 → Fixed before Round 2

- **[Must-fix] `formatDiffSide` truncation logic** — char-slicing raw content before line-splitting produced garbled partial lines and incorrect "+N more lines" counts; fixed by splitting into lines first, applying line limit, then applying char budget on prefixed output, then recomputing `displayedCount` from the final result.
- **[Must-fix] Hardcoded diff background breaks light themes** — `rgba(255,255,255,0.03)` is invisible on light themes; fixed by switching to `var(--term-input-bg)`, which resolves to `rgba(0,0,0,0.05)` on light and `rgba(255,255,255,0.05)` on dark, consistent with the existing terminal chrome.
- **[Medium] "Edit Edit" duplicate display** — both `text` and `toolName` were set to the tool name, causing the tool name to render twice; fixed by overwriting `msg.text` with `inp.file_path` for Edit tool calls, so the renderer shows "Edit path/to/file.ts".

## Remaining Issues

- **[Low] `dangerouslySetInnerHTML` safety claim is scoped** — the plan's statement "No `dangerouslySetInnerHTML`" is accurate for the diff block but could be misread as applying to the whole `TerminalMessageRenderer` component, which does use it for `assistant_text`. Clarify in the plan that the claim is scoped to the diff block only.
- **[Low] Verification section omits light/colorblind theme check** — the verification checklist does not include a step to switch themes; worth adding a step to confirm diff block background and colors are visible on a light and daltonized theme.
- **[Pre-existing] `markdownToHtml` inline code background** — `rgba(255,255,255,0.08)` hardcoded in the same file; not introduced by this plan, out of scope, but flagged for a future cleanup pass.

## Implementation Notes

- **Monospace font missing on diff block** — diff content renders in the parent's system-ui font; `font-family: monospace` would improve column alignment for indentation-heavy diffs; trivial to add.
- **Very long single line truncated without indicator** — when `old_string`/`new_string` is a single line exceeding 2000 chars, the char-budget trim fires but "more lines" count is 0, so no truncation indicator is shown; consider adding "... (truncated)" in this case.
- **Empty `old_string` renders visible empty diff line** — `formatDiffSide("", "-")` returns `"- "` for pure insertion edits; consider skipping `diffRemoved` when `old_string === ""`.
- **Full absolute path in summary line may overflow** — `msg.text` is set to the raw `file_path` (e.g., `/Users/aaron/Projects/stems/src/Foo.tsx`); long paths may dominate the `text-xs` terminal line; relative or truncated path is a future enhancement.
- **`ml-5` indent coupling** — the diff block's `ml-5` indent assumes a fixed bullet/icon width; if the tool summary icon ever changes size, the indent could misalign; fine for v1.
- **No accessibility context on diff block** — a future pass could add `role="group" aria-label="File diff"` for screen reader support.
- **Pre-existing: `text`/`toolName` duplication on non-Edit tools** — all non-Edit `tool_use` messages still render the tool name twice (e.g., "Bash Bash"); not introduced by this plan, but worth a cleanup pass.
- **Type contract confirmed clean** — `diffRemoved`/`diffAdded` as optional strings on `TerminalMessage` flow correctly through `shared/types.ts` → `message-processor.ts` → `broadcastTerminal` → WebSocket JSON → client Zustand store → `TerminalMessageRenderer`; terminal replay path also preserves diff fields.
- **Buffer merging does not affect diff data** — `appendTerminalMessages` only merges consecutive `assistant_text` messages; `tool_use` messages with diff data are never merged; no data loss path.

## Reviewer Personas Used

1. **Architect** — Data flow soundness, structural gaps, contract mismatches
2. **Frontend/UX specialist** — Rendering correctness, theme compatibility, accessibility
3. **Data integrity reviewer** — Type contracts, serialization, truncation logic
