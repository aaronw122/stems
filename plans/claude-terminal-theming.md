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

**Why:** The stream parser currently outputs plain `string[]`. To style different message types differently, we need typed message objects.

**Files to modify:**
- `shared/types.ts` — Add `TerminalMessage` type, update `terminal_data` message
- `server/stream-parser.ts` — Emit `TerminalMessage[]` instead of `string[]`
- `server/state.ts` — Update buffer type from `string[]` to `TerminalMessage[]`
- `server/index.ts` — Echo user input as `user_message` type to terminal

**New type:**
```typescript
export type TerminalMessageType =
  | 'assistant_text'    // Claude's response text
  | 'user_message'      // Echoed user input
  | 'tool_use'          // Tool invocation: "● Read file.ts"
  | 'tool_result'       // Tool output/result
  | 'thinking'          // "✻ Cogitated for Xs"
  | 'system'            // Session lifecycle (completed, cost)
  | 'error';            // Errors

export interface TerminalMessage {
  type: TerminalMessageType;
  text: string;
  toolName?: string;
  isSuccess?: boolean;
  durationSec?: number;
  costUsd?: number;
}
```

**Protocol change:**
```typescript
// Before
{ type: 'terminal_data'; nodeId: string; lines: string[] }
// After
{ type: 'terminal_data'; nodeId: string; messages: TerminalMessage[] }
```

**Stream parser changes (per event type):**
- `assistant` / `content_block_delta` → `{ type: 'assistant_text', text }`
- `tool_use` → `{ type: 'tool_use', text: name, toolName: name }`
- `tool_result` → `{ type: 'tool_result', text: truncated, toolName: name }`
- `result` → `{ type: 'system', text: 'Completed', costUsd }`
- `error` → `{ type: 'error', text: errorMsg }`

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

**Dark theme background:** Terminal-dependent. For dark themes, use a near-black background (`rgb(14,14,14)` or similar). For light themes, use a light gray (`rgb(245,245,245)`).

**ThemeProvider behavior:**
1. On mount, check `localStorage.getItem('stems-theme')`
2. If null → render `<ThemePicker>` instead of children
3. If set → apply CSS custom properties to `document.documentElement`, render children
4. Expose `{ themeId, setTheme }` via React context

**ThemePicker:** Simple modal with 6 cards — each shows theme name and a small color swatch preview. Clicking selects and saves. Reusable later as a settings panel.

### Step 3: Terminal Message Renderer

**New file:** `src/components/panels/TerminalMessageRenderer.tsx`

A switch-based component that renders each `TerminalMessage` with appropriate styling:

| Message Type | Visual Treatment |
|-------------|-----------------|
| `user_message` | Highlighted block with distinct background, left border accent |
| `assistant_text` | Regular terminal text color |
| `tool_use` | Green `●` bullet + tool name in muted color |
| `tool_result` | Indented result text, success/error colored bullet |
| `thinking` | Pink `✻` + italic "Thinking..." / "Cogitated for Xs" |
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

Wrap `<App>` with `<ThemeProvider>` so the first-boot picker gates the app.

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
| `src/themes/ThemeProvider.tsx` | Context + CSS var application + first-boot gate |
| `src/themes/ThemePicker.tsx` | Theme selection UI |
| `src/components/panels/TerminalMessageRenderer.tsx` | Per-message-type renderer |

**Modified files (7):**
| File | Change |
|------|--------|
| `shared/types.ts` | Add TerminalMessage type, update terminal_data |
| `server/stream-parser.ts` | Emit TerminalMessage[] |
| `server/state.ts` | Update buffer type |
| `server/index.ts` | Echo user input to terminal |
| `src/hooks/useTerminal.ts` | Buffer type string[] → TerminalMessage[] |
| `src/hooks/useWebSocket.ts` | lines → messages handler |
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
