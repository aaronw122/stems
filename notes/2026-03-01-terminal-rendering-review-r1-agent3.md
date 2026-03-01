# Terminal Rendering Visual Parity Review

**Reviewer:** Product/UX Consistency Reviewer (Agent 3)
**Plan:** `plans/claude-terminal-theming.md` (revision 3)
**Reference:** `notes/claude-code-terminal-rendering-reference.md`
**Current renderer:** `src/components/panels/TerminalMessageRenderer.tsx`
**Date:** 2026-03-01

**Reviewed artifacts:**
- "Before" screenshot: current Stems state showing `● Glob Glob` / `● Grep Grep` pattern
- Target screenshots: real Claude Code showing `Bash(gh pr create ...)`, `Explore(Explore folder picker...)` with result connectors and expand hints

---

## Findings

### [Critical] Tool call text shows `ToolName ToolName` instead of `ToolName(input summary)` — no input summary extraction

**Location:** Step 1 message processor mappings; `server/message-processor.ts` line 190; renderer `tool_use` case
**Issue:** The "before" screenshot shows the current broken state: every tool call renders as `● Glob Glob`, `● Grep Grep`, `● Agent Agent` — the tool name is duplicated because the message processor emits `{ type: 'tool_use', text: name, toolName: name }`, where both `text` and `toolName` are just the tool name with no input summary. The renderer then displays `toolName` followed by `text`, producing the doubled text.

The Claude Code target screenshots show the actual format: `Bash(gh pr create --base main ...)`, `Explore(Explore folder picker and WS patterns)`, `Glob(**/*.tsx)`. The parenthesized input summary is the core visual signature of Claude Code tool calls.

The plan's Step 1 mapping says: `tool_use → { type: 'tool_use', text: name, toolName: name }` — this is exactly the bug visible in the screenshot. The plan never specifies extracting a summary from `block.input` for each tool type.

**Suggested fix:** The plan must define per-tool input summary extraction logic:

| Tool | Summary source (`block.input` field) |
|------|--------------------------------------|
| Bash | `input.command` (truncated to ~80 chars) |
| Read | `input.file_path` (last 2-3 path segments) |
| Edit | `input.file_path` (last 2-3 path segments) |
| Write | `input.file_path` (last 2-3 path segments) |
| Glob | `input.pattern` |
| Grep | `input.pattern` |
| WebFetch | `input.url` |
| WebSearch | `input.query` |
| TaskCreate | `input.subject` |
| TaskUpdate | `input.taskId + " → " + input.status` |
| NotebookEdit | `input.notebook_path` (last 2-3 segments) |
| Agent/subagent | `input.description` or subagent type + description |

The emitted message should be: `{ type: 'tool_use', text: 'Bash(gh pr create --base main ...)', toolName: 'Bash' }` — with `text` containing the full `ToolName(summary)` format string. The renderer should display `text` as the primary content.

This is the single biggest visual parity gap and the most visible bug in the current state.

---

### [Must-fix] Result connector `└` missing — tool results are visually disconnected from their tool calls

**Location:** Step 3 renderer table; current renderer `tool_result` case (line 100-111)
**Issue:** The Claude Code screenshots clearly show `└` (U+2514) as a connector between tool calls and their results:

```
● Bash(gh pr merge 9 --merge)
  └ (No output)
```

The current renderer indents `tool_result` with `pl-4` and uses a bullet `●` — there is no `└` connector character. The plan's Step 3 table says `tool_result` gets "Indented result text, success/error colored bullet" but never mentions the `└` connector that is one of Claude Code's most recognizable visual elements.

The reference document explicitly lists `└` (U+2514) as "Result connector" in the Key Unicode Symbols table and shows it in every tool call rendering example.

**Suggested fix:** Replace the `●` bullet in `tool_result` with the `└` connector character. Render as:

```
● Bash(gh pr create ...)
  └ https://github.com/aaronw122/stems/pull/9
```

The connector should be in `--term-text-dim` color, not success/error colored. The success/error state is already communicated by the parent tool call's bullet color.

---

### [Must-fix] No expand/collapse hint text — `(ctrl+o to expand)` is absent

**Location:** Step 3 renderer; reference document "Collapse / Expand Behavior" section
**Issue:** Both Claude Code target screenshots show `(ctrl+o to expand)` hint text after collapsed tool results. This is a consistent, visible UI element:

```
● Bash(git pull origin main)
  └ From github.com:aaronw122/stems
  ... +2 lines (ctrl+o to expand)
```

```
● Explore(Explore folder picker and WS patterns)
  └ Done (9 tool uses · 41.4k tokens · 29s)
  (ctrl+o to expand)
```

Neither the plan nor the current renderer addresses this. Since Stems is a GUI (not a terminal), the equivalent might be a clickable expand/collapse, but the plan should explicitly define:
1. Whether tool results are collapsed by default
2. What the collapse affordance looks like (click to expand? a small toggle?)
3. How truncated output is indicated (`... +N lines`)

**Suggested fix:** Add a collapse/expand design to Step 3. Tool results should be collapsed by default showing a brief summary. Add a clickable hint like `(click to expand)` or a chevron toggle. Long results should show `... +N lines (click to expand)`. This is a plan-level decision — the wrong architecture (no collapse state in TerminalMessage) would require rework.

---

### [Medium] Subagent completion summary format not represented

**Location:** Step 1 message processor mappings; reference "Subagent Display" section
**Issue:** Claude Code shows a rich completion line for subagents:

```
● Explore(Explore folder picker and WS patterns)
  └ Done (9 tool uses · 41.4k tokens · 29s)
```

The plan maps `Agent` tool calls to generic `tool_use` messages. There is no special handling for subagent completion summaries (`Done (N tool uses · Xk tokens · Ns)`). The `tool_result` for an Agent/subagent should contain this structured summary, but the plan doesn't define how to extract tool count, token count, or duration from the subagent result.

**Suggested fix:** Document that subagent `tool_result` messages should format their text as `Done (N tool uses · Xk tokens · Ns)` when the data is available from the SDK result. If the SDK doesn't provide this data, note it as a known gap for later.

---

### [Medium] Markdown rendering in headings missing blue color from Claude Code

**Location:** Step 3 / current renderer `markdownToHtml` function (line 35-39)
**Issue:** The reference document specifies that Claude Code renders H1 as `chalk.bold.underline.blue()` and H2 as `chalk.bold.blue()`. The current renderer's heading implementation uses `<strong style="font-size:${size}">` with no blue color and no underline for H1. The reference document's "Stems equivalent" column explicitly says to include `color: blue; text-decoration: underline` for H1 and `color: blue` for H2.

**Suggested fix:** This is an implementation fix in the existing renderer. Add `color: var(--term-tool-success)` or a dedicated heading color variable, and `text-decoration: underline` for H1 headings. Low rework risk, but worth noting since it's a visible fidelity gap.

---

### [Medium] Spinner/running state not addressed — tool calls jump from absent to complete

**Location:** Step 1 and Step 3; reference "Spinner (Running State)" section
**Issue:** Claude Code shows a braille spinner (`⠋ ⠙ ⠹ ⠸ ...`) in cyan while tools are running, replacing the `●` bullet. The plan has no concept of a tool's running state — the `TerminalMessage` type has no `isRunning` or `status` field, and the renderer has no spinner case.

In the current architecture, `tool_use` messages arrive when the tool is invoked and `tool_result` messages arrive when it completes. Between those two events, the user sees a static green `●` with no indication the tool is still running.

The reference document explicitly calls out the spinner as the running state indicator and the "Deferred: thinking indicators" note in Step 1 defers thinking but says nothing about tool running spinners.

**Suggested fix:** This could be classified as a follow-up, but the plan should acknowledge the gap explicitly. At minimum, note that a `status` field on `tool_use` messages (or a separate `tool_running` message type) would be needed for spinner fidelity. Without this, the mini terminal will look static compared to Claude Code's animated tool calls.

---

### [Medium] `(No output)` sentinel missing for empty tool results

**Location:** Step 1 message processor mappings; reference Bash tool examples
**Issue:** Claude Code shows `└ (No output)` when a tool produces no output (visible in the screenshot: `Bash(gh pr merge 9 --merge) └ (No output)`). The plan doesn't specify what happens when a tool_result has empty content. If the message processor skips emitting a tool_result for empty results, the `└` connector line will be missing. If it emits an empty string, the connector will appear with no text.

**Suggested fix:** Specify that empty tool results should emit `{ type: 'tool_result', text: '(No output)' }` to match Claude Code's behavior.

---

### [Medium] Turn duration display (`Cooked for 1m 6s`) not in plan

**Location:** Reference document "Cost / Token Display" section
**Issue:** The reference document shows Claude Code displays `Cooked for 1m 6s` after each response turn. This is a visible element users would notice. The plan's `system` message type could carry this, but no mapping or format is specified.

**Suggested fix:** Impl-note level. The `result` event mapping already emits `{ type: 'system', text: 'Completed', costUsd: total_cost_usd }`. Extend this to include duration if available from the SDK, formatted as `Completed in Xm Ys · $0.XX`.

---

### [Impl-note] Fenced code blocks render as inline `<code>` instead of block-level elements

**Location:** Current renderer `markdownToHtml` function (line 18-20)
**Issue:** The regex for fenced code blocks (```` ```...``` ````) wraps the content in an inline `<code>` tag with minimal padding. Claude Code renders these as bordered blocks with box-drawing characters (`┏━━┓ / ┗━━┛`). The reference document's "Stems equivalent" section specifies `border: 1px solid var(--term-text-dim); background: rgba(255,255,255,0.05); border-radius: 4px; padding: 8px` — a proper block-level code element.

The current implementation produces inline-styled code spans that won't visually read as code blocks. This is an implementation fix, not a plan-level gap.

**Suggested fix:** Change the fenced code block regex replacement to produce a `<pre><code>` block with the reference document's suggested styling. Add the language tag in bold above the code if present.

---

### [Impl-note] List bullets use `•` text instead of dimmed styling

**Location:** Current renderer `markdownToHtml` function (line 42)
**Issue:** The function replaces `- item` with `  • item` as plain text. Claude Code uses `chalk.dim('*')` — a dimmed bullet character. The Stems equivalent should use a `<span>` with `color: var(--term-text-dim)` for the bullet and normal color for the item text.

**Suggested fix:** Replace the text substitution with HTML: `<span style="color:var(--term-text-dim)">  •</span> $1`.

---

### [Impl-note] Inline code missing cyan color from Claude Code

**Location:** Current renderer `markdownToHtml` function (line 23-26)
**Issue:** Claude Code renders inline code with `chalk.cyan()`. The reference document's mapping says `color: cyan; background: rgba(255,255,255,0.08)`. The current renderer applies only the background, no cyan color.

**Suggested fix:** Add `color: cyan` (or a theme variable) to the inline code `<code>` style.

---

### [Impl-note] `--term-bash-border` defined but never applied in renderer

**Location:** Step 2 CSS variable table; Step 3 renderer table
**Issue:** The plan defines `--term-bash-border` as a CSS variable (pink `rgb(253,93,177)` in dark theme) but no renderer case applies it. Claude Code uses a distinct pink left border for Bash tool calls. The previous review round flagged this as [Low] but it remains unaddressed.

**Suggested fix:** When `toolName === 'Bash'`, apply a left border with `border-left: 2px solid var(--term-bash-border)` to the tool_use line. This is a small implementation detail but contributes to visual parity.

---

### [Impl-note] Tool result `isSuccess` field has no producer

**Location:** Step 1 mapping table; `server/message-processor.ts` line 168
**Issue:** The renderer uses `message.isSuccess === false` to choose between error and success bullet colors for `tool_result`. The message processor emits `tool_result` without setting `isSuccess`. The previous review summary flagged this. The SDK's `tool_result` blocks include an `is_error` field that should map to `isSuccess: !is_error`.

**Suggested fix:** In the message processor, set `isSuccess` on tool_result messages based on the SDK block's `is_error` field.

---

### [Impl-note] Hardcoded `rgba(255,255,255,0.08)` in renderer violates theme system

**Location:** Current renderer `markdownToHtml` function (lines 19, 25)
**Issue:** The inline code and fenced code block backgrounds use hardcoded `rgba(255,255,255,0.08)`, which will be invisible on light themes. This should use a CSS variable or a theme-aware value.

**Suggested fix:** Define a `--term-code-bg` CSS variable (dark: `rgba(255,255,255,0.08)`, light: `rgba(0,0,0,0.06)`) and reference it in the markdown renderer.

---

## Summary

| Severity | Count | Key theme |
|----------|-------|-----------|
| Critical | 1 | Tool call format completely wrong — `ToolName ToolName` instead of `ToolName(input summary)` |
| Must-fix | 2 | Missing `└` result connector; missing collapse/expand behavior |
| Medium | 4 | Subagent summary, spinner state, empty result sentinel, turn duration |
| Impl-note | 6 | Code block rendering, list styling, inline code color, bash border, isSuccess producer, hardcoded colors |

The single most impactful fix is the Critical finding: the current implementation doesn't extract input summaries for tool calls, producing the `● Glob Glob` pattern visible in the "before" screenshot. This is the defining visual element of Claude Code's tool call rendering and the plan's mapping table explicitly encodes the bug by setting `text: name`. Fixing this requires per-tool input extraction logic in the message processor — it needs to be in the plan, not discovered during implementation.

The two Must-fix items (result connectors and collapse/expand) are the next most visible gaps when comparing side-by-side with the Claude Code screenshots.
