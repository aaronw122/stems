# Plan: Edit Tool Diff Rendering in Terminal Peek

## Context

The Stems terminal peek window shows tool events but discards Edit tool diff data (`old_string`/`new_string`). Claude Code CLI shows a colored diff with removed lines in red and added lines in green. This plan adds that rendering to Stems.

## Approach

Add two optional fields to `TerminalMessage`, capture the diff data server-side, and render it inline below the tool call summary. No new files, components, or libraries.

## Files Modified (3)

### 1. `shared/types.ts` — Add diff fields

```ts
export interface TerminalMessage {
  // ... existing fields ...
  diffRemoved?: string;  // old_string lines prefixed with "- "
  diffAdded?: string;    // new_string lines prefixed with "+ "
}
```

### 2. `server/message-processor.ts` — Capture diff data

Added a `formatDiffSide()` helper that prefixes lines with `-` or `+`, truncating at 20 lines / 2000 chars. The function splits into lines first, applies the line limit, then checks the char budget — trimming to the last complete line to avoid garbled partial lines. The "more lines" count is computed from original line count minus actually displayed lines.

In the Edit tool_use branch, attaches `diffRemoved`/`diffAdded` to the message. Also sets `msg.text` to `file_path` (instead of tool name) so the display reads `Edit path/to/file.ts` rather than `Edit Edit`.

### 3. `src/components/panels/TerminalMessageRenderer.tsx` — Render diff block

Expanded the `tool_use` case to conditionally render a diff block below the summary:

- Red (`--term-tool-error`) for removed lines, green (`--term-tool-success`) for added lines
- Subtle background via `var(--term-input-bg)` for visual containment (adapts to light/dark themes)
- Indented under the tool summary with `ml-5`
- `whiteSpace: pre-wrap` preserves formatting
- No `dangerouslySetInnerHTML` in the diff block — plain text, safe from injection (note: `assistant_text` elsewhere in the component does use it for markdown rendering)
- Existing theme variables work across all 6 themes including colorblind variants

## What we're NOT doing

- No diff library — `old_string`/`new_string` are already the exact hunks
- No Write tool diffs — Write creates files, no "before" to diff against
- No new CSS variables — existing error/success colors are correct
- No collapsible/expandable UI — keep it simple for v1

## Verification

1. `bun run dev`
2. Spawn a feature node, send a prompt that triggers an Edit
3. Confirm the Edit tool call shows:
   - `● Edit path/to/file.ts` summary line (file path, not tool name repeated)
   - Red `-` prefixed lines for removed text
   - Green `+` prefixed lines for added text
4. Confirm long diffs truncate at ~20 lines with "... +N more lines"
5. Confirm non-Edit tools still render normally (no regressions)
6. Switch to a light theme and a colorblind theme — confirm diff block background and red/green colors are visible
