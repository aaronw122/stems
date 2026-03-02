# Plan Review Summary

**Plan:** plans/terminal-input-autocomplete.md
**Rounds:** 3
**Final revision:** 3

## Issues Found & Fixed

### Round 1 (revision 1 → 2)

**Critical issues fixed:**

- **Input element mismatch:** Plan said `<input type="text">` but `TerminalPeek.tsx` uses a `<textarea>`. Fixed throughout: Context section updated, trigger detection updated to scan backward from `selectionStart` to nearest `\n` or start-of-string (treating each line independently), `/` trigger checks position relative to line start rather than absolute position 0, `selectionStart` read-before-DOM-mutation concern addressed explicitly.
- **Tab key priority chain incomplete:** Plan didn't address Shift+Tab, empty-list Tab, or event propagation order between the textarea handler and the parent `handleTabTrap`. Fixed with a complete four-case Tab priority chain in Step 6 (open with items, open with empty list, Shift+Tab while open, closed), with explicit `stopPropagation()` on all consumed keys.

**Must-fix issues fixed:**

- **`queryInstance` lifecycle / slash commands:** Plan proposed storing `queryInstance` on Session and calling `supportedCommands()` concurrently mid-stream. Fixed by switching to `queryInstance.initializationResult()` (already returns `commands: SlashCommand[]`), eliminating the concurrent-access concern. Endpoint now returns `source: 'session' | 'fallback'` so the client knows when to re-fetch rather than permanently caching a fallback result.
- **No ARIA specification:** Plan had zero accessibility attributes. Fixed with a full WAI-ARIA combobox spec in Step 5: `role="combobox"`, `aria-expanded`, `aria-activedescendant`, `aria-controls` on the input, `role="listbox"` on the dropdown, `role="option"` + `aria-selected` on items, stable `id` attributes for linkage. Hook interface extended with `activeDescendantId` and `listboxId`.
- **Enter key behavior unspecified:** Plan said Enter always submits even when dropdown is open. Fixed with three-case Enter behavior: accept when `selectedIndex >= 0`, dismiss-and-fall-through when `selectedIndex === -1`, pass-through when closed.
- **Mouse/pointer interaction missing:** Hook had no `onItemClick` or `onItemHover`. Fixed by adding both to the hook interface and wiring them to `onPointerEnter` and `onClick` in the dropdown component, keeping keyboard and mouse navigation synchronized.
- **`onKeyDown` event consumption ambiguity:** Unclear whether the hook or the caller was responsible for `preventDefault()`. Fixed by specifying the hook calls both `e.preventDefault()` and `e.stopPropagation()` internally for all consumed keys; boolean return signals the caller to skip its own logic.
- **Escape key conflict with `useFloatingWindow`:** `useFloatingWindow` registers a capture-phase `keydown` listener. Fixed with detailed analysis in Step 6 and Risk 5: the conflict is theoretical (gated on `gestureRef.current !== null`, impossible while typing), `stopPropagation()` specified as defensive practice to prevent bubbling to `handleTabTrap`.

### Round 2 (revision 2 → 3)

**Must-fix issues fixed:**

- **`handleTabTrap` selector excludes `<textarea>`:** The existing `handleTabTrap` queries `'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'` — `<textarea>` is not matched. Fixed by adding an explicit note in Step 6 to update the selector to include `textarea:not([disabled])`.
- **Dropdown clipped by `overflow-hidden`:** TerminalPeek's root div has `overflow-hidden`, which clips any dropdown positioned with `bottom: 100%` inside it. Fixed by mandating `createPortal` to `document.body` with absolute viewport positioning using `getBoundingClientRect()`. Plan also addresses textarea auto-resize interaction: recalculate portal position on every render when `isOpen` or via `ResizeObserver`.
- **ARIA `role="combobox"` on wrong element:** Plan placed it on the container `<div>` instead of the `<textarea>`. Fixed: Step 5 explicitly states these attributes go on the `<textarea>` itself (the element that receives keyboard input).
- **`selectedIndex` initial state unspecified:** Without specifying the initial value, the Enter key behavior was ambiguous. Fixed: `selectedIndex` initializes to `-1` when the dropdown opens, only becoming `>= 0` after explicit ArrowUp/ArrowDown navigation or pointer hover.

**Medium issues fixed in round 2 (resolved by round 3):**

- **`onChange` ordering guidance:** Step 6's instruction to read `selectionStart` "before the auto-resize DOM mutation" was reworded to "at the top of the onChange handler, before any state updates or DOM mutations."
- **`source: 'fallback'` re-fetch mechanism unspecified:** Step 2 now explicitly states the client should re-fetch after session init completes if `source === 'fallback'`; only cache results when `source === 'session'`.

## Remaining Issues

- **`@` trigger vs Verification step 10 contradiction:** Step 4 specifies `@` triggers anywhere in the input; Verification step 10 expects the dropdown NOT to appear for `@` in the middle of a word. The implementer must pick one: add a word-boundary check (preceding character is whitespace, start-of-line, or opening bracket) and keep step 10, or remove step 10 and accept `@` triggers anywhere (Slack/Discord behavior).
- **No blur/click-outside dismiss handler:** Clicking the terminal output area, another canvas node, or browser dev tools leaves the dropdown open in a stale state. Standard pattern (blur + setTimeout to allow click to fire first) — no architectural impact.
- **`AutocompleteItem` type in `shared/types.ts`:** Only used client-side; the server never returns this type. Should be in a client-side types file, not shared types. Convention issue only.
- **Files Summary count incorrect:** Lists `shared/types.ts` as a "New file" when it already exists (should be "Modified files"). Cosmetic.
- **`git ls-files --max-count` doesn't exist:** Risk 1 suggests this as a large-repo mitigation. The flag does not exist for `git ls-files`. The actual mitigation (100-result server-side cap) is already in the plan; the note is just misleading.
- **Hardcoded `rgba(0,0,0,0.3)` in Step 7 CSS:** Breaks the codebase's CSS variable theming convention. Should use `var(--term-shadow)`.
- **No loading state for dropdown:** Debounced fetch-in-flight shows either nothing or stale cached results. Acceptable for v1 if noted.
- **Step 5 parallel with Step 4 in diagram:** Implementation order diagram shows them as parallel without noting they share an interface contract that must be agreed on first.

## Implementation Notes

- **AbortController for file fetches:** The 150ms debounce limits burst requests but does not cancel in-flight fetches when the query changes. Use `AbortController` per fetch, or a monotonic request ID to discard stale responses when two fetches are in flight.
- **Non-git repo fallback:** `git ls-files` fails on directories that aren't git repos. Wrap the `Bun.spawn` call in try/catch and return an empty array rather than a 500.
- **Dropdown flip when near top of viewport:** Portal positioning uses `getBoundingClientRect()` — if the terminal is dragged near the top edge, the dropdown renders offscreen. Add space measurement and flip to below-input when space above is insufficient.
- **Debounce cleanup:** Cancel pending debounced fetches on Escape, on trigger dismissal, and on unmount. A stale fetch completing after Escape would silently reopen the dropdown.
- **`selectionStart` null check:** `e.target.selectionStart` on a `<textarea>` returns `number | null`. Add a null guard before passing to `onInputChange(value, cursorPos: number)`.
- **Cursor restoration after accept:** After `accept()` returns `{ newValue, newCursorPosition }` and `setInput(newValue)` is called, React resets `selectionStart` to end-of-string on re-render. Use `requestAnimationFrame` to set both `selectionStart` and `selectionEnd` to `newCursorPosition` after the paint.
- **Textarea auto-resize after accept:** Inserting a long file path via Tab-accept may change textarea height. The auto-resize `onChange` logic fires on user input events — ensure it also runs after the programmatic value update from accept.
- **Cache key includes query:** File results are cached per `repoPath`, but the server filters by `q` param and caps at 100 results. Cache key should be `repoPath + query`. Optimization: re-filter 100 cached results client-side before fetching; only re-fetch if all 100 match (suggesting more exist server-side).
- **IME composition handling:** During IME composition (`compositionstart`/`compositionend`), suppress trigger detection. A boolean `isComposing` flag checked in `onInputChange` is sufficient.
- **Subtask nodes always get fallback commands:** `sessions.delete(nodeId)` removes the session when a subtask completes. The commands endpoint returns fallback for any nodeId without an active session. Expected behavior, not a bug.
- **`onItemClick` blur race condition:** Clicking a dropdown item triggers `blur` on the textarea before `click` fires on the item. Any blur-based dismiss handler must use a short `setTimeout` (100–150ms) or `requestAnimationFrame` to allow the click to complete first.
- **Keyboard navigation wrap:** ArrowUp/Down in a `<textarea>` move the cursor between lines. When autocomplete is open, these keys must be fully consumed (`e.preventDefault()`) to prevent the textarea cursor from moving. If the user holds ArrowDown and the dropdown closes mid-keypress, the textarea will begin receiving arrow events again.
- **`scrollIntoView({ block: 'nearest' })` jitter:** Works well for most list lengths but can cause jitter if the dropdown container has complex overflow. Test with both short and long file lists.
- **Debounce as ref, not inline:** Avoid creating a new debounce function on every render. Use a `useRef` for the timeout ID and clear it in the hook's cleanup effect.

## Reviewer Personas Used

- **Architect** — Focused on server/client architecture, SDK lifecycle, data contracts, session state, endpoint design, and whether structural decisions would require rework during implementation.
- **UX/Interaction** — Focused on keyboard interaction model, accessibility (ARIA/screen readers), mouse interaction, edge cases in user input flows, IME handling, and consistency between the trigger spec and verification steps.
- **React/Frontend** — Focused on React patterns, component interfaces, event handling in the actual DOM structure, controlled input behavior, CSS/theming conventions, and integration with existing hooks (`useFloatingWindow`, `handleTabTrap`).
