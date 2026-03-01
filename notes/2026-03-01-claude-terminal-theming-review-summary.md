# Plan Review Summary

**Plan:** plans/claude-terminal-theming.md
**Rounds:** 2
**Final revision:** 3

## Issues Found & Fixed

### Round 1 (1 Critical, 6 Must-fix → all fixed)

- **[Critical]** Stream parser rewrite conflict: theming plan targeted `stream-parser.ts` which the SDK migration plan replaces entirely — plan now sequences after SDK migration and targets `message-processor.ts`
- **[Must-fix]** `terminal_replay` protocol gap: `terminal_replay` message not updated alongside `terminal_data` when switching from `lines: string[]` to `messages: TerminalMessage[]`
- **[Must-fix]** Token-to-CSS-property mapping absent: extracted Claude Code color tokens (13 in dark, 9 in light, fewer in daltonized) had no explicit mapping to the 19 CSS custom properties
- **[Must-fix]** `broadcastTerminal` signature not specified: `state.ts` was listed as a modified file but the required function signature changes (`broadcastTerminal`, `appendTerminalLines`→`appendTerminalMessages`, `getTerminalLines`→`getTerminalMessages`) were not called out
- **[Must-fix]** ThemeProvider gated entire app: "if no theme, render ThemePicker instead of children" — fixed to always render children, default to dark, show picker as dismissible overlay
- **[Must-fix]** File count mismatch: summary said 7 modified files but actual count was higher; corrected to 5 new, 10 modified

### Round 2 (0 Critical, 1 Must-fix → all fixed)

- **[Must-fix]** `AskUserQuestion` mapping precedence ambiguous: both the generic `tool_use` mapping and the new `permission` mapping trigger on the same SDK event condition — plan clarified that `AskUserQuestion` tool_use blocks produce both a `tool_use` and `permission` message (matching current stream-parser behavior)

## Remaining Issues

- **[Medium]** Tailwind arbitrary color migration strategy unspecified: 15+ hardcoded Tailwind color classes in TerminalPeek need migration but the approach (arbitrary values vs. Tailwind config extension vs. CSS classes in flow.css) was never chosen
- **[Medium]** ANSI handling for `tool_result` still ambiguous: Step 4 says keep `ansi-to-html` for tool_result only but the TerminalMessageRenderer table has no ANSI processing step for any message type
- **[Medium]** `thinking` type has no producer: `TerminalMessageType` includes `'thinking'` and the renderer handles it, but no SDK event mapping produces a thinking message — risks dead code
- **[Medium]** User message duplication guard missing: plan adds `user_message` echo from `server/index.ts` but does not explicitly prohibit the message processor from also emitting `user_message` type events
- **[Medium]** `context-summary.ts` serialization underspecified: `messages.map(m => m.text).join('\n')` strips type information that could improve the LLM summarization prompt
- **[Medium]** Canvas theming scope not explicitly documented: light and daltonized themes will produce a dark canvas with light terminal windows — plan should state this as a deliberate v1 scope boundary
- **[Medium]** No state-aware terminal chrome: terminal window title/border communicates nothing about session state (running, needs-human, crashed) — missed when TerminalPeek architecture was open for changes
- **[Low]** `--term-bash-border` token defined but no renderer case uses it: Bash-specific left-border styling is a CSS variable without a renderer entry to apply it
- **[Low]** `isSuccess` field on TerminalMessage has no producer: the mapping table emits `tool_result` messages without setting `isSuccess`, but the renderer uses it for success/error bullet color
- **[Low]** Permission block color degrades to orange in Light Daltonized: fallback chain for `--term-permission-bg` reaches `claude` token (`rgb(255,153,51)`) in Light Daltonized since both `permission` and `suggestion` are absent
- **[Low]** `--term-bg` values are design choices, not Claude Code extractions: hardcoded `rgb(14,14,14)` and `rgb(245,245,245)` — Claude Code doesn't set its own terminal background

## Implementation Notes

- Amber colors in window chrome (cursor blink `#ffb000`, resize handle `rgba(255,176,0,*)`, floating window border glow) need per-element audit — cursor should use `var(--term-text)` at minimum
- `dangerouslySetInnerHTML` with `ansi-to-html` output for `tool_result` is a known XSS surface; verify escaping behavior or replace with `ansi-to-react` / add DOMPurify in a follow-up
- `EMPTY_LINES: string[] = []` sentinel in TerminalPeek must become `EMPTY_MESSAGES: TerminalMessage[] = []` with matching type
- `costUsd` on `TerminalMessage` for system completion display overlaps with `WeftNode.costUsd` — ensure cost is not double-tracked or displayed inconsistently
- `context-summary.ts` line 27 (`lines.join('\n')`) will break silently producing `[object Object]` output if `getTerminalMessages()` return type changes and the `.map(m => m.text)` step is not added
- `stderr` output from `session.ts` `drainStderr()` has no `TerminalMessage` type mapping — map to `{ type: 'error', text: '[stderr] ...' }` or `{ type: 'system' }` during implementation
- Theme switching post-first-boot has no UI entry point — users must clear localStorage; track as fast follow-up
- `AnsiToHtml` converter is initialized with hardcoded `fg: '#ffb000'` — must re-instantiate with theme-aware colors when theme changes

## Reviewer Personas Used

- **Frontend/Theming Architect (Agent 1):** CSS architecture, token systems, Tailwind integration, component-level rendering concerns, protocol correctness
- **Agent SDK Integration Specialist (Agent 2):** SDK migration sequencing, WebSocket protocol changes, server-side event taxonomy, cross-plan coordination dependencies
- **Product/UX (Agent 3):** Multi-session triage UX, accessibility, visual coherence across DAG canvas and terminal panels, first-boot and returning-user flows
