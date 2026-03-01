---
revision: 3
---

# Plan: Claude Code Terminal Theming

## Context

The Stems mini terminals (TerminalPeek) currently use a retro amber monochrome aesthetic (#ffb000 on #1a1a1a). The goal is to make them visually identical to Claude Code running in macOS Terminal.app — with proper message type differentiation, dark/light/colorblind theme presets, first-boot theme selection, and persistent preference.

**Intent spec:** `docs/intents/claude-terminal-theming.md`

## Extracted Theme Colors (from Claude Code source)

All 6 theme color palettes were extracted directly from the installed Claude Code npm package (`cli.js`):

### Dark (default — `Xo9`)
| Token | Value |
|-------|-------|
| text | rgb(255,255,255) |
| secondaryText | rgb(153,153,153) |
| claude | rgb(215,119,87) |
| success | rgb(78,186,101) |
| error | rgb(255,107,128) |
| warning | rgb(255,193,7) |
| permission | rgb(177,185,249) |
| suggestion | rgb(177,185,249) |
| remember | rgb(177,185,249) |
| planMode | rgb(72,150,140) |
| autoAccept | rgb(175,135,255) |
| bashBorder | rgb(253,93,177) |
| secondaryBorder | rgb(136,136,136) |

### Light (`Yo9`)
| Token | Value |
|-------|-------|
| text | rgb(0,0,0) |
| secondaryText | rgb(102,102,102) |
| claude | rgb(215,119,87) |
| success | rgb(44,122,57) |
| error | rgb(171,43,63) |
| warning | rgb(150,108,30) |
| permission | rgb(87,105,247) |
| suggestion | rgb(87,105,247) |
| secondaryBorder | rgb(153,153,153) |

### Dark Daltonized (`Vo9`)
| Token | Value |
|-------|-------|
| text | rgb(255,255,255) |
| secondaryText | rgb(153,153,153) |
| claude | rgb(255,153,51) |
| success | rgb(51,153,255) |
| error | rgb(255,102,102) |
| warning | rgb(255,204,0) |
| permission | rgb(153,204,255) |
| suggestion | rgb(153,204,255) |

### Light Daltonized (`Fo9`)
| Token | Value |
|-------|-------|
| text | rgb(0,0,0) |
| secondaryText | rgb(102,102,102) |
| claude | rgb(255,153,51) |
| success | rgb(0,102,153) |
| error | rgb(204,0,0) |
| warning | rgb(255,153,0) |

### Dark ANSI (`Jo9`) / Light ANSI (`Wo9`)
Standard ANSI 16-color palette (for compatibility — lower priority).

---

## Implementation Steps

### Step 1: Structured Terminal Messages

> **Coordination: Agent SDK migration dependency.** The SDK migration plan (`plans/agent-sdk-migration.md`) deletes `server/stream-parser.ts` and replaces it with `server/message-processor.ts`, which processes typed SDK `MessageEvent`s instead of CLI stream-json events. **The SDK migration must land first.** All server-side extraction logic in this step should be implemented in `message-processor.ts`, and the event mappings below are written against the SDK's `MessageEvent` types (e.g., `content_block_start`, `content_block_delta`, tool_use embedded in `assistant.content[]`), not CLI stream-json event types.

**Why:** The message processor currently outputs plain `string[]`. To style different message types differently, we need typed message objects.

**Files to modify:**
- `shared/types.ts` — Add `TerminalMessage` type, update `terminal_data` message
- `server/message-processor.ts` — Emit `TerminalMessage[]` instead of `string[]`
- `server/state.ts` — Update buffer type from `string[]` to `TerminalMessage[]`. Functions requiring signature changes:
  - `broadcastTerminal(nodeId, messages: TerminalMessage[])` (was `lines: string[]`)
  - `appendTerminalLines()` → rename to `appendTerminalMessages()` (accepts `TerminalMessage[]`)
  - `getTerminalLines()` → rename to `getTerminalMessages()` (returns `TerminalMessage[]`)
- `server/index.ts` — Echo user input as `user_message` type to terminal
- `server/context-summary.ts` — Serialize `TerminalMessage[]` back to plain text (e.g., `messages.map(m => m.text).join('\n')`) before passing to the summarization prompt

**New type:**
```typescript
export type TerminalMessageType =
  | 'assistant_text'    // Claude's response text
  | 'user_message'      // Echoed user input
  | 'tool_use'          // Tool invocation: "● Read file.ts"
  | 'tool_result'       // Tool output/result
  | 'human_needed'      // Human attention needed (e.g., AskUserQuestion)
  | 'system'            // Session lifecycle (completed, cost)
  | 'error';            // Errors

export interface TerminalMessage {
  type: TerminalMessageType;
  text: string;
  toolName?: string;
  isSuccess?: boolean;
  costUsd?: number;
}
```

> **Deferred: thinking indicators.** Thinking indicators are deferred until the Agent SDK's thinking/extended-thinking block behavior is confirmed. If the SDK emits `thinking` content blocks, a `thinking` message type can be added in a follow-up.

**Protocol change:**
```typescript
// Before
{ type: 'terminal_data'; nodeId: string; lines: string[] }
{ type: 'terminal_replay'; nodeId: string; lines: string[] }
// After
{ type: 'terminal_data'; nodeId: string; messages: TerminalMessage[] }
{ type: 'terminal_replay'; nodeId: string; messages: TerminalMessage[] }
```

**Files affected by `terminal_replay` change:**
- `shared/types.ts` — update `terminal_replay` message type (`lines` → `messages: TerminalMessage[]`)
- `server/index.ts` — replay handler must send `messages` instead of `lines`
- `src/hooks/useWebSocket.ts` — replay message handler must use `msg.messages` instead of `msg.lines`

> **Atomic changeset:** `terminal_data` and `terminal_replay` protocol changes must land together with the client-side handlers (useWebSocket, useTerminal) in a single branch/PR to avoid breaking the client.

**Message processor mappings (SDK `MessageEvent` types):**
- `stream_event` (`content_block_delta`, type `text_delta`) → `{ type: 'assistant_text', text: delta.text }`
- `assistant` (`message.content[]` with `type: 'tool_use'`) → `{ type: 'tool_use', text: name, toolName: name }`
- `assistant` (`message.content[]` with `type: 'tool_use'`, `AskUserQuestion`) → `{ type: 'human_needed', text: questionText }`
- `assistant` (`message.content[]` with `type: 'tool_result'`) → `{ type: 'tool_result', text: truncated, toolName: name }`
- `result` (success) → `{ type: 'system', text: 'Completed', costUsd: total_cost_usd }`
- `result` (error) → `{ type: 'error', text: errorMsg }`

> **Precedence rule:** When processing `assistant.content[]` tool_use blocks, check `name` first. If `name === 'AskUserQuestion'`, emit ONLY `{ type: 'human_needed', text: questionText }` — do NOT also emit a generic `tool_use` message. All other tool_use names emit `{ type: 'tool_use', ... }` as normal.

**User message echo:** In `server/index.ts`, when handling `send_input`, also broadcast `{ type: 'user_message', text }` to the terminal.

### Step 2: Theme System

**New files to create:**
- `src/themes/types.ts` — ThemeId, ThemeTokens interface
- `src/themes/themes.ts` — 6 theme preset definitions using extracted Claude Code colors
- `src/themes/ThemeProvider.tsx` — React context + CSS custom property application
- `src/themes/ThemePicker.tsx` — First-boot theme selection modal

**ThemeId:** `'dark' | 'light' | 'dark-daltonized' | 'light-daltonized' | 'dark-ansi' | 'light-ansi'`

**Theme tokens (CSS custom properties):**
- `--term-bg`, `--term-text`, `--term-text-dim`
- `--term-user-bg`, `--term-user-text`, `--term-user-border`
- `--term-tool-success`, `--term-tool-error`, `--term-tool-name`
- `--term-thinking-indicator`, `--term-thinking-text`
- `--term-system-text`, `--term-error-text`
- `--term-input-bg`, `--term-input-border`, `--term-input-text`
- `--term-btn-bg`, `--term-btn-text`
- `--term-border`, `--term-shadow`

**CSS Variable → Source Token → Fallback mapping:**

Not all themes define every token (Dark has 13, Light has 9, Daltonized variants fewer). Every CSS variable must resolve in every theme. The table below defines the source token and fallback chain for missing tokens.

| CSS Variable | Source Token | Fallback (if token missing) |
|---|---|---|
| `--term-bg` | *(hardcoded)* | Dark: `rgb(14,14,14)`, Light: `rgb(245,245,245)` |
| `--term-text` | `text` | — (present in all themes) |
| `--term-text-dim` | `secondaryText` | — (present in all themes) |
| `--term-user-bg` | `claude` + 15% opacity | — (`claude` present in all themes) |
| `--term-user-text` | `text` | — |
| `--term-user-border` | `claude` | — |
| `--term-tool-success` | `success` | — (present in all themes) |
| `--term-tool-error` | `error` | — (present in all themes) |
| `--term-tool-name` | `secondaryText` | — |
| `--term-thinking-indicator` | `planMode` | Falls back to `claude` (missing in Light, all Daltonized) |
| `--term-thinking-text` | `secondaryText` | — |
| `--term-system-text` | `secondaryText` | — |
| `--term-error-text` | `error` | — |
| `--term-human-needed-bg` | `permission` + 15% opacity | Falls back to `suggestion` + 15%; then `claude` + 15% (missing in Light Daltonized) |
| `--term-human-needed-text` | `permission` | Falls back to `suggestion`; then `claude` |
| `--term-human-needed-border` | `permission` | Falls back to `suggestion`; then `claude` |
| `--term-input-bg` | *(hardcoded)* | Dark: `rgba(255,255,255,0.05)`, Light: `rgba(0,0,0,0.05)` |
| `--term-input-border` | `secondaryBorder` | Falls back to `secondaryText` (missing in Daltonized variants) |
| `--term-input-text` | `text` | — |
| `--term-btn-bg` | `claude` | — |
| `--term-btn-text` | `text` | — |
| `--term-border` | `secondaryBorder` | Falls back to `secondaryText` |
| `--term-shadow` | *(hardcoded)* | Dark: `rgba(0,0,0,0.5)`, Light: `rgba(0,0,0,0.15)` |
| `--term-bash-border` | `bashBorder` | Falls back to `secondaryBorder`; then `secondaryText` (missing in Light, all Daltonized) |

Implement the fallback chain in `src/themes/themes.ts` at definition time — resolve each CSS variable to a concrete value per theme so the runtime never hits undefined.

**Dark theme background:** Terminal-dependent. For dark themes, use a near-black background (`rgb(14,14,14)` or similar). For light themes, use a light gray (`rgb(245,245,245)`).

**ThemeProvider behavior:**
1. On mount, check `localStorage.getItem('stems-theme')`
2. If no saved theme → default to `'dark'` and apply its CSS custom properties immediately
3. Apply CSS custom properties to `document.documentElement`, always render children
4. Check `localStorage.getItem('stems-theme-chosen')` — if absent (first visit), render `<ThemePicker>` as a **dismissible modal overlay** on top of the app (not blocking children)
5. When user picks a theme or dismisses the modal, set `stems-theme-chosen` flag in localStorage
6. Expose `{ themeId, setTheme }` via React context

**ThemePicker:** Simple modal overlay with 6 cards — each shows theme name and a small color swatch preview. Clicking selects, saves, and dismisses. Has a close/dismiss button for users who want to keep the default. Reusable later as a settings panel.

### Step 3: Terminal Message Renderer

**New file:** `src/components/panels/TerminalMessageRenderer.tsx`

A switch-based component that renders each `TerminalMessage` with appropriate styling:

| Message Type | Visual Treatment |
|-------------|-----------------|
| `user_message` | Highlighted block with distinct background, left border accent |
| `assistant_text` | Regular terminal text color |
| `tool_use` | Green `●` bullet + tool name in muted color |
| `tool_result` | Indented result text, success/error colored bullet |
| `human_needed` | Highlighted block with `--term-human-needed-bg` background, `--term-human-needed-border` left border, `--term-human-needed-text` text color. Visually distinct to surface urgency. |
| `system` | Dim gray text |
| `error` | Red/error-colored text |

All colors via CSS custom properties — no hardcoded values.

### Step 4: Update TerminalPeek

**File:** `src/components/panels/TerminalPeek.tsx`

Changes:
1. Replace `lines.map(...)` with `messages.map(msg => <TerminalMessageRenderer />)`
2. Remove `AnsiToHtml` import and converter (keep `ansi-to-html` dep for tool_result only)
3. Replace all hardcoded amber colors with `var(--term-*)` references
4. Remove `terminal-glow` class usage (amber glow isn't Claude Code style)
5. Keep all window mechanics unchanged (floating, drag, resize, scroll, tab trap, input)

### Step 5: Update useTerminal Store

**File:** `src/hooks/useTerminal.ts`

Change buffer type from `Map<string, string[]>` to `Map<string, TerminalMessage[]>`:
- `appendLines` → `appendMessages`
- `getLines` → `getMessages`

### Step 6: Update useWebSocket Hook

**File:** `src/hooks/useWebSocket.ts`

Change `appendLines(msg.nodeId, msg.lines)` to `appendMessages(msg.nodeId, msg.messages)`.

### Step 7: Update CSS

**File:** `src/styles/flow.css`

- Replace all hardcoded amber/retro colors with CSS custom property references
- Remove `.terminal-glow` class
- Add message-type CSS classes (`.term-msg-user`, `.term-msg-tool`, etc.)
- Keep title bar, traffic lights, resize handle styles (these are window chrome, not terminal content)

### Step 8: Wire ThemeProvider into App

**File:** `src/main.tsx`

Wrap `<App>` with `<ThemeProvider>`. The app renders immediately with the dark theme as default; the first-boot picker appears as a dismissible overlay.

---

## Implementation Order

Steps 1, 2 are independent and can be done in parallel. Steps 3-7 depend on both. Step 8 is the final wiring.

**Suggested sequence:** 1 → 2 → 3 → 4+5+6 (together) → 7 → 8

Note: Steps 1 and 4+5+6 must land together or the client breaks (server sends `messages` but client expects `lines`). Build on the same branch, test together.

---

## Files Summary

**New files (5):**
| File | Purpose |
|------|---------|
| `src/themes/types.ts` | Theme type definitions |
| `src/themes/themes.ts` | 6 theme presets with Claude Code colors |
| `src/themes/ThemeProvider.tsx` | Context + CSS var application + first-visit overlay |
| `src/themes/ThemePicker.tsx` | Theme selection UI |
| `src/components/panels/TerminalMessageRenderer.tsx` | Per-message-type renderer |

**Modified files (10):**
| File | Change |
|------|--------|
| `shared/types.ts` | Add TerminalMessage type, update terminal_data + terminal_replay |
| `server/message-processor.ts` | Emit TerminalMessage[] |
| `server/state.ts` | Update buffer type, rename functions (see Step 1) |
| `server/index.ts` | Echo user input to terminal, update replay handler |
| `server/context-summary.ts` | Serialize TerminalMessage[] to plain text for summarization |
| `src/hooks/useTerminal.ts` | Buffer type string[] → TerminalMessage[] |
| `src/hooks/useWebSocket.ts` | lines → messages handler (terminal_data + terminal_replay) |
| `src/components/panels/TerminalPeek.tsx` | New renderer, theme vars, remove amber |
| `src/styles/flow.css` | CSS vars, message-type classes, remove retro amber |
| `src/main.tsx` | Wrap with ThemeProvider |

---

## Verification

1. **Start dev server:** `bun run dev`
2. **First-boot test:** Clear localStorage, reload — should see theme picker
3. **Select dark theme:** Verify mini terminal matches Claude Code's dark look
4. **Spawn a session:** Verify user messages, assistant text, tool calls, and errors each render with distinct styling
5. **Switch to light theme:** Verify all colors update correctly
6. **Reload:** Verify theme preference persists
7. **Visual comparison:** Open a real Claude Code terminal side-by-side with a Stems mini terminal displaying the same session — colors and layout should match
