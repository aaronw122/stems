# Architect Review: Edit Diff Rendering Plan

**Reviewer:** Agent 1 (Architect)
**Plan:** `notes/2026-03-01-edit-diff-rendering.md`
**Files compared:** `shared/types.ts`, `server/message-processor.ts`, `src/components/panels/TerminalMessageRenderer.tsx`

---

## Summary

The plan is compact and well-scoped. Implementation matches the plan in all three files. The type contract between server and client is consistent — `diffRemoved` and `diffAdded` are optional strings on `TerminalMessage`, populated server-side, consumed client-side. No new message types, no new WebSocket events, no new components. Data flows cleanly through the existing `broadcastTerminal` pipeline.

No critical or must-fix issues found. A few medium and low-severity items below.

---

## Issues

### 1. [Medium] `formatDiffSide` char-truncation can produce a garbled last displayed line

**Section:** `server/message-processor.ts` — Diff formatting for Edit tool (lines 68-81)

**Problem:** When `content.length > DIFF_MAX_CHARS` (2000), the function slices at the char boundary, which can cut mid-line. The truncated `text` is then split into lines, so the last line in the displayed output may be an incomplete fragment. The "... +N more lines" trailer counts from the *original* content's line count, so it correctly reports omitted lines — but the visual result includes a broken partial line followed by the trailer.

**Impact:** Cosmetic — users see a chopped line. Not architecturally wrong, but noticeable.

**Suggested fix (Impl-note):** This is tuning-level detail. During implementation, consider truncating to the last complete newline within the char budget rather than slicing mid-line. But this is not a plan-level issue — log as an Impl-note.

**Verdict: Impl-note** — better discovered during implementation.

---

### 2. [Low] Plan claims "No `dangerouslySetInnerHTML`" — accurate, but worth noting the asymmetry

**Section:** Plan section 3 (TerminalMessageRenderer), bullet: "No `dangerouslySetInnerHTML` — plain text, safe from injection"

**Problem:** This is correct for the diff rendering. However, the same component uses `dangerouslySetInnerHTML` for `assistant_text` messages (line 78 of the renderer). The plan's claim is locally accurate but could mislead a reader into thinking the entire component avoids it.

**Impact:** None architecturally. The diff data is rendered as plain text via `{message.diffRemoved}`, which is safe. The assistant_text path is a separate concern. No action needed.

**Verdict: Low** — no fix required, just noting for completeness.

---

### 3. [Low] Hardcoded background color in renderer instead of theme variable

**Section:** Plan section 3 (TerminalMessageRenderer) — diff block container

**Problem:** The diff container uses `backgroundColor: 'rgba(255,255,255,0.03)'` (renderer line 102). The plan says "No new CSS variables — existing error/success colors are correct" and "Existing theme variables work across all 6 themes including colorblind variants." The text colors correctly use theme vars, but the background is hardcoded. On a light theme, `rgba(255,255,255,0.03)` would be invisible or wrong.

**Impact:** If a light theme is ever added, this background won't provide visual containment. All 6 current themes are dark, so it works today. But it contradicts the plan's implicit claim of full theme compatibility.

**Suggested fix:** Consider using a theme variable for the diff block background (e.g., `--term-diff-bg` or repurposing an existing subtle background var). Alternatively, accept this as a known limitation for v1 since all themes are dark.

**Verdict: Low** — all current themes are dark. Worth a one-line fix if convenient, not worth blocking on.

---

### 4. [Medium] `tool_use` text and toolName both set to the same value — diff appears under duplicated label

**Section:** `server/message-processor.ts` line 210

**Problem:** For `tool_use` messages, both `text` and `toolName` are set to `name`:
```ts
const msg: TerminalMessage = { type: 'tool_use', text: name, toolName: name };
```

In the renderer, both are displayed — `toolName` in the colored tool-name style, and `text` in the dim style. For Edit tool calls with diffs, this means the output looks like:

```
● Edit  Edit
  - removed lines...
  + added lines...
```

The diff block renders correctly, but it sits below a line that shows the tool name twice.

**Impact:** Pre-existing issue not introduced by this plan. The diff rendering is correct regardless. But the plan's verification section (step 3) says "Confirm the Edit tool call shows: `● Edit` summary line" — this won't match reality because the label is duplicated.

**Suggested fix:** This is pre-existing (predates this plan). Not a plan-level issue — but the verification step should reflect actual behavior, or the duplicate should be fixed as a separate cleanup.

**Verdict: Impl-note** — pre-existing, not introduced by this plan. Note that verification step 3 may not match actual output.

---

## Non-Issues Verified

- **Type contract:** `diffRemoved` and `diffAdded` are `string | undefined` in `TerminalMessage`. Server populates them optionally. Client checks for truthiness before rendering. No mismatch.
- **WebSocket serialization:** These are plain string fields on an existing interface that already serializes over WebSocket via `JSON.stringify`. No new message types needed. Works correctly.
- **Terminal replay:** `terminal_replay` sends the same `TerminalMessage[]` array, so replayed Edit messages will include diff data. No gap.
- **Non-Edit tools:** The diff fields are only populated when `name === 'Edit'` (line 211). All other tools pass through unaffected. No regression risk.
- **Theme variables:** `--term-tool-error` and `--term-tool-success` are defined in all 6 themes via `themes.ts` and wired through `flow.css`. Confirmed present.

---

## Overall Assessment

The plan is sound. Three files, clean data flow, no new abstractions. The type contract is correct and consistent between server and client. No architectural gaps, no missing components, no contract mismatches.

Two Impl-notes (char truncation cosmetics and pre-existing label duplication) and two Low items (dangerouslySetInnerHTML clarification and hardcoded background) — none of which would cause rework or wrong architecture if discovered during implementation.

**Recommendation: Approve — no blocking issues.**
