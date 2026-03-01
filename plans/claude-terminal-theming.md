---
revision: 6
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

### Step 1: Structured Terminal Messages ✅ (PR #19)

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
  toolUseId?: string;             // Links tool_use to its tool_result
  status?: 'running' | 'success' | 'error';  // Tool execution status
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
- `assistant` (`message.content[]` with `type: 'tool_use'`) → `{ type: 'tool_use', text: extractToolSummary(name, input), toolName: name, toolUseId: block.id, status: 'running' }`
- `assistant` (`message.content[]` with `type: 'tool_use'`, `AskUserQuestion`) → `{ type: 'human_needed', text: questionText }`
- `user` (`message.content[]` with `type: 'tool_result'`) → `{ type: 'tool_result', text: truncated, toolName: resolvedName }` (see "Tool result handling" below)
- `result` (success) → `{ type: 'system', text: 'Completed', costUsd: total_cost_usd }`
- `result` (error) → `{ type: 'error', text: errorMsg }`

> **Precedence rule:** When processing `assistant.content[]` tool_use blocks, check `name` first. If `name === 'AskUserQuestion'`, emit ONLY `{ type: 'human_needed', text: questionText }` — do NOT also emit a generic `tool_use` message. All other tool_use names emit `{ type: 'tool_use', ... }` as normal.

**Per-tool input extraction — `extractToolSummary(name, input)`:**

The `text` field on `tool_use` messages should be a human-readable summary, NOT the tool name (which is already in `toolName`). Add a helper function:

```typescript
function extractToolSummary(name: string, input: unknown): string {
  const inp = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  switch (name) {
    case 'Read':
      return typeof inp.file_path === 'string' ? inp.file_path : '';
    case 'Edit':
    case 'Write':
      return typeof inp.file_path === 'string' ? inp.file_path : '';
    case 'Bash': {
      const cmd = typeof inp.command === 'string' ? inp.command : '';
      return cmd.length > 60 ? cmd.slice(0, 60) + '...' : cmd;
    }
    case 'Glob':
      return typeof inp.pattern === 'string' ? inp.pattern : '';
    case 'Grep':
      return typeof inp.pattern === 'string' ? inp.pattern : '';
    case 'WebFetch':
      return typeof inp.url === 'string' ? inp.url : '';
    case 'Agent':
    case 'Task': {
      // Subagent: display subagent_type as name context, description as summary
      const subType = typeof inp.subagent_type === 'string' ? inp.subagent_type : '';
      const desc = typeof inp.description === 'string' ? inp.description : '';
      if (subType && desc) return `${subType}: ${desc.slice(0, 80)}`;
      return desc || subType || '';
    }
    default:
      return '';
  }
}
```

The tool_use mapping then becomes:
```typescript
messages.push({
  type: 'tool_use',
  text: extractToolSummary(name, input),
  toolName: name,
  toolUseId: String(block.id),
  status: 'running',
});
```

This replaces the old `text: name, toolName: name` pattern that caused the renderer to show `ToolName ToolName` (since `toolName` and `text` were identical and both displayed).

**Tool result handling — dual-path strategy (handleAssistant + handleUser):**

> **Empirical verification needed:** It is unconfirmed whether the SDK's `query()` async generator actually yields `user`-type messages. The SDK may only yield `assistant` and `result` events, with `user` messages being internal to the conversation but not emitted to the consumer. This MUST be verified empirically before relying solely on `handleUser()`.

**Safe approach: keep BOTH paths.** The existing `tool_result` handling in `handleAssistant()` (lines 162-177 of `message-processor.ts`) is NOT dead code — it fires when `tool_result` blocks appear in assistant content. KEEP this code and improve it (add `toolUseId` correlation, `isSuccess` field). ALSO add `handleUser()` as a secondary path. Whichever fires first for a given tool_result wins — use a `Set<string>` of already-emitted `toolUseId`s to deduplicate:

```typescript
// In the processor closure:
const emittedToolResults = new Set<string>();
```

When either path is about to emit a `tool_result`, check `emittedToolResults` first:
```typescript
const resultId = block.tool_use_id ? String(block.tool_use_id) : null;
if (resultId && emittedToolResults.has(resultId)) return; // Already emitted by other path
if (resultId) emittedToolResults.add(resultId);
```

**Path 1 — handleAssistant (existing, improve):** Keep the `else if (block.type === 'tool_result' ...)` branch. Enhance it to:
- Resolve tool name from `toolUseIdToName` map (not just raw `tool_use_id`)
- Set `isSuccess` from the `is_error` field
- Include `toolUseId` for client-side status correlation

**Path 2 — handleUser (new, additive):** Add as a secondary path in case the SDK does yield `user` messages:

1. A `case 'user'` branch in `processMessage()`:
```typescript
case 'user': {
  messages.push(...handleUser(msg as SDKUserMessage));
  break;
}
```

2. A `handleUser(msg: SDKUserMessage)` function that:
   - Iterates `msg.message.content` looking for `tool_result` blocks
   - Checks `emittedToolResults` to skip duplicates
   - Resolves the tool name from `toolUseIdToName` map
   - Determines success/failure from the `is_error` field
   - Emits `{ type: 'tool_result', text: truncated, toolName: resolvedName, toolUseId, isSuccess: !isError }`

3. A `toolUseIdToName: Map<string, string>` in the processor closure, populated when emitting tool_use messages:
```typescript
toolUseIdToName.set(String(block.id), name);
```

**User message echo:** In `server/index.ts`, when handling `send_input`, also broadcast `{ type: 'user_message', text }` to the terminal.

### Step 2: Theme System ✅ (PR #18)

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

### Step 3: Terminal Message Renderer ✅ (PR #21)

**New file:** `src/components/panels/TerminalMessageRenderer.tsx`

A switch-based component that renders each `TerminalMessage` with appropriate styling:

| Message Type | Visual Treatment |
|-------------|-----------------|
| `user_message` | Highlighted block with distinct background, left border accent |
| `assistant_text` | Regular terminal text color |
| `tool_use` | Status indicator + tool name in muted color + summary text. Status indicator: CSS spinner animation for `running`, green `●` for `success`, red `●` for `error`. |
| `tool_result` | Indented with `└` (U+2514) connector + result text in dim color. Collapsible when text exceeds ~3 lines. |
| `human_needed` | Highlighted block with `--term-human-needed-bg` background, `--term-human-needed-border` left border, `--term-human-needed-text` text color. Visually distinct to surface urgency. |
| `system` | Dim gray text |
| `error` | Red/error-colored text |

All colors via CSS custom properties — no hardcoded values.

**Tool use status indicators:**

The `tool_use` renderer reads `message.status` to determine which indicator to show:
- `'running'` — CSS-animated spinner (small rotating circle or pulsing dot via `@keyframes`)
- `'success'` — Green `●` (`var(--term-tool-success)`)
- `'error'` — Red `●` (`var(--term-tool-error)`)
- `undefined` — Fall back to green `●` for backward compatibility

```tsx
case 'tool_use': {
  const indicator = message.status === 'running'
    ? <span className="term-tool-spinner" />
    : <span style={{ color: message.status === 'error'
        ? 'var(--term-tool-error)' : 'var(--term-tool-success)' }}>●</span>;

  return (
    <div className="my-0.5 flex items-start gap-1.5">
      {indicator}
      <span>
        <span style={{ color: 'var(--term-tool-name)' }}>
          {message.toolName}
        </span>
        {message.text && (
          <span style={{ color: 'var(--term-text-dim)' }}>
            ({message.text})
          </span>
        )}
      </span>
    </div>
  );
}
```

CSS for the spinner:
```css
.term-tool-spinner {
  display: inline-block;
  width: 0.7em;
  height: 0.7em;
  border: 1.5px solid var(--term-tool-name);
  border-top-color: var(--term-tool-success);
  border-radius: 50%;
  animation: term-spin 0.8s linear infinite;
}
@keyframes term-spin {
  to { transform: rotate(360deg); }
}
```

**Tool result `└` connector:**

Tool results use the `└` box-drawing character (U+2514) as a visual connector to the preceding tool_use, instead of a colored bullet:

```tsx
case 'tool_result': {
  return (
    <div className="my-0.5 flex items-start gap-1.5 pl-4">
      <span style={{ color: 'var(--term-text-dim)' }}>└</span>
      <span style={{ color: 'var(--term-text-dim)' }}>{displayText}</span>
    </div>
  );
}
```

**Tool use status tracking — piggyback on tool_result messages:**

When the message processor emits a `tool_use` message, it sets `status: 'running'`. When the corresponding `tool_result` arrives, the original tool_use message's status needs to update to `success` or `error`. This is done by piggybacking on the existing `tool_result` message flow — no new wire protocol or store methods needed.

**Server side:** Every `tool_result` TerminalMessage emitted by the message processor MUST include `toolUseId` (the id of the tool_use it corresponds to). This is already available from the `tool_use_id` field on tool_result blocks and from the `toolUseIdToName` map. The server's `appendTerminalMessages()` in `server/state.ts` must also perform the correlation for replay consistency: when appending a `tool_result` with a `toolUseId`, scan the existing buffer for the matching `tool_use` message and set its `status` to `'success'` or `'error'` based on `isSuccess`.

**Client side:** In `useTerminal.ts`, the existing `appendMessages` action handles this — no new store method needed. When appending messages, if a message has `type === 'tool_result'` and a `toolUseId`, scan the existing buffer for the `tool_use` with the matching `toolUseId` and update its `status`:

```typescript
appendMessages: (nodeId: string, newMessages: TerminalMessage[]) => {
  set((state) => {
    const existing = state.buffers.get(nodeId) ?? [];
    const updated = [...existing];

    for (const msg of newMessages) {
      // Correlate tool_result → tool_use status
      if (msg.type === 'tool_result' && msg.toolUseId) {
        const toolUse = updated.find(
          m => m.type === 'tool_use' && m.toolUseId === msg.toolUseId
        );
        if (toolUse) {
          toolUse.status = msg.isSuccess === false ? 'error' : 'success';
        }
      }
      updated.push(msg);
    }

    return {
      buffers: new Map(state.buffers).set(nodeId, updated),
    };
  });
}
```

This keeps the wire protocol unchanged — `tool_result` messages already flow through `terminal_data`. Both server (for replay) and client (for live updates) perform the same correlation logic.

**Collapse/expand behavior for tool results:**

Tool result text that exceeds ~3 lines should default to collapsed. This is a renderer-only concern — the store does not track expand state.

- Use local component state (`useState`) to track `isExpanded`
- Count newlines in `message.text`; if > 3, default `isExpanded = false`
- Collapsed view: show first line + `... +N lines (click to expand)`
- Expanded view: show full text + `(click to collapse)` at the end
- Click handler toggles `isExpanded`

Because `tool_result` needs `useState` for collapse/expand, it MUST be a sub-component — hooks cannot be called inside switch cases. The parent switch dispatches to `<ToolResultMessage />`:

```tsx
// In TerminalMessageRenderer's switch:
case 'tool_result':
  return <ToolResultMessage message={message} />;

// Sub-component (same file or co-located):
function ToolResultMessage({ message }: { message: TerminalMessage }) {
  const lines = message.text.split('\n');
  const isLong = lines.length > 3;
  const [isExpanded, setIsExpanded] = useState(!isLong);
  const displayText = isExpanded ? message.text : lines[0] + `... +${lines.length - 1} lines`;

  return (
    <div className="my-0.5 flex items-start gap-1.5 pl-4">
      <span style={{ color: 'var(--term-text-dim)' }}>└</span>
      <span
        style={{ color: 'var(--term-text-dim)', cursor: isLong ? 'pointer' : 'default' }}
        onClick={isLong ? () => setIsExpanded(e => !e) : undefined}
      >
        {displayText}
      </span>
    </div>
  );
}
```

### Step 4: Update TerminalPeek ✅ (PR #19 + #21)

**File:** `src/components/panels/TerminalPeek.tsx`

Changes:
1. Replace `lines.map(...)` with `messages.map(msg => <TerminalMessageRenderer />)`
2. Remove `AnsiToHtml` import and converter (keep `ansi-to-html` dep for tool_result only)
3. Replace all hardcoded amber colors with `var(--term-*)` references
4. Remove `terminal-glow` class usage (amber glow isn't Claude Code style)
5. Keep all window mechanics unchanged (floating, drag, resize, scroll, tab trap, input)

### Step 5: Update useTerminal Store ✅ (PR #19)

**File:** `src/hooks/useTerminal.ts`

Change buffer type from `Map<string, string[]>` to `Map<string, TerminalMessage[]>`:
- `appendLines` → `appendMessages`
- `getLines` → `getMessages`

### Step 6: Update useWebSocket Hook ✅ (PR #19)

**File:** `src/hooks/useWebSocket.ts`

Change `appendLines(msg.nodeId, msg.lines)` to `appendMessages(msg.nodeId, msg.messages)`.

### Step 7: Update CSS ✅ (PR #20 + #21)

**File:** `src/styles/flow.css`

- Replace all hardcoded amber/retro colors with CSS custom property references
- Remove `.terminal-glow` class
- Add message-type CSS classes (`.term-msg-user`, `.term-msg-tool`, etc.)
- Keep title bar, traffic lights, resize handle styles (these are window chrome, not terminal content)

### Step 8: Wire ThemeProvider into App ✅ (PR #20)

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

## Issue Fixes

### Fix: Remove spurious "Completed" system message from terminal output

**Problem:** `server/message-processor.ts:275` emits `{ type: 'system', text: 'Completed', costUsd: msg.total_cost_usd }` in `handleResultSuccess()` after every turn. This renders as a visible "Completed" text line in the terminal. Claude Code does NOT show "Completed" as a message — it shows turn duration in the status area, not in the message stream. This is a Stems-only artifact that clutters the terminal.

**Fix:**
1. Remove or suppress the `messages.push({ type: 'system', text: 'Completed', costUsd: msg.total_cost_usd })` line at `message-processor.ts:275` — do not emit it as a visible terminal message.
2. Cost and duration info should remain as metadata on the node (which already happens via the `updateNode` call at lines 263-273 for `costUsd` and `tokenUsage`) — NOT as a terminal message.
3. Keep the `updateNode` cost tracking (lines 263-273) and its `broadcast({ type: 'node_updated', node: updated })` intact. Only remove the "Completed" terminal message push.

**File:** `server/message-processor.ts` — `handleResultSuccess()`

---

## Verification

1. **Start dev server:** `bun run dev`
2. **First-boot test:** Clear localStorage, reload — should see theme picker
3. **Select dark theme:** Verify mini terminal matches Claude Code's dark look
4. **Spawn a session:** Verify user messages, assistant text, tool calls, and errors each render with distinct styling
5. **Switch to light theme:** Verify all colors update correctly
6. **Reload:** Verify theme preference persists
7. **Visual comparison:** Open a real Claude Code terminal side-by-side with a Stems mini terminal displaying the same session — colors and layout should match
