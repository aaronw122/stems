# React/Frontend Review — Terminal Input Autocomplete Plan (Round 2)

## Prior Issue Resolution Status

### Critical Issues from Round 1

1. **Input element mismatch (`<input>` vs `<textarea>`)** -- FIXED. The plan's Context section now correctly identifies the input as a `<textarea>` (line 9). Multi-line trigger detection is thoroughly specified: scan backward from `selectionStart` to the nearest `\n` or start-of-string (Step 4, lines 73-76). Each line is treated independently, preventing phantom triggers from `@` on previous lines. The `selectionStart` read-before-DOM-mutation concern is addressed explicitly in the "Important" note (line 18) and reiterated in Step 6 point 2.

2. **`supportedCommands()` vs `initializationResult()` conflation** -- FIXED. The plan now uses `queryInstance.initializationResult()` consistently (Step 2, line 41). The plan also correctly notes that `queryInstance` does not need to be stored on Session, since `initializationResult()` resolves from cached data (line 42). The approach is clean and matches the SDK's intended API surface.

### Must-Fix Issues from Round 1

1. **Tab key conflict / precedence chain** -- FIXED. Step 6 now contains an explicit "Tab key priority chain" (lines 150-154) with four cases: autocomplete open with items, autocomplete open with empty list, Shift+Tab while open, and autocomplete closed. The `stopPropagation()` call to prevent bubble-up to `handleTabTrap` is specified (line 151).

2. **`onKeyDown` event consumption model ambiguity** -- FIXED. The interface now clearly specifies that the hook calls `e.preventDefault()` and `e.stopPropagation()` internally for consumed keys (Step 4, line 89; Step 6, line 147). The boolean return is explicitly documented as a signal for the caller to skip its own logic. The JSDoc-style comment on the interface (`// true = consumed (preventDefault + stopPropagation already called)`, line 104) makes the contract clear.

3. **Escape key conflict with `useFloatingWindow`** -- FIXED. The plan now contains detailed analysis of the Escape key layering in Step 6 (lines 161-162) and in Risk #5 (lines 221-222). The analysis correctly identifies that `useFloatingWindow`'s capture-phase listener is gated on `gestureRef.current !== null` and that the autocomplete handler fires in bubble phase. `stopPropagation()` is specified as defensive. This is thorough.

4. **Dropdown positioning / overflow** -- NOT FIXED. See new issue below.

### Medium Issues from Round 1

1. **`useAutocomplete` hook missing `nodeId` parameter** -- FIXED. Step 6 explicitly shows `useAutocomplete(nodeId)` (line 145). The hook's function signature is implied but not shown in Step 4; however, Step 6 makes the contract unambiguous.

2. **File caching strategy staleness** -- Acknowledged. Risk #1 (line 213) covers the large repo case but doesn't address cache invalidation. The 30s TTL (Step 4, line 82) is reasonable for v1. This is an acceptable tradeoff; no plan change needed.

3. **`AutocompleteItem` in `shared/types.ts` vs client-only** -- NOT FIXED. The type is still placed in `shared/types.ts` (Step 3, lines 56-63) despite only being used by the frontend. The server returns `{ files: string[], repoPath: string }` (Step 1, line 31) and `{ commands: SlashCommand[] }` (Step 2, line 47) -- neither uses `AutocompleteItem`. This is a convention issue, not a correctness issue, so I'm downgrading it to Low.

4. **Files Summary lists `shared/types.ts` as "New file"** -- NOT FIXED. The Files Summary table (line 183) still lists `shared/types.ts` under "New files (3)" when it should be under "Modified files." This is cosmetic but could confuse an implementor into thinking they need to create a new file.

### Low Issues from Round 1

1. **Verification step 10 vs trigger detection spec** -- PARTIALLY FIXED. The trigger detection now specifies multi-line awareness (scan backward from cursor, stop at newline boundaries), which is good. However, the question of whether `@` requires a word boundary before it (e.g., `foo@bar` -- should this trigger?) is still unresolved. The verification step 10 expects word-boundary awareness, but Step 4 says "`@` anywhere" with no word-boundary requirement. This inconsistency remains.

2. **No loading state for file fetch** -- Still unspecified. This is fine for v1.

3. **CSS hardcoded `rgba(0,0,0,0.3)` vs `var(--term-shadow)`** -- Still present in Step 7 (line 170). `var(--term-shadow)` exists in the codebase (`src/themes/themes.ts`, line 154) and is already used in `flow.css` (line 69). The hardcoded value breaks the theming convention. Remains Low.

---

## New Issues in Round 2

### Must-Fix

1. **Dropdown positioning still lacks overflow handling -- original Round 1 issue #4 was not addressed**
   - **Section:** Step 5 ("renders the filtered item list above the input"), Step 6 point 4 ("Wrap input area in `position: relative` container")
   - The plan specifies `position: relative` on the input container and rendering the dropdown above the textarea. But TerminalPeek's root element has `overflow: hidden` via the Tailwind class `overflow-hidden` on the root div (line 232 of `TerminalPeek.tsx`). A dropdown positioned with `bottom: 100%` (or equivalent) inside a `position: relative` container within this `overflow-hidden` parent will be clipped -- the dropdown simply won't be visible when it extends above the input area's bounds within the terminal window.
   - The terminal content area (`scrollRef` div, line 279) has `overflow-y: auto`, but the dropdown is outside this scroll area (it's in the input region at the bottom). The root div's `overflow-hidden` is the problem.
   - **Suggested fix:** Specify one of: (a) change the root div's overflow from `hidden` to `visible` and handle the visual clipping differently (e.g., via the inner scroll container), (b) use a React portal to render the dropdown outside the terminal window DOM tree and position it absolutely relative to the viewport, or (c) render the dropdown inside the scroll area (below the messages, above the input) which would avoid clipping but may look odd. Option (b) is the most robust. The plan should address this because it determines the component's DOM placement and rendering strategy, which would require rework if discovered during implementation.

### Medium

1. **`handleTabTrap` focusable query selector excludes `<textarea>` elements**
   - **Section:** Step 6 (Tab key priority chain)
   - The existing `handleTabTrap` (line 173 of `TerminalPeek.tsx`) uses `root.querySelectorAll('button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])')`. This selector does not include `textarea`. The textarea element is focusable by default but is not found by this query. This means the focus trap's "first" and "last" focusable element calculations do not include the textarea. If the user presses Tab from the textarea (when autocomplete is closed), the focus trap may not behave as expected -- the trap won't know the textarea is a valid focus target for cycling.
   - This is a pre-existing bug in `TerminalPeek.tsx`, not introduced by the autocomplete plan. However, the plan builds on top of this focus trap behavior (Step 6 Tab priority chain) without noting the gap. The autocomplete's `stopPropagation()` prevents the Tab event from reaching `handleTabTrap` when accepting a selection, so autocomplete itself works fine. But when autocomplete is closed and Tab falls through, the focus trap has this blind spot.
   - **Suggested fix:** Add a note in Step 6 to update the `handleTabTrap` selector to include `textarea:not([disabled])`. This is a small fix that should happen alongside the autocomplete wiring to avoid confusing focus behavior.

2. **Enter key behavior when autocomplete is open but `selectedIndex` starts at what value?**
   - **Section:** Step 4 (keyboard navigation), Step 6 (Enter key behavior)
   - The plan specifies Enter-when-open-and-highlighted accepts the item (lines 157-158), and Enter-when-open-but-nothing-highlighted dismisses and falls through (line 158). But Step 4 never specifies the initial value of `selectedIndex` when the dropdown first opens. If it starts at `0` (first item highlighted), then pressing Enter immediately after `@` triggers would always accept the first item -- the user can never "Enter to submit" while the dropdown is visible without first pressing Escape. If it starts at `-1` (nothing highlighted), Enter falls through to submit, and the user must arrow-down first. This initial value choice significantly affects UX.
   - Claude Code's real REPL starts with the first item highlighted. The plan should specify this explicitly.
   - **Suggested fix:** Add to Step 4: "`selectedIndex` initializes to `0` when the dropdown opens (first item pre-selected). Arrow keys move from there." Or if the intent is `-1`, state that. Either way, the behavior must be specified because the Enter key logic depends on it.

### Low

1. **ARIA combobox pattern is well-specified but `aria-controls` requires the listbox to be in the DOM**
   - **Section:** Step 5 (ARIA section)
   - The plan says the input container gets `aria-controls={listboxId}` (line 136). The WAI-ARIA combobox pattern requires that the element referenced by `aria-controls` exists in the DOM when `aria-expanded` is true. If the dropdown is conditionally rendered (`autocomplete.isOpen && <AutocompleteDropdown ...>`), it will be removed from the DOM when closed. When `aria-expanded` is false, `aria-controls` should either still point to a valid element or be omitted. Most implementations keep the listbox in the DOM but hide it visually. The plan should note whether the dropdown is conditionally rendered or always present but hidden.
   - This is minor and won't cause functional issues, but screen reader users may get a broken reference.

2. **`onItemClick` and `accept` have overlapping responsibilities**
   - **Section:** Step 4 interface (lines 105-107)
   - The interface exposes both `accept()` (returns `{ newValue, newCursorPosition }`) and `onItemClick(index)` (accepts the item at index). The caller (TerminalPeek) needs to know how to handle the state update after either path. For keyboard accept (Tab/Enter), the hook returns the new value via `accept()` and the caller updates the textarea. For mouse click, `onItemClick(index)` is called -- but does it also return the new value? Or does it internally update something? The plan doesn't clarify whether `onItemClick` calls `accept` internally or whether the caller must call `accept` after `onItemClick`. This ambiguity is minor but could cause confusion during implementation.
   - **Suggested fix:** Clarify in Step 4 that `onItemClick(index)` sets `selectedIndex = index` and then calls `accept()` internally, returning the result. Or specify that it fires a callback the caller provides.

3. **Files Summary count is wrong**
   - **Section:** Files Summary (line 178)
   - The summary says "New files (3)" but lists `shared/types.ts` as one of them. Since `shared/types.ts` already exists, there are only 2 new files. This was flagged in Round 1 and remains unfixed.

## Impl-Notes

**`position: relative` container and textarea auto-resize interaction:**
- When the autocomplete dropdown is open and the user types more text, the textarea auto-resizes (height grows), which shifts the dropdown position. If the dropdown is positioned with `bottom: 100%` relative to the input container, it will naturally track the input's position. But if using a portal (per the overflow fix), the dropdown position must be recalculated on every input change. Consider using `ResizeObserver` on the input container or recalculating position in the `onInputChange` callback.

**Debounce cleanup on unmount:**
- The 150ms debounce for `@` triggers (Step 4, line 79) needs to clean up pending timeouts when the component unmounts or when `nodeId` changes. Use a `useRef` for the timeout ID and clear it in the hook's cleanup effect. This is standard but worth noting because a stale fetch callback could call `setState` on an unmounted component.

**Cache key design (follow-up from Round 1):**
- The plan says "File results cached per `repoPath` with 30s TTL" (line 82). Since the server filters by `q` param and caps at 100, the cache key should be `repoPath + query`. But if the user types `@s`, gets 100 results, then types `@sr`, the client should re-filter the 100 cached results first and only re-fetch if the cached results are exhausted (all 100 match, suggesting more exist server-side). The plan doesn't specify this optimization, but it would reduce network round-trips. Log as impl-note; the basic approach works.

**Textarea `selectionStart` after programmatic value update:**
- When `accept()` returns `{ newValue, newCursorPosition }`, the caller updates the textarea value via `setInput(newValue)`. React will re-render, and `selectionStart`/`selectionEnd` will reset to the end of the string. The `requestAnimationFrame` approach mentioned in Risk #4 (line 219) is needed to restore cursor position. The implementation should set both `selectionStart` and `selectionEnd` to `newCursorPosition` in the rAF callback to avoid creating a selection range.

## Summary

The plan has addressed the most important issues from Round 1: the textarea/input mismatch, the `supportedCommands` vs `initializationResult` confusion, the Tab/Enter/Escape key precedence chains, and the event consumption model. These were the issues most likely to cause architectural rework.

The one carried-over must-fix is the dropdown overflow/clipping problem. The terminal window's root `overflow-hidden` will clip the dropdown when it renders above the input. This needs a DOM strategy decision (portal vs overflow change) before implementation, as it affects where and how the component is rendered.

The new medium issues -- the focus trap selector excluding textarea, and the unspecified initial `selectedIndex` value -- are worth addressing in the plan because they affect user-facing behavior and the Tab/Enter key logic that the plan carefully specified.

Overall, this is now a solid plan. The remaining issues are fixable with targeted additions rather than structural changes.
