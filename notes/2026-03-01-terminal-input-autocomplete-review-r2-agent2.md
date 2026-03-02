# UX/Interaction Review — Terminal Input Autocomplete Plan (Round 2)

## Prior Issue Status (Round 1 -> Round 2)

### Critical Issues

1. **Input element mismatch: `<input type="text">` vs `<textarea>`** -- FIXED.
   The plan now correctly references `<textarea>` throughout (line 9: "The mini terminal input is a `<textarea>` (multi-line, auto-resizing)"). Multi-line trigger detection is explicitly specified: scan backward from `selectionStart` to nearest `\n` or start-of-string, with each line treated independently (lines 13-14, 73-75). The `/` trigger correctly checks position relative to the current line start, not absolute position 0 of the full value. The `selectionStart` / auto-resize sequencing is also addressed (line 18: read cursor position before the resize DOM mutation).

2. **Tab key handling conflicts — incomplete priority chain** -- FIXED.
   The plan now specifies a complete Tab key priority chain (Step 6, lines 150-154) covering: (a) autocomplete open with items -> accept + `preventDefault()` + `stopPropagation()` + return `true`; (b) autocomplete open with empty list -> pass through; (c) Shift+Tab while autocomplete open -> pass through; (d) autocomplete closed -> pass through. The `stopPropagation()` call is explicitly mentioned to prevent the event from reaching `handleTabTrap`. This is thorough and correct.

### Must-Fix Issues

1. **No ARIA specification** -- FIXED.
   Step 5 now includes a full ARIA subsection (lines 135-138) specifying the WAI-ARIA combobox pattern: `role="combobox"` on the input container, `aria-expanded`, `aria-activedescendant`, `aria-controls`, `role="listbox"` on the dropdown, `role="option"` + `aria-selected` on items, and stable `id` attributes for linkage. The hook interface (Step 4, lines 110-111) now exposes `activeDescendantId` and `listboxId`.

2. **Enter key behavior unspecified** -- FIXED.
   Step 6 now specifies Enter behavior explicitly (lines 156-159): when autocomplete is open and an item is highlighted (`selectedIndex >= 0`), Enter accepts the item; when open but nothing highlighted (`selectedIndex === -1`), Enter dismisses the dropdown and falls through to the submit handler; when closed, existing behavior. This is a good design choice — it handles both the "I intended to pick from the dropdown" and "I want to submit" cases cleanly via the highlight state.

3. **Mouse/pointer interaction missing from hook interface** -- FIXED.
   The hook interface now includes `onItemClick(index)` and `onItemHover(index)` (lines 107-108). Step 5 specifies `onPointerEnter` for hover and `onClick` for acceptance (lines 132-133). This properly synchronizes keyboard and mouse navigation.

### Medium Issues

1. **Dropdown positioning / viewport overflow** -- NOT FIXED. See Medium Issues below.

2. **`@` trigger word-boundary check contradicts verification step** -- PARTIALLY FIXED. The plan now says "`@` anywhere in input" for the trigger rule (line 13) and specifies that trigger detection scans backward from cursor to find `@`. The Verification section still says "Verify dropdown doesn't appear for `@` in middle of word without space before it" (line 234), which still contradicts the trigger spec. See Medium Issues below.

3. **No blur/click-outside dismiss handler** -- NOT FIXED. See Medium Issues below.

4. **`onKeyDown` returns boolean but `accept()` is separate** -- FIXED. The plan now specifies that `onKeyDown` handles Tab, Enter, Escape, ArrowUp, and ArrowDown internally (lines 88-89). When returning `true`, the hook has already called `preventDefault()` and `stopPropagation()`. The caller just checks the boolean and skips its own logic. This eliminates the two-call timing issue for the caller, though `accept()` is still exposed separately for `onItemClick` use — which is appropriate.

5. **No IME/composition event handling** -- NOT FIXED. See Impl-Notes below (downgraded — see rationale).

### Low Issues

1. **Cache invalidation time-based only** -- Acknowledged in plan, no change needed.
2. **No loading state for dropdown** -- Not addressed. See Low Issues below.
3. **`--max-count` flag doesn't exist for `git ls-files`** -- NOT FIXED. Risk 1 still says "Could add `--max-count` flag if needed" (line 213). This is misleading — `git ls-files` does not support `--max-count`. See Low Issues below.
4. **Two-keystroke workflow for `/` commands** -- No change needed, design decision.
5. **No visual distinction between file types** -- No change needed, design decision.

---

## New Issues in Revision 2

### Must-Fix

1. **ARIA `role="combobox"` is placed on the wrong element**
   - **Section:** Step 5, line 136
   - The plan says "The input container gets `role="combobox"`". In the current TerminalPeek layout (TerminalPeek.tsx lines 314-338), the "input container" is the `<div>` wrapping the chevron and the textarea. But the WAI-ARIA combobox pattern requires that `role="combobox"` be placed on the *input element itself* — in this case, the `<textarea>`. The container `<div>` should not have `role="combobox"`. Similarly, `aria-activedescendant` and `aria-controls` belong on the `<textarea>`, not the container, because that is the element that has focus and that the screen reader is tracking. If `role="combobox"` is on the container `<div>`, a screen reader will not associate the listbox with the focused element, and `aria-activedescendant` will not work because the browser only respects it on the element that actually has DOM focus.
   - **Fix:** Change Step 5 to specify that `role="combobox"`, `aria-expanded`, `aria-activedescendant`, and `aria-controls` are attributes on the `<textarea>` element, not the surrounding `<div>`.

2. **`selectedIndex` initial state and Enter-to-accept create a submission trap**
   - **Section:** Step 4 (keyboard navigation), Step 6 (Enter key behavior)
   - The plan says ArrowUp/Down move `selectedIndex`, wrapping at boundaries (line 88). It also says Enter accepts when `selectedIndex >= 0` (line 157). But the plan does not specify the *initial* value of `selectedIndex` when the dropdown first opens. If `selectedIndex` starts at 0 (the first item), then typing `@s` and immediately pressing Enter will accept the first match instead of submitting the input — which breaks muscle memory for users who expect Enter to submit. If `selectedIndex` starts at -1 (nothing highlighted), then the first ArrowDown press should move to 0, and Enter submits as expected until the user actively navigates. The plan must specify the initial value. The `-1` convention (nothing highlighted until explicit navigation) is standard in combobox patterns and matches the plan's own logic at line 158 ("nothing highlighted -> dismiss and fall through").
   - **Fix:** Explicitly state that `selectedIndex` initializes to `-1` when the dropdown opens, and is only set to `>= 0` after an ArrowUp/Down keypress or a pointer hover.

### Medium Issues

1. **Dropdown positioning still assumes "above the input" with no overflow handling (carried from R1)**
   - **Section:** Step 5 (line 116), Step 6 (line 148)
   - The plan says the dropdown renders "above the textarea" and "above the input area." If the terminal window is dragged near the top of the viewport, the dropdown will be clipped or render offscreen. The terminal is a floating window that can be dragged anywhere (via `useFloatingWindow`), including positions where the input area is near the top of the browser viewport.
   - This is a plan-level issue because it affects the component interface: if the dropdown needs to flip positions, `AutocompleteDropdown` needs to know the available space above/below the input, which changes props/positioning logic from the start.
   - **Fix:** Add a note in Step 5 that the dropdown should measure available space and flip to below-input when space above is insufficient. Alternatively, note it as a follow-up enhancement with the initial implementation always rendering above (acceptable for v1 if documented as a known limitation).

2. **Verification step 10 still contradicts trigger spec (carried from R1, partially fixed)**
   - **Section:** Step 4 (line 74), Verification (line 234)
   - Step 4 says: "Scan backward from `selectionStart` toward `lineStart` looking for `@`." This means `@` anywhere after `lineStart` triggers autocomplete — including `user@domain`. Verification step 10 says "Verify dropdown doesn't appear for `@` in middle of word without space before it." These are still contradictory. The scan-backward approach would find `@` in `user@domain` and trigger autocomplete with query `domain`.
   - The trigger detection spec in Step 4 also says "Dismiss if query text between trigger and cursor contains a space" (line 76), which handles some cases but not the `user@domain` case (no space in `domain`).
   - **Fix:** Either (a) add a word-boundary check: `@` must be preceded by whitespace, start-of-line, or `(` / `[` / other non-word characters — and update Verification step 10 to match; or (b) remove Verification step 10 and accept that `@` triggers anywhere (simpler, matches Slack/Discord behavior where `@` always triggers). Pick one and make the plan internally consistent.

3. **No blur/click-outside dismiss handler (carried from R1)**
   - **Section:** Step 4
   - The dropdown dismisses on Escape and when the query contains a space, but nothing handles: (a) clicking in the terminal output area above the input; (b) clicking another node on the React Flow canvas; (c) the textarea losing focus for any reason (e.g., browser dev tools opening). In all these cases the dropdown would remain visible in a stale state, detached from the input context.
   - **Fix:** Add a `blur` event handler on the textarea that calls `dismiss()` (with a small delay to allow `onItemClick` to fire first, since `mousedown` on a dropdown item triggers `blur` before `click`). This is a standard pattern and affects the hook's event wiring, so it should be specified in the plan.

4. **`handleTabTrap` selector does not include `<textarea>` — tab cycling will skip the input**
   - **Section:** Step 6 (Tab key priority chain)
   - The existing `handleTabTrap` (TerminalPeek.tsx line 173) queries for focusable elements with the selector `'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'`. This selector does not match `<textarea>` elements. When Tab falls through from autocomplete (empty list or closed state), the tab trap will cycle between buttons only, skipping the textarea entirely. The textarea gets focus on mount but is not part of the tab cycle.
   - This is a pre-existing bug, but the plan introduces new Tab behavior that depends on the tab trap working correctly as a fallback. The plan should note this selector gap.
   - **Fix:** Add a note in Step 6 that `handleTabTrap`'s focusable-element selector needs to include `textarea:not([disabled])` to ensure the textarea participates in the tab cycle.

5. **Escape key `stopPropagation()` rationale is slightly wrong — the real risk is the Cmd+Plus/Minus handler**
   - **Section:** Step 6 (lines 161-162), Risk 5 (lines 220-221)
   - The plan says `stopPropagation()` on Escape prevents conflict with `useFloatingWindow`'s capture-phase listener, noting the conflict is "theoretical" because it's gated on `gestureRef.current`. This analysis is correct but incomplete. The `useFloatingWindow` Escape handler (useFloatingWindow.ts line 279-294) uses `window.addEventListener('keydown', ..., true)` (capture phase). Capture-phase listeners fire *before* bubble-phase listeners, so `stopPropagation()` in the textarea's bubble-phase `onKeyDown` cannot prevent the capture-phase listener from firing — it has already fired by then. The `stopPropagation()` is still useful for preventing the event from reaching `handleTabTrap` (which is a bubble-phase listener on the parent `<div>`), but the plan's stated rationale about `useFloatingWindow` is technically incorrect.
   - This is not a bug (the `gestureRef.current` gate handles it), but the plan's reasoning should be accurate to avoid confusion during implementation.
   - **Fix:** Update the rationale in Step 6 and Risk 5 to clarify that `stopPropagation()` prevents the event from reaching `handleTabTrap`, not `useFloatingWindow`'s capture-phase listener (which fires first regardless). The `useFloatingWindow` conflict is avoided by the `gestureRef.current` null check, not by `stopPropagation()`.

### Low Issues

1. **`--max-count` flag for `git ls-files` does not exist (carried from R1)**
   - **Section:** Risk 1, line 213
   - `git ls-files` does not support `--max-count`. The risk note suggests it as a mitigation but it would fail silently or error. The server-side 100-result cap after `includes` filtering is the correct mitigation.
   - **Fix:** Remove the `--max-count` reference or replace it with a valid alternative (e.g., piping through `head -n 1000` before the filter, or noting that the file list could be truncated server-side before filtering).

2. **No loading/empty state specified for the dropdown (carried from R1)**
   - **Section:** Step 5
   - When a debounced fetch is in-flight, the user sees either nothing or stale cached results. When zero results match, the plan doesn't specify whether the dropdown shows "No matches" or hides entirely. The difference matters for accessibility — a screen reader user hearing "0 results" vs silence has different expectations about whether the feature is working.
   - **Fix:** Add a brief note: dropdown hides when items array is empty (simplest approach) OR shows a "No matches" message (better for discoverability). Either is fine but should be stated.

3. **`aria-autocomplete` attribute missing from the ARIA spec**
   - **Section:** Step 5, lines 135-138
   - The ARIA combobox pattern specifies `aria-autocomplete="list"` on the input element to indicate that suggestions are provided. The plan lists `role`, `aria-expanded`, `aria-activedescendant`, `aria-controls`, but omits `aria-autocomplete`. Screen readers use this attribute to announce the autocomplete behavior to the user.
   - **Fix:** Add `aria-autocomplete="list"` to the textarea's ARIA attributes in Step 5.

---

## Impl-Notes

**IME composition handling (downgraded from R1 Medium):**
- During IME composition (`compositionstart` / `compositionend`), trigger detection should be suppressed. However, this is a standard implementation concern that won't cause architectural rework — it's a boolean flag (`isComposing`) checked in `onInputChange`. Log it as an implementation detail rather than a plan-level issue.

**`selectionStart` null check:**
- `e.target.selectionStart` on a `<textarea>` returns `number | null`. The hook's `onInputChange` takes `cursorPosition: number`. The call site needs a null guard. Straightforward implementation detail.

**Debounce cleanup on dismiss:**
- If the user types `@f`, waits 100ms, then hits Escape, the pending debounced fetch should be canceled to avoid the dropdown reappearing 50ms later. Standard debounce cleanup pattern.

**Race conditions in fetches:**
- Sequential queries (`@fo` then `@foo`) may produce out-of-order responses. Use an abort controller or monotonic request counter to discard stale responses.

**Scroll position interaction:**
- When the dropdown is open and new terminal messages arrive, auto-scroll could shift the dropdown's visual position if it's positioned relative to a scrolling container. The dropdown should be positioned relative to the input area (which is outside the scroll container), so this is likely fine given the current layout — but worth verifying during implementation.

**`onItemClick` blur race condition:**
- Clicking a dropdown item will trigger `blur` on the textarea before `click` fires on the item. If a blur-based dismiss handler is added (see Medium issue 3), it must use a short `setTimeout` (e.g., 150ms) or `requestAnimationFrame` to allow the click event to complete before dismissing. This is a well-known pattern in dropdown implementations.

**Cache key for file results:**
- The plan says file results are cached per `repoPath` with 30s TTL. Since `repoPath` comes from the server response, the first fetch must complete before caching can be keyed. Subsequent fetches for the same node can use the cached `repoPath`.

---

## Summary

Revision 2 addresses all Critical and Must-Fix issues from Round 1 well. The textarea acknowledgment, multi-line trigger detection, Tab/Enter/Escape key priority chains, ARIA specification, and mouse interaction are all properly specified now.

Two new Must-Fix issues emerged: (1) `role="combobox"` is placed on the container div instead of the textarea, which will break screen reader association with the focused element; (2) `selectedIndex` initial state is unspecified, creating ambiguity about whether Enter immediately accepts the first item or submits the input.

The carried-forward Medium issues (dropdown positioning overflow, `@` trigger boundary contradiction, click-outside dismiss) remain unaddressed. A new Medium issue was found: the existing `handleTabTrap` selector does not include `<textarea>`, so Tab fall-through from autocomplete won't cycle to the input correctly.

Overall the plan is in good shape. The Must-Fix items are small clarifications, not architectural changes. The Medium items are worth resolving to avoid implementation rework but none would require fundamental restructuring.
