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

Added a `formatDiffSide()` helper that prefixes lines with `-` or `+`, truncating at 20 lines / 2000 chars.

In the Edit tool_use branch, attaches `diffRemoved`/`diffAdded` to the message.

### 3. `src/components/panels/TerminalMessageRenderer.tsx` — Render diff block

Expanded the `tool_use` case to conditionally render a diff block below the summary:

- Red (`--term-tool-error`) for removed lines, green (`--term-tool-success`) for added lines
- Subtle background for visual containment
- Indented under the tool summary with `ml-5`
- `whiteSpace: pre-wrap` preserves formatting
- No `dangerouslySetInnerHTML` — plain text, safe from injection
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
   - `● Edit` summary line
   - Red `-` prefixed lines for removed text
   - Green `+` prefixed lines for added text
4. Confirm long diffs truncate at ~20 lines with "... +N more lines"
5. Confirm non-Edit tools still render normally (no regressions)
