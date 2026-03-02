---
revision: 3
---

# Plan: Terminal Input Autocomplete (`@` files, `/` commands)

## Context

The mini terminal input is a `<textarea>` (multi-line, auto-resizing). Users need to reference file paths and slash commands frequently, but currently type them blind. Claude Code's real REPL has `@` file search and `/` command autocomplete with keyboard navigation — this plan brings the same to Stems.

## How It Works

- **`@` anywhere in input** → dropdown of repo files, filtered as you type. Each line is treated independently: scan backward from `selectionStart` to the nearest `\n` or start-of-string to find triggers.
- **`/` as the first character on the current line** → dropdown of slash commands with descriptions. Determined by scanning backward from `selectionStart` to the nearest `\n` or start-of-string and checking if `/` is at that position.
- **Arrow keys** navigate, **Tab** accepts, **Enter** (when item highlighted) accepts, **Escape** dismisses
- Dropdown appears above the input area

**Important:** `selectionStart` must be read from the textarea element _before_ any DOM mutations. The existing `onChange` handler mutates `el.style.height` synchronously for auto-resize — read cursor position first, then resize.

---

## Step 1: Server — File Listing Endpoint

**File:** `server/index.ts`

Add `GET /api/files/:nodeId?q=<query>` REST endpoint:
- Use `findRepoPath(nodeId)` to resolve repo root
- Run `git ls-files --cached --others --exclude-standard` via `Bun.spawn` to get gitignore-respecting file list
- Filter server-side by `q` param (case-insensitive `includes`)
- Cap at 100 results
- Return `{ files: string[], repoPath: string }`

Place it after the existing `/api/pick-folder` block (~line 409), following the same pattern.

## Step 2: Server — Slash Commands Endpoint

**Files:** `server/session.ts`, `server/index.ts`

**session.ts changes:**
- Add `slashCommands: SlashCommand[] | null` to `Session` interface
- In `consumeTurn`, after the `init` message is received, call `queryInstance.initializationResult()` which returns `SDKControlInitializeResponse` containing `commands: SlashCommand[]`. Store the `commands` array on the session.
- No need to store `queryInstance` on Session — `initializationResult()` can be called inline after init and resolves from cached data.
- Export `getSlashCommands(nodeId)` getter

**index.ts changes:**
- Add `GET /api/commands/:nodeId` endpoint
- Returns `{ commands: SlashCommand[], source: 'session' | 'fallback' }` — session's slash commands when available, or a hardcoded fallback for built-in commands (`help`, `clear`, `compact`, `cost`, `model`, `status`, etc.) when the session hasn't initialized yet
- The `source` field lets the client know whether to re-fetch later: if `source === 'fallback'`, the client should re-fetch after session init completes (to avoid permanently caching the hardcoded fallback)

**SDK types available:** `SlashCommand` from `@anthropic-ai/claude-agent-sdk` — `{ name: string, description: string, argumentHint: string }`. `SDKControlInitializeResponse` is also available (returned by `queryInstance.initializationResult()`).

## Step 3: Shared Types

**File:** `shared/types.ts`

Add autocomplete types:

```typescript
export interface AutocompleteItem {
  label: string;       // filename or command name
  detail?: string;     // path context or command description
  insertText: string;  // what gets inserted on Tab
}
```

## Step 4: Client — `useAutocomplete` Hook

**New file:** `src/hooks/useAutocomplete.ts`

Core state machine managing trigger detection, fetching, filtering, and keyboard navigation.

**Trigger detection (multi-line aware):**
- Find the current line start: scan backward from `selectionStart` to the nearest `\n` or start-of-string (index 0). Call this `lineStart`.
- **`@` trigger:** Scan backward from `selectionStart` toward `lineStart` looking for `@`. Each line is treated independently — do not cross `\n` boundaries. Extract query text between the `@` and cursor.
- **`/` trigger:** Check if `value[lineStart] === '/'`. Only triggers when `/` is the first character on the current line.
- Dismiss if query text between trigger and cursor contains a space (user moved past the mention).

**Fetching:**
- `@` trigger: debounce 150ms, then `fetch('/api/files/${nodeId}?q=${query}')`
- `/` trigger: fetch `/api/commands/${nodeId}` once and cache for session lifetime
- File results cached per `repoPath` with 30s TTL

**Filtering:**
- Files: case-insensitive `includes` on the query (server does primary filter, client re-filters cached results)
- Commands: case-insensitive `startsWith` on command name

**Keyboard navigation:**
- `selectedIndex` initializes to `-1` when the dropdown opens. It only becomes `>= 0` after explicit ArrowUp/ArrowDown navigation or pointer hover (`onItemHover`). This matches standard combobox behavior: Enter submits the input by default until the user actively navigates the list.
- Arrow Up/Down move `selectedIndex`, wrapping at boundaries
- `onKeyDown(e)` returns `true` if event was consumed, `false` otherwise. When returning `true`, the hook internally calls both `e.preventDefault()` and `e.stopPropagation()` on the event for all consumed keys (ArrowUp, ArrowDown, Tab, Escape, Enter-when-open-and-highlighted). This means the caller (`handleKeyDown` in TerminalPeek) can simply check the boolean return value and skip its own logic for that key — matching the existing pattern.

**Selection (Tab accept):**
- Returns `{ newValue, newCursorPosition }` — the full input string with the trigger+query replaced by the selected item's `insertText`
- For `@`: replaces `@query` with the file path at the trigger position
- For `/`: replaces entire input with `/commandName `

**Interface:**
```typescript
interface UseAutocompleteReturn {
  items: AutocompleteItem[];
  selectedIndex: number;
  triggerType: '@' | '/' | null;
  isOpen: boolean;
  onInputChange: (value: string, cursorPosition: number) => void;
  onKeyDown: (e: React.KeyboardEvent) => boolean;  // true = consumed (preventDefault + stopPropagation already called)
  accept: () => { newValue: string; newCursorPosition: number } | null;
  dismiss: () => void;
  onItemClick: (index: number) => void;   // accepts the item at index
  onItemHover: (index: number) => void;   // updates selectedIndex on pointer hover
  // ARIA support
  activeDescendantId: string | null;  // id of the currently highlighted item (for aria-activedescendant)
  listboxId: string;                  // stable id for the listbox element (for aria-controls)
}
```

## Step 5: Client — `AutocompleteDropdown` Component

**New file:** `src/components/panels/AutocompleteDropdown.tsx`

Pure presentation — renders the filtered item list above the input.

**Portal rendering (required — overflow-hidden workaround):**
TerminalPeek's root div uses Tailwind `overflow-hidden` (line 232 in TerminalPeek.tsx). A dropdown positioned inside this container will be clipped/invisible. The dropdown **must** be rendered via `createPortal` to `document.body`. Position it absolutely in the viewport using coordinates from the textarea's `getBoundingClientRect()`. Since the textarea auto-resizes (height changes on input), recalculate portal position whenever the textarea's dimensions change — either on every render when `isOpen` is true, or via a `ResizeObserver` on the textarea element.

**Styling (themed):**
- Background: `var(--term-bg)`, border: `var(--term-input-border)`
- Selected item: `var(--term-user-bg)` background
- File items: green prefix `+ ` with `var(--term-tool-success)` color (matches Claude Code screenshot)
- Command items: `/name` in `var(--term-text)`, description in `var(--term-text-dim)`
- Max height: ~240px (8 items), scrollable
- Box shadow for visual separation from terminal content

**Selected item auto-scrolls** into view via `scrollIntoView({ block: 'nearest' })`.

**Mouse/pointer interaction:**
- Each item calls `onItemHover(index)` on `onPointerEnter` to update `selectedIndex`
- Each item calls `onItemClick(index)` on `onClick` to accept the item

**ARIA (WAI-ARIA combobox pattern):**
- The `<textarea>` itself gets `role="combobox"`, `aria-expanded={isOpen}`, `aria-activedescendant={activeDescendantId}`, and `aria-controls={listboxId}`. WAI-ARIA requires these attributes on the element that receives keyboard input — not a wrapper div.
- The dropdown list gets `role="listbox"`, `id={listboxId}`
- Each item gets `role="option"`, `aria-selected={index === selectedIndex}`, and a stable `id` attribute (e.g., `${listboxId}-option-${index}`) — this id is what `activeDescendantId` points to

## Step 6: Client — Wire into TerminalPeek

**File:** `src/components/panels/TerminalPeek.tsx`

**Changes:**
1. Import and call `useAutocomplete(nodeId)`
2. Replace `onChange` handler: read `e.target.selectionStart` _before_ the auto-resize DOM mutation (`el.style.height = ...`), then call `autocomplete.onInputChange(value, cursorPos)`
3. Update `handleKeyDown` — delegate to `autocomplete.onKeyDown(e)` first. If it returns `true`, the hook has already called `preventDefault()` + `stopPropagation()` and the event is fully consumed; skip all further handling. Otherwise fall through to the existing Enter-to-submit logic.
4. Wrap input area in `position: relative` container and render `<AutocompleteDropdown>` above the textarea when `autocomplete.isOpen`

**Fix `handleTabTrap` selector:** The existing `handleTabTrap` in TerminalPeek queries `'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'` — this excludes `<textarea>` elements. The Tab priority chain below depends on the focus trap including the textarea. Update the selector to include `textarea:not([disabled])`.

**Tab key priority chain** (handled inside `autocomplete.onKeyDown`):
1. **Autocomplete open with items → Tab:** accept selection, `preventDefault()` + `stopPropagation()`, return `true`. The `stopPropagation()` prevents the event from reaching `handleTabTrap` on the root div.
2. **Autocomplete open with empty list → Tab:** pass through (return `false`) — let event bubble to focus trap.
3. **Shift+Tab while autocomplete open:** always pass through (return `false`) — focus trap handles it.
4. **Autocomplete closed → Tab:** pass through — focus trap handles it.

**Enter key behavior** (handled inside `autocomplete.onKeyDown`):
- **Autocomplete open + item highlighted (`selectedIndex >= 0`):** accept the selected item, `preventDefault()` + `stopPropagation()`, return `true`. Rationale: prevents accidental submission when the user intended to pick from the dropdown.
- **Autocomplete open + nothing highlighted (`selectedIndex === -1`):** dismiss dropdown, return `false` — let the event fall through to the existing Enter-to-submit handler.
- **Autocomplete closed:** return `false` — existing Enter handler runs.

**Escape key behavior** (handled inside `autocomplete.onKeyDown`):
- When autocomplete is open, call `dismiss()`, `preventDefault()` + `stopPropagation()`, return `true`. The `stopPropagation()` prevents the event from bubbling to `handleTabTrap` on the root div. Note: `useFloatingWindow`'s capture-phase Escape listener only acts when `gestureRef.current` is non-null (during active drag/resize), so the conflict is theoretical — but `stopPropagation()` is still good practice to prevent unexpected interactions.

## Step 7: CSS

**File:** `src/styles/flow.css`

Minimal additions:
```css
.autocomplete-dropdown { box-shadow: 0 -4px 12px rgba(0,0,0,0.3); }
.autocomplete-item:hover { background: var(--term-user-bg); }
```

---

## Files Summary

**New files (3):**
| File | Purpose |
|------|---------|
| `src/hooks/useAutocomplete.ts` | Trigger detection, fetch, filter, keyboard nav |
| `src/components/panels/AutocompleteDropdown.tsx` | Dropdown presentation component |
| `shared/types.ts` | `AutocompleteItem` type (addition) |

**Modified files (4):**
| File | Change |
|------|--------|
| `server/index.ts` | Add `/api/files/:nodeId` and `/api/commands/:nodeId` endpoints |
| `server/session.ts` | Capture `slashCommands` from SDK, export getter |
| `src/components/panels/TerminalPeek.tsx` | Wire autocomplete hook + dropdown |
| `src/styles/flow.css` | Dropdown hover/shadow styles |

---

## Implementation Order

```
Step 1 (server /api/files)      ─┐
Step 2 (server /api/commands)    ├─ Parallel (independent)
Step 3 (shared types)            │
Step 7 (CSS)                    ─┘
                                  │
Step 4 (useAutocomplete hook)   ──┤ Depends on endpoints + types
Step 5 (AutocompleteDropdown)   ──┤ Can parallel with Step 4
                                  │
Step 6 (TerminalPeek wiring)   ──┘ Depends on Steps 4 + 5
```

---

## Risks

1. **Large repos:** `git ls-files` on a monorepo could be slow. Mitigated by server-side `q` filtering and 100-result cap. Could add `--max-count` flag if needed.

2. **`initializationResult()` timing:** Only works after session init. Fall back to hardcoded built-in commands for pre-session nodes. The `source` field in the endpoint response lets the client know to re-fetch once the session initializes.

3. **Tab key conflict:** TerminalPeek has a tab trap (`handleTabTrap` on the root div) for focus cycling. The autocomplete hook handles Tab internally with `stopPropagation()` + `preventDefault()` when accepting a selection, which prevents the event from reaching the focus trap. See Step 6 Tab priority chain.

4. **Cursor position after React re-render:** `selectionStart` gets reset on controlled textarea state changes. Fix: use `requestAnimationFrame` to set cursor after React paints.

5. **Escape key layering:** `useFloatingWindow` registers a capture-phase Escape listener on `window` for canceling drag/resize gestures, but it's gated on `gestureRef.current !== null`. The autocomplete Escape handler in the textarea's `onKeyDown` fires in bubble phase, so it runs after the capture listener. Conflict only arises if the user somehow triggers Escape during an active drag while autocomplete is open — highly unlikely. The autocomplete handler's `stopPropagation()` is defensive.

## Verification

1. `bun run dev`
2. Open a terminal for a repo node
3. Type `@` → see file list appear above input
4. Type `@src/comp` → see filtered results
5. Arrow down to select, Tab to insert → `src/components/...` inserted at cursor
6. Type `/` at start of empty input → see command list
7. Type `/co` → filtered to `/compact`, `/cost`, `/context`, etc.
8. Tab to accept, Enter to send
9. Escape dismisses dropdown
10. Verify dropdown doesn't appear for `@` in middle of word without space before it
