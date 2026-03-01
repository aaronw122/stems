# Claude Terminal Theming Plan Review — Product/UX Perspective

**Reviewer:** Agent 3 (Product/UX)
**Date:** 2026-03-01
**Plan:** `plans/claude-terminal-theming.md`
**Scope:** End-user experience of terminal theming — consistency across states, accessibility, error state visibility, and coherent visual language across the DAG canvas and terminal panels.

---

## Summary

The plan delivers a solid foundation for matching Claude Code's terminal appearance inside TerminalPeek windows. The color extraction is thorough and the structured message typing is a necessary prerequisite. However, the plan has significant gaps around how theming interacts with the DAG canvas context — where multiple agent sessions run simultaneously in different states — and around accessibility and error state visibility, which are critical for an orchestration tool where users must rapidly triage which sessions need attention.

---

## Findings

### 1. [Must-fix] Theme scope stops at the terminal — DAG canvas and node chrome are left unthemed

**Section:** Step 2 (Theme System), Step 7 (Update CSS)

The plan applies theme tokens exclusively to terminal content (`--term-*` CSS variables) and TerminalPeek. But the DAG canvas — node borders, state dots, stage badges, the HumanFlash indicator, edge colors, background, MiniMap — all use hardcoded Tailwind colors (`border-blue-500`, `bg-red-500/30`, `text-zinc-400`, etc.) that will visually clash with both the light theme and the daltonized themes. When a user selects the light theme, they will see a dark DAG canvas with zinc-800 nodes containing light-themed terminal windows. The result is an incoherent split-personality UI.

**Why this is plan-level:** The theme system architecture (Step 2) defines the token vocabulary. If the plan doesn't include canvas-level tokens now, they'll need to be retrofitted later, which means revisiting ThemeProvider, the theme preset definitions, and every node/badge component. That's significant rework.

**Suggested fix:** Either (a) expand the theme token vocabulary to include canvas-level tokens (`--canvas-bg`, `--node-bg`, `--node-border-*`, `--edge-stroke`, `--badge-*`, etc.) and add node components to the modified files list, or (b) explicitly scope the plan to "terminal content theming only" and document that canvas theming is a separate follow-up, noting the known visual inconsistency in light/daltonized modes.

---

### 2. [Must-fix] No visual differentiation of agent states in terminal chrome

**Section:** Step 3 (Terminal Message Renderer), Step 4 (Update TerminalPeek)

The plan focuses on message type styling (user, assistant, tool, error) but ignores how the terminal window itself communicates the session's state. Currently, the DAG nodes show state via border color and status dots (running=blue, needs-human=red, crashed=red-600, completed=green). But the TerminalPeek window has no corresponding visual indicator. When a user has 3-4 terminal windows open simultaneously, they cannot tell at a glance which sessions need attention without looking back at the DAG.

With the Agent SDK migration introducing richer session lifecycle states, this gap becomes more acute. A crashed session's terminal looks identical to a running one — the user must read the content to figure out what happened.

**Why this is plan-level:** The terminal message renderer (Step 3) and TerminalPeek layout (Step 4) are being redesigned in this plan. Adding state-aware terminal chrome later means re-touching both components.

**Suggested fix:** Add state-aware visual treatment to TerminalPeek: (a) title bar tint or subtle border glow that matches the node's state color, (b) a "needs input" banner or indicator when `humanNeededType` is non-null, and (c) a "Session ended" footer for completed/crashed states. Define corresponding theme tokens (`--term-state-running`, `--term-state-error`, `--term-state-completed`, `--term-state-needs-human`).

---

### 3. [Must-fix] Light and daltonized theme palettes are incomplete — missing tokens will cause invisible or unstyled elements

**Section:** Extracted Theme Colors

The Dark theme defines 13 tokens. The Light theme defines only 9 (missing `remember`, `planMode`, `autoAccept`, `bashBorder`). Dark Daltonized defines 8 (missing `remember`, `planMode`, `autoAccept`, `bashBorder`, `secondaryBorder`). Light Daltonized defines only 6 (missing `permission`, `suggestion`, `remember`, `planMode`, `autoAccept`, `bashBorder`, `secondaryBorder`).

Step 2 defines 19 CSS custom properties that need values from each theme. The plan gives no mapping from the 13 extracted tokens to the 19 CSS properties, and several themes are missing tokens that would be needed for that mapping. If the TerminalMessageRenderer uses `--term-tool-success` and that token has no source value in Light Daltonized, the result is either an unstyled element or a missing CSS variable fallback that silently renders invisible text.

**Why this is plan-level:** The token-to-CSS-property mapping is the contract between the theme definitions and the renderer. Without it, implementation will either guess (inconsistently) or discover gaps one at a time.

**Suggested fix:** Add an explicit mapping table from Claude Code color tokens to CSS custom properties for each theme. For missing tokens, either (a) re-extract from Claude Code source (the tokens may exist but weren't captured), or (b) document deliberate fallbacks (e.g., Light Daltonized `--term-tool-success` falls back to `success` token).

---

### 4. [Medium] `terminal_replay` message type not updated in the protocol change

**Section:** Step 1 (Protocol change)

The plan shows the `terminal_data` message changing from `lines: string[]` to `messages: TerminalMessage[]`, but the shared types (line 80 of `shared/types.ts`) also define `terminal_replay` which uses the same `lines: string[]` shape. The plan's "Files to modify" list for Step 1 includes `shared/types.ts` but doesn't mention updating `terminal_replay`. The `useWebSocket.ts` handler (line 47-48) calls `setLines(msg.nodeId, msg.lines)` for replay messages — this would also need to become `setMessages`.

Similarly, `server/state.ts` stores the server-side terminal buffer as `string[]` (line 18: `const terminalBuffers = new Map<string, string[]>()`), and `getTerminalLines()` returns `string[]`. The plan lists `server/state.ts` as a file to modify but only says "Update buffer type" without noting that the replay mechanism feeds from this buffer.

**Why this is plan-level:** If `terminal_replay` isn't updated alongside `terminal_data`, late-joining clients will receive unstructured strings when the renderer expects `TerminalMessage[]`, causing a runtime crash or blank terminal.

**Suggested fix:** Explicitly include `terminal_replay` in the protocol change section. Update the protocol change example to show both message types. Ensure `server/state.ts` buffer type, `getTerminalLines`, and the replay path in `server/index.ts` (lines 193-199) are all listed as needing the type change.

---

### 5. [Medium] First-boot theme picker gates the entire app — bad UX for returning users on cleared storage

**Section:** Step 2 (ThemeProvider behavior), Step 8

The ThemeProvider design says: "If null, render `<ThemePicker>` instead of children." This means if `localStorage` is cleared (browser data wipe, incognito, different browser, or just clearing site data for debugging), the entire app is blocked behind the theme picker. For a power tool like an agent orchestrator, this is a jarring interruption — especially if sessions are running on the server and the user just needs to reconnect.

**Why this is plan-level:** The gating architecture (ThemeProvider wrapping App in main.tsx) is defined here. Changing from a blocking gate to a non-blocking approach later means restructuring the provider.

**Suggested fix:** Instead of gating, default to the dark theme when no preference is saved. Show the ThemePicker as a dismissible overlay or toast on first visit (detected via a separate `stems-theme-chosen` flag). Alternatively, add a settings icon to the UI that always allows theme switching, and only show the picker prominently on first visit.

---

### 6. [Medium] No accessibility contract for contrast ratios

**Section:** Extracted Theme Colors, Step 3 (Terminal Message Renderer)

The plan extracts colors from Claude Code but never validates that they meet WCAG contrast requirements against the chosen backgrounds. For example, `secondaryText` at `rgb(153,153,153)` on a near-black background (`rgb(14,14,14)`) yields roughly a 7:1 ratio (fine), but `secondaryText` at `rgb(102,102,102)` on light gray `rgb(245,245,245)` yields roughly 3.9:1 (fails WCAG AA for normal text at 4.5:1). Since the plan proposes backgrounds that differ from Claude Code's actual terminal backgrounds (the plan says "use `rgb(14,14,14)` or similar" — Claude Code's actual Terminal.app background depends on the user's terminal profile), contrast ratios could diverge from what Claude Code achieves.

The daltonized themes exist specifically for accessibility, but the plan doesn't verify that the daltonized palette actually achieves higher contrast — only different hues.

**Why this is plan-level:** The background colors are defined in Step 2 and the token values in the extracted colors section. If contrast is wrong, the fix is changing the theme definitions, which ripples through every component.

**Suggested fix:** Add a verification step: for each theme, check that all text tokens against their background achieve at least WCAG AA (4.5:1 for normal text, 3:1 for large text). Document the chosen terminal background values explicitly per theme rather than "or similar." If Claude Code's own contrast is insufficient, note it as a known limitation rather than introducing regressions.

---

### 7. [Medium] Agent SDK migration will replace `stream-parser.ts` — theming plan modifies a file that's about to be deleted

**Section:** Step 1 (Files to modify: `server/stream-parser.ts`)

The Agent SDK migration plan (`plans/agent-sdk-migration.md`) replaces `stream-parser.ts` with `message-processor.ts` and deletes the original. The theming plan modifies `stream-parser.ts` to emit `TerminalMessage[]` instead of `string[]`. If both plans execute, the theming changes to `stream-parser.ts` will be lost when the SDK migration deletes it.

**Why this is plan-level:** This is a coordination dependency between two plans that affects architecture. The structured message type (`TerminalMessage`) needs to exist regardless of which backend processes events, so the type definition (in `shared/types.ts`) survives. But the server-side emission logic needs to be written for the SDK's `message-processor.ts`, not the soon-to-be-deleted `stream-parser.ts`.

**Suggested fix:** Add a note acknowledging the SDK migration dependency. Either (a) land theming first and accept the rework during SDK migration, (b) coordinate so theming's server-side changes target `message-processor.ts` directly, or (c) split the plan: land the type definitions and client-side rendering first (Steps 2-8), then adapt the server-side emission (Step 1) to whichever backend is current at implementation time.

---

### 8. [Medium] No "permission" message type for the most distinctive Claude Code visual element

**Section:** Step 1 (TerminalMessageType)

Claude Code's permission prompts — the highlighted blocks asking "Allow [tool]?" with yes/no options — are one of the most visually distinctive elements in the terminal. The extracted theme colors include a dedicated `permission` token (`rgb(177,185,249)` in dark). But the `TerminalMessageType` union has no `permission` type. Permission events would presumably be rendered as generic `tool_use` messages, losing the visual treatment that makes them instantly recognizable.

This matters especially in an orchestration context: when scanning multiple terminals, permission prompts are the most urgent "needs attention" signal. They should be visually louder than regular tool calls.

**Why this is plan-level:** Adding a new message type later means updating the type union, the stream parser mapping, and the renderer switch — touching 3 files that this plan already modifies.

**Suggested fix:** Add `'permission'` to `TerminalMessageType`. Map it from the stream parser when `tool_use` name is `AskUserQuestion` or when a permission request event is detected. Give it the `permission` color token with a distinct visual treatment in the renderer (highlighted block, border accent).

---

### 9. [Low] `dangerouslySetInnerHTML` retained for `ansi-to-html` in tool_result — XSS surface

**Section:** Step 4 (Update TerminalPeek)

The plan says to "keep `ansi-to-html` dep for tool_result only." The current code uses `dangerouslySetInnerHTML` with the `ansi-to-html` converter. If tool results contain user-controlled content (file contents, command output), this is an XSS vector. The converter does have some escaping, but it's designed for terminal output, not browser security.

**Why this is plan-level (borderline):** The architectural decision to keep `dangerouslySetInnerHTML` for one message type while all others use safe React rendering creates an inconsistent security posture. The alternative — rendering ANSI as styled spans via a React-native approach — would change the renderer architecture.

**Suggested fix:** Either sanitize the HTML output from `ansi-to-html` before injection (e.g., DOMPurify), or replace `ansi-to-html` with a React-based ANSI renderer like `ansi-to-react` that doesn't require `dangerouslySetInnerHTML`.

---

### 10. [Low] No theme-aware treatment for window chrome elements (title bar, traffic lights, resize handles)

**Section:** Step 4 (Update TerminalPeek), Step 7 (Update CSS)

The plan says "Keep title bar, traffic lights, resize handle styles" unchanged. But the title bar uses a fixed light gradient (`#e8e8e8` to `#c8c8c8`) and the resize handles use amber accents (`rgba(255, 176, 0, *)`). In the light terminal theme, the title bar gradient is fine (it mimics macOS), but the resize handle amber accents will look out of place. In the dark theme, the title bar gradient creates a jarring bright strip on an otherwise dark window. The floating window box-shadow (line 72-74 of `flow.css`) also uses an amber tint.

This isn't a blocker, but it undermines the "visually identical to Claude Code" goal — Claude Code's terminal doesn't have amber resize handles.

**Suggested fix:** Replace the amber accents in resize handles and box-shadow with theme-aware `var(--term-border)` or `var(--term-text-dim)` references. Consider making the title bar gradient theme-aware (dark title bar for dark themes, current light gradient for light themes).

---

### 11. [Impl-note] `AnsiToHtml` converter foreground color initialization uses hardcoded amber

**Section:** Step 4

Line 38 of `TerminalPeek.tsx`: `new AnsiToHtml({ fg: '#ffb000', bg: '#1a1a1a' })` — the fg/bg initialization needs to use theme values. Since the converter is memoized, it would need to re-instantiate when the theme changes. This is a straightforward implementation detail.

---

### 12. [Impl-note] MAX_LINES buffer limit (500 client-side, 200 server-side) may need adjustment for structured messages

**Section:** Step 5

Changing from `string[]` to `TerminalMessage[]` doesn't change the buffer limit, but the semantics shift. A single tool_use that previously produced 1 string line now produces 1 TerminalMessage object (which is richer). The effective visible content per buffer entry increases, so the limits may be fine as-is, but worth validating during implementation.

---

### 13. [Impl-note] Theme switching after initial selection needs a UI entry point

**Section:** Step 2

The plan mentions the ThemePicker is "reusable later as a settings panel" but doesn't define where the user accesses it post-first-boot. This is an implementation detail — a settings gear icon in the corner or a keyboard shortcut — but worth noting so it doesn't get forgotten.

---

## Cross-Plan Coordination Note

The Agent SDK migration and the terminal theming plan both modify the server-side event processing pipeline and share a dependency on the `terminal_data` protocol shape. If both are in-flight simultaneously, they need explicit coordination on:

1. Which file implements the `TerminalMessage` emission logic (stream-parser.ts vs message-processor.ts)
2. Whether the WebSocket protocol change (lines to messages) happens as part of theming or SDK migration
3. The server-side buffer type in `state.ts`

Recommendation: land one plan fully before starting the other, or merge Step 1 of the theming plan into the SDK migration's message-processor.ts scope.
