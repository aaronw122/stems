# Terminal Rendering Review R2 — Product/UX Consistency

**Reviewer:** Product/UX Consistency (Agent 3, Round 2)
**Plan:** `plans/claude-terminal-theming.md` (revision 5)
**Reference:** `notes/claude-code-terminal-rendering-reference.md`
**Screenshots reviewed:** Claude Code sessions showing Bash, Explore, and multi-tool output
**Date:** 2026-03-01

---

## Round 1 Issues — Status Assessment

| R1 Issue | Plan Fix (rev 5) | Code Implementation | Verdict |
|----------|-------------------|---------------------|---------|
| `ToolName ToolName` duplication | `extractToolSummary()` helper added (Step 1, lines 143-192) | **Not yet implemented** — `message-processor.ts:190` still emits `{ text: name, toolName: name }` | Plan fix is correct and sufficient. Code needs to catch up. |
| `tool_result` in wrong handler | `handleUser()` + `case 'user'` branch specified (Step 1, lines 193-219) | **Not yet implemented** — `message-processor.ts:162-177` still handles `tool_result` inside `handleAssistant()`, no `SDKUserMessage` import | Plan fix is correct and sufficient. Code needs to catch up. |
| `└` connector added | Specified in Step 3 renderer (lines 355-368) | **Not yet implemented** — `TerminalMessageRenderer.tsx:100-111` still uses `●` bullet | Plan fix is correct. |
| Running/error status | `status` field + `updateToolStatus` store method specified (Step 1 type, Step 3 renderer lines 306-353) | **Not yet implemented** — `shared/types.ts` still missing `toolUseId` and `status` fields | Plan fix is correct. |
| Collapse/expand for tool results | Specified in Step 3 (lines 390-421) with `ToolResultMessage` sub-component | **Not yet implemented** | Plan fix is correct. |
| "Completed" system message removal | Explicit fix section at bottom of plan (lines 502-513) | **Not yet implemented** — `message-processor.ts:275` still emits `{ type: 'system', text: 'Completed' }` | Plan fix is correct. |

**Summary:** All six R1 fixes are well-specified in the plan. None have been implemented in code yet. The plan revisions are sufficient — an implementer following revision 5 would produce the correct behavior for all six issues. No further plan changes needed for these items.

---

## Remaining Visual Parity Gaps (New Findings)

### 1. [Must-fix] Renderer displays `toolName` and `text` as separate spans — format should be `ToolName(summary)`

**Location:** Plan Step 3 renderer code (lines 314-337); current `TerminalMessageRenderer.tsx:82-98`
**Reference:** Screenshots show `● Bash(gh pr create ...)`, `● Explore(Explore folder picker ...)`

The plan's `extractToolSummary()` fix correctly separates `toolName` from `text` at the data layer (Step 1). But the **renderer code in Step 3** (lines 322-336) still displays them as two separate spans:

```tsx
{message.toolName && (
  <span className="mr-1.5" style={{ color: 'var(--term-tool-name)' }}>
    {message.toolName}
  </span>
)}
{message.text && (
  <span style={{ color: 'var(--term-text-dim)' }}>{message.text}</span>
)}
```

This produces `Bash  gh pr create --base main ...` (tool name in one color, summary in another, separated by whitespace). Claude Code renders it as a single visual unit: `Bash(gh pr create --base main ...)` — the tool name and parenthesized summary are one contiguous string.

The current plan format means the renderer must manually concatenate `toolName + "(" + text + ")"`. This is fragile and splits a display concern between two layers.

**Would this cause significant rework?** Yes — the renderer architecture for `tool_use` needs to change, and depending on how summary text is consumed elsewhere (collapse hints, search, accessibility), the format decision propagates.

**Severity: Must-fix**

**Suggested fix:** Either:
- (A) Change `extractToolSummary` to return the full formatted string including tool name: `"Bash(gh pr create ...)"` and have the renderer display only `text`, ignoring `toolName` for display. Keep `toolName` for programmatic use (Bash border detection, etc.).
- (B) Keep the split data but update the renderer to format: `{toolName}({text})` as a single contiguous element with appropriate styling.

Option (B) is cleaner — preserves structured data while achieving the correct visual. The renderer should produce:

```tsx
<span style={{ color: 'var(--term-tool-name)' }}>
  {message.toolName}
</span>
<span style={{ color: 'var(--term-text-dim)' }}>
  ({message.text})
</span>
```

No `mr-1.5` gap, and summary wrapped in parentheses.

---

### 2. [Impl-note] Braille spinner vs CSS spinner — visual difference from Claude Code

**Location:** Plan Step 3, CSS spinner (lines 339-353); Reference "Spinner (Running State)" section

The plan specifies a CSS rotating circle spinner (`.term-tool-spinner` with `border` + `border-top-color` + `rotate` animation). Claude Code uses braille character cycling (`⠋ ⠙ ⠹ ⠸ ⠼ ⠴ ⠦ ⠧ ⠇ ⠏`) in cyan.

This is a deliberate design divergence — a CSS spinner is arguably better in a GUI context than cycling Unicode characters. The visual difference is noticeable but defensible.

**Would this cause significant rework?** No — purely cosmetic, easy to swap later.

**Severity: Impl-note** — Acceptable divergence. If exact parity is desired later, a braille character cycling animation via `@keyframes` with `content` property steps could replicate it.

---

### 3. [Impl-note] `(No output)` sentinel for empty tool results not specified

**Location:** Plan Step 1, `handleUser()` spec (lines 207-211); Reference Bash examples showing `└ (No output)`
**Screenshot:** Second screenshot clearly shows `● Bash(gh pr merge 9 --merge)` followed by `└ (No output)`

The plan's `handleUser()` spec says to emit `{ type: 'tool_result', text: truncated, ... }` but doesn't specify what happens when the tool result content is empty. Claude Code displays `(No output)` as a distinct sentinel string.

**Would this cause significant rework?** No — a single conditional in the message processor.

**Severity: Impl-note** — Add `text: content || '(No output)'` to the tool_result emission in `handleUser()`. One line.

---

### 4. [Impl-note] `... +N lines (ctrl+o to expand)` format doesn't match Claude Code exactly

**Location:** Plan Step 3 collapse/expand (lines 400-418); Reference "Collapse / Expand Behavior"; Screenshot showing `... +2 lines (ctrl+o to expand)`

The plan's collapse format is:
```
lines[0] + `... +${lines.length - 1} lines`
```

Claude Code's format (from screenshots) is:
```
  ... +2 lines (ctrl+o to expand)
```

Two differences:
1. Claude Code puts the `...` on its own line below the first line of output, not appended to the first line
2. Claude Code includes `(ctrl+o to expand)` hint text — the plan's clickable expand doesn't include visible hint text

The plan specifies a click-based expand which is correct for a GUI, but the collapsed summary formatting should show the first few lines of actual output, then `... +N lines (click to expand)` on a separate line below.

**Would this cause significant rework?** No — formatting detail in the renderer.

**Severity: Impl-note** — Adjust the collapsed view to show output lines 1-3 as-is, then add a separate dim line: `... +N lines (click to expand)`.

---

### 5. [Impl-note] Subagent display name uses `Agent` instead of `subagent_type`

**Location:** Plan Step 1 `extractToolSummary` (lines 166-173); Reference "Subagent Display" section; Screenshot showing `● Explore(...)`

The plan's `extractToolSummary` for `Agent`/`Task` returns `${subType}: ${desc}` format. But the screenshot shows the subagent type **replaces** the tool name entirely — `Explore(...)` not `Agent Explore: ...`. The `toolName` field would still be `"Agent"`, but the display should show the `subagent_type` as the primary name.

The `extractToolSummary` function returns the right data, but the renderer will display `● Agent  Explore: Explore folder picker...` because `toolName` stays `"Agent"` and `text` contains `"Explore: Explore folder picker..."`.

**Would this cause significant rework?** No — override `toolName` for Agent/Task in the message processor when `subagent_type` is available.

**Severity: Impl-note** — In the `tool_use` mapping for Agent/Task, set `toolName: subType || name` so the renderer shows `● Explore(Explore folder picker ...)` instead of `● Agent(Explore: Explore folder picker ...)`.

---

### 6. [Impl-note] Subagent completion summary format not addressed

**Location:** Reference "Subagent Display" lifecycle; Screenshot: `└ Done (9 tool uses · 41.4k tokens · 29s)`

Claude Code shows a structured completion line for subagents with tool count, token count, and duration. The plan doesn't specify how to format subagent `tool_result` text differently from regular tool results. If the SDK's `tool_use_summary` or the subagent result contains this metadata, it should be formatted as `Done (N tool uses · Xk tokens · Ns)`.

**Would this cause significant rework?** No — a formatting concern in the tool_result emitter.

**Severity: Impl-note** — Document as a known gap. If the SDK provides these fields in the result, format accordingly; if not, regular tool_result text is acceptable.

---

### 7. [Impl-note] `--term-bash-border` defined in theme system but never applied

**Location:** Plan Step 2 CSS variable table (line 272); Plan Step 3 renderer; Reference per-tool format showing Bash has a distinct border

The plan defines `--term-bash-border` (pink `rgb(253,93,177)`) but the Step 3 renderer never references it. Claude Code uses a visually distinct border for Bash tool calls. The plan should specify that when `toolName === 'Bash'`, the `tool_use` line gets a `border-left: 2px solid var(--term-bash-border)` or similar treatment.

**Would this cause significant rework?** No — a conditional style in the renderer.

**Severity: Impl-note** — Add a Bash-specific style condition in the `tool_use` renderer case.

---

### 8. [Impl-note] Heading colors missing blue from reference

**Location:** Plan Step 3 markdown; Reference "Headings" section; `TerminalMessageRenderer.tsx:35-38`

Already flagged in R1 by multiple agents. Still not addressed in the plan text. Claude Code uses blue for H1/H2 headings. The current renderer uses only size differentiation. The plan should add heading color.

**Would this cause significant rework?** No.

**Severity: Impl-note** — Add `color: var(--term-heading-color, blue)` or similar to the heading regex replacement. Could also use a theme variable mapped to blue.

---

### 9. [Impl-note] Inline code missing cyan color

**Location:** Reference "Chalk Color Mappings" — `chalk.cyan()` for inline code; `TerminalMessageRenderer.tsx:23-25`

The reference specifies inline code renders in cyan. The current renderer applies only a background with no color change. The plan doesn't address this.

**Would this cause significant rework?** No.

**Severity: Impl-note** — Add `color: cyan` (or theme variable) to the inline code replacement.

---

### 10. [Impl-note] Hardcoded `rgba(255,255,255,0.08)` in markdown renderer breaks light themes

**Location:** `TerminalMessageRenderer.tsx:19,25` — fenced code and inline code backgrounds

Already flagged in R1. Still not addressed in plan or code. White-based transparency is invisible on light backgrounds. Should use `var(--term-input-bg)` or a dedicated `--term-code-bg`.

**Would this cause significant rework?** No.

**Severity: Impl-note** — Replace with CSS variable reference.

---

## Summary

| Severity | Count | Items |
|----------|-------|-------|
| Must-fix | 1 | Renderer format: `ToolName  summary` instead of `ToolName(summary)` |
| Impl-note | 9 | Braille vs CSS spinner, empty result sentinel, collapse format, subagent display name, subagent completion summary, bash border, heading colors, inline code cyan, hardcoded code bg |

### Overall Assessment

**The R1 fixes in plan revision 5 are well-done.** All six critical/must-fix items from round 1 are properly specified with code examples and clear implementation paths. The plan has improved significantly.

**One remaining Must-fix:** The renderer's `tool_use` display format doesn't produce the parenthesized `ToolName(summary)` format that is Claude Code's most recognizable visual signature. The data layer (`extractToolSummary`) is correct, but the renderer combines `toolName` and `text` as separate whitespace-separated spans rather than the `Name(summary)` format visible in every screenshot. This needs a small renderer update — either wrap `text` in parentheses or restructure the JSX.

**The nine Impl-notes are genuine parity gaps** (not nitpicks) but none require architectural decisions or plan-level changes. They can all be handled during implementation without rework risk. An implementer working from revision 5 could address them in-line.

**Bottom line:** Revision 5 is ready to implement. The one Must-fix (parenthesized format) is a 5-line renderer change. The rest are implementation polish that can be tracked as a checklist during development.
