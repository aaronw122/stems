# Plan Review Summary

**Plan:** plans/claude-terminal-theming.md (Claude Terminal Rendering)
**Rounds:** 3
**Final revision:** 6

---

## Issues Found & Fixed

### Round 1 (1 Critical, 4 Must-fix fixed)

- **[Critical] Tool call text shows `ToolName ToolName` — no input summary extraction:** Message processor emits `{ text: name, toolName: name }`, causing both spans to duplicate the tool name. Fixed in rev 5 by adding `extractToolSummary(name, input)` with per-tool extraction logic.
- **[Must-fix] `tool_result` blocks handled in wrong SDK message type:** Processor looked for `tool_result` inside `assistant` messages, but they live in `user` messages. Results were never displayed. Fixed by adding `handleUser()` and `case 'user'` branch.
- **[Must-fix] Running/error status absent from `TerminalMessage` type:** No `status` field existed; tool_use always rendered a static green bullet with no spinner or error state. Fixed by adding `status?: 'running' | 'success' | 'error'` and `toolUseId?: string` to `TerminalMessage`.
- **[Must-fix] Missing `└` result connector:** `tool_result` used a bullet `●` instead of the tree connector `└` (U+2514) visible in every Claude Code screenshot. Fixed in plan renderer spec at Step 3.
- **[Must-fix] No collapse/expand for tool results:** Long results had no truncation or toggle. Fixed by specifying a `ToolResultMessage` sub-component with `useState`, 3-line threshold, and click-to-expand.

### Round 2 (3 Must-fix, 3 Medium fixed)

- **[Must-fix] `updateToolStatus` store method protocol undefined:** Plan recommended a Zustand store method to update tool status but never specified how the server communicates status changes to the client. Fixed by specifying the piggyback approach: include `toolUseId` on `tool_result` messages and have `appendMessages` correlate them client-side against the existing `tool_use` buffer.
- **[Must-fix] Renderer displays `toolName` and `text` as separate spans instead of `ToolName(summary)` format:** The plan's data layer was correct but the renderer produced `Bash  gh pr create ...` instead of `Bash(gh pr create ...)`. Fixed by wrapping `text` in parentheses adjacent to `toolName` with no gap.
- **[Must-fix] `updateToolStatus` mutates Zustand state in-place without `set()`:** Direct mutation breaks React's re-render detection — spinners would spin forever. Fixed by specifying an immutable update pattern using `set((state) => ...)` with spread-copied messages and a new `Map`.
- **[Medium] `useState` hook shown inside switch case in plan code example:** The example would crash at runtime; the extracting note existed but the plan showed the wrong code. Fixed by replacing with `ToolResultMessage` sub-component snippet.
- **[Medium] `SDKUserMessage` type not imported in plan's `handleUser()` spec:** The plan referenced the type without noting the required import. Fixed by adding import note.
- **[Medium] `extractToolSummary` per-tool fallbacks re-introduce `ToolName ToolName`:** Per-tool cases returned `name` as fallback when the specific input field was missing, producing the original duplication bug. Fixed by changing all per-tool fallbacks to return `''` (tool name is already displayed via `toolName`).

---

## Remaining Issues

These were noted across rounds but not fixed in the plan — they are implementation-level details, not architectural blockers.

- **[Medium] SDK may not yield `user` messages through `query()` stream in practice:** The `handleUser()` spec assumes `SDKUserMessage` events flow through the async generator, which needs empirical verification. A fallback via `tool_progress` events was suggested but not specified.
- **[Medium] Subagent completion summary format not defined:** The reference shows `└ Done (9 tool uses · 41.4k tokens · 29s)` but the plan doesn't specify how to extract tool count, token count, or duration from the SDK result.
- **[Medium] Spinner/running state produces static appearance:** Between `tool_use` and `tool_result` events the tool appears frozen. Braille-character cycling (`⠋ ⠙ ⠹...`) as used in Claude Code was deferred; CSS spinner is specified but is a divergence.
- **[Medium] Turn duration display (`Cooked for 1m 6s`) not in plan:** Reference shows this after each response turn but the plan's `result` event mapping does not include duration formatting.
- **[Low] Server-side buffer doesn't update tool status on replay:** `appendTerminalMessages` in `server/state.ts` has no `toolUseId` correlation logic, so `terminal_replay` payloads will contain `tool_use` messages frozen at `status: 'running'` for tools that completed.
- **[Low] `toolName` on `tool_result` resolves to UUID, not human name:** The processor needs the `toolUseIdToName` map to look up names for results; the map entry cleanup path is unnecessary but the population needs to happen before `handleUser()` fires.
- **[Low] Dead `tool_result` code in `handleAssistant` contains PR URL scanning:** The `extractPRUrls` logic must be preserved when the dead branch is deleted.
- **[Impl-note] Markdown regex processing order corrupts bold-within-inline-code:** Bold regex matches content inside `<code>` tags. Standard fix: placeholder-swap code content before running remaining transforms.
- **[Impl-note] Fenced code blocks render as inline `<code>` — no block-level styling:** Should use `<pre><code>` with border, padding, and background per reference spec.
- **[Impl-note] Hardcoded `rgba(255,255,255,0.08)` in markdown renderer invisible on light themes:** Should use `var(--term-input-bg)` or a dedicated `--term-code-bg` token.
- **[Impl-note] Dead CSS classes in `flow.css`:** `.term-msg-user`, `.term-msg-tool`, etc. are defined but the renderer uses inline styles exclusively.
- **[Impl-note] `<pre>` wrapping `<div>` children:** TerminalPeek wraps all messages in `<pre>`, which can cause spacing inconsistencies with Tailwind margin classes on inner `<div>` elements.
- **[Impl-note] `(No output)` sentinel not specified for empty tool results:** Plan's `handleUser()` says emit `text: truncated` but doesn't handle empty content. Should emit `'(No output)'` to match Claude Code.
- **[Impl-note] Collapse format doesn't match Claude Code exactly:** Plan appends `... +N lines` to first line; Claude Code puts it on a separate line below as `... +N lines (ctrl+o to expand)`.
- **[Impl-note] Subagent display name shows `Agent` instead of subagent type:** `toolName` stays `"Agent"` but display should show `subagent_type` (e.g., `Explore`) as the primary label.
- **[Impl-note] `--term-bash-border` defined but never applied in renderer:** Pink left border for Bash tool calls is in the theme system but no renderer case uses it.
- **[Impl-note] Heading colors missing blue from reference:** H1/H2 headings use only size differentiation; reference specifies blue color with underline for H1.
- **[Impl-note] Inline code missing cyan color:** Reference specifies `chalk.cyan()` for inline code; renderer applies only a background, no color.
- **[Impl-note] Spinner CSS file not specified:** Plan defines `.term-tool-spinner` keyframe but doesn't state it goes in `flow.css`.
- **[Impl-note] List bullet `•` uses plain text instead of dimmed span:** Should use `<span style="color:var(--term-text-dim)">` for the bullet character.
- **[Impl-note] Title bar text color hardcoded at `text-[#4a4a4a]`:** Won't adapt to themes; may conflict visually with light terminal themes.
- **[Impl-note] `--term-btn-text` inherits general text color — potential low contrast:** Button text on the orange-brown Send button could fail WCAG AA on some themes.
- **[Impl-note] `isSuccess` field is now dead in the renderer:** Plan's renderer uses `└` (always dim) and no longer colors based on `isSuccess`. Field is still useful as metadata but should be wired to `└` color or removed from renderer logic.
- **[Impl-note] `appendMessages` merge-boundary only:** Consecutive `assistant_text` messages within an incoming batch remain separate, which can split markdown across renders.

---

## Implementation Notes

All impl-notes from all rounds, deduplicated:

1. **`extractToolSummary` fallback should return `''` not `name`** — the tool name is already shown via `toolName`; per-tool fallbacks returning `name` re-introduce the duplication bug.
2. **`toolUseIdToName` map:** Populate when processing `tool_use` blocks (`map.set(block.id, block.name)`); look up when emitting `tool_result` in `handleUser()`. Map is closure-scoped and lives with the processor — no cleanup needed.
3. **`emittedToolResults` dedup set:** Add to processor closure alongside `toolUseIdToName` to prevent double-emission if both `handleAssistant` and `handleUser` fire for the same result.
4. **Client-side tool status correlation belongs in `appendMessages`:** When appending a `tool_result` with `toolUseId`, scan buffer for matching `tool_use` and update its `status` immutably. No separate `updateToolStatus` store method needed.
5. **Server-side buffer (`appendTerminalMessages` in `state.ts`) needs matching correlation logic** so `terminal_replay` payloads don't contain stale `status: 'running'` entries.
6. **`ToolResultMessage` sub-component is required** — `useState` cannot be called inside a switch case. Extract the collapse/expand rendering into a named component before wiring it into the `TerminalMessageRenderer` switch.
7. **Spinner CSS goes in `flow.css`** alongside the existing `.term-msg-*` classes.
8. **Verify `SDKUserMessage` is exported from `@anthropic-ai/claude-agent-sdk`** before relying on `handleUser()`. If not available, fall back to type narrowing on `msg.type === 'user'` with `unknown`.
9. **Empirically verify `user` messages are yielded by the `query()` async generator** by adding a debug log for `case 'user'` on first implementation run. The entire tool result display chain depends on this.
10. **Preserve `extractPRUrls` logic** from the dead `tool_result` branch in `handleAssistant()` when deleting it — move the PR URL scanning to `handleUser()` or a shared helper.
11. **`handleResultSuccess` line reference at plan line 509 will shift** after `handleUser()`, `extractToolSummary`, and `toolUseIdToName` additions. Use function name reference (`handleResultSuccess`) not line number.
12. **Deduplication strategy relies on SDK event ordering:** `stream_event` text deltas always precede the `assistant` message for the same turn. This ordering guarantee from the SDK makes it safe to skip `text` blocks in `handleAssistant()`. Worth a code comment.
13. **`<pre>` wrapper in `TerminalPeek` may be unnecessary** now that individual messages manage their own formatting. A plain `<div>` with `font-family: monospace` would give more predictable layout control; `whitespace-pre-wrap` can be applied per-message type where needed.
14. **`isSuccess` field should color the `└` connector** (green for success, red for error) rather than being silently ignored. If this is undesirable, remove it from renderer logic entirely and keep it only on the type for future use.
15. **`tool_use_summary` messages (from `SDKToolUseSummaryMessage`)** are currently dropped in the `default` case. These contain human-readable summaries of tool batches and would improve terminal readability if surfaced as `tool_result`-type messages.
16. **`task_started` / `task_progress` / `task_notification` system messages** (subagent activity) are all dropped. The plan doesn't address these; they warrant a future task if subagent visibility is prioritized.
17. **Buffer trim at `MAX_SERVER_MESSAGES` (200)** can orphan a `tool_result` without its parent `tool_use`. Cosmetically minor; acceptable as a known limitation of the ring-buffer display model.
18. **`TerminalMessage` should add `timestamp?: number`** (epoch ms, set by processor) to enable elapsed time display, message grouping, or stale session detection in future iterations.

---

## Reviewer Personas Used

1. Frontend Rendering Specialist — focused on React/TSX correctness, rendering architecture, CSS variable usage, and visual fidelity against the Claude Code reference.
2. Backend Data Pipeline Architect — focused on SDK protocol correctness, message processor coverage, server/client type contracts, Zustand store patterns, and streaming event handling.
3. Product/UX Consistency Reviewer — focused on visual parity with Claude Code screenshots, UX completeness (collapse/expand, spinners, sentinel strings), and end-to-end user-visible behavior.
