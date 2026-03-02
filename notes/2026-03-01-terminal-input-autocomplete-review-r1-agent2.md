# UX/Interaction Review — Terminal Input Autocomplete Plan (Round 1)

## Critical Issues

1. **Input element mismatch: plan says `<input type="text">` but actual component uses `<textarea>`**
   - **Section:** Context ("The mini terminal input is a plain `<input type="text">`") and Step 4 (`onInputChange(value, e.target.selectionStart)`)
   - The existing `TerminalPeek.tsx` (line 304) uses a `<textarea>` with auto-resize, not an `<input>`. This changes how cursor position (`selectionStart`) behaves across line breaks, how the `onChange` handler interacts with the auto-resize logic, and how the dropdown should be positioned relative to multi-line input content. The plan's trigger detection logic ("scan backward from cursor position") works differently in a multi-line textarea vs single-line input — a `/` at position 0 of the second line would match the "position 0 only" rule if you only check `selectionStart === query.length`, but it should NOT trigger because the `/` is not at the start of the full input value.
   - **Fix:** Update the plan to reference `<textarea>`, and adjust the `/` trigger rule to check that the `/` is at index 0 of `value` (not just at the cursor-relative start of a line). Decide whether `@` triggers should work across newlines in multi-line input. The cursor-position-after-rerender risk (Risk 4) also compounds with textarea auto-resize, which mutates `el.style.height` inside `onChange` — this needs to be sequenced correctly with the autocomplete's `onInputChange` call.

2. **Tab key handling conflicts with textarea's native behavior and the existing tab trap — plan's priority chain is incomplete**
   - **Section:** Step 6 item 3-4 and Risk 3
   - The plan says "If autocomplete is open and key is Tab -> accept" and "skip tab trap when autocomplete is open." But it doesn't address these scenarios: (a) Tab when autocomplete is open but no items match (empty list) — should it accept nothing, dismiss, or fall through to the tab trap? (b) Shift+Tab when autocomplete is open — the tab trap handles Shift+Tab for reverse focus cycling, but the plan never mentions it. (c) The `handleKeyDown` on the textarea (line 131) currently only handles Enter; the plan adds autocomplete key handling there, but the tab trap (`handleTabTrap`, line 147) is on the outer `<div>` (line 226). Key events bubble from textarea to div, so if the textarea handler calls `e.preventDefault()` for Tab but doesn't `stopPropagation()`, the tab trap will still fire on the same event. The plan needs to specify `e.stopPropagation()` alongside `e.preventDefault()` for Tab acceptance.
   - **Fix:** Add explicit behavior for empty-list Tab, Shift+Tab during autocomplete, and specify `e.stopPropagation()` on Tab acceptance to prevent the event from reaching the tab trap handler on the parent div.

## Must-Fix Issues

1. **No accessibility (ARIA) specification for the autocomplete pattern**
   - **Sections:** Step 4 (useAutocomplete hook), Step 5 (AutocompleteDropdown)
   - The plan defines keyboard navigation and a dropdown but includes zero ARIA attributes. The WAI-ARIA combobox pattern requires: `role="combobox"` on the input container, `aria-expanded` reflecting dropdown state, `aria-activedescendant` pointing to the selected item's ID, `role="listbox"` on the dropdown, `role="option"` on each item, and `aria-autocomplete="list"` on the input. Without these, the autocomplete is invisible to screen readers — the user hears nothing when the dropdown opens, when items are highlighted, or when one is selected. This is a structural omission: the component interfaces and the dropdown component's rendered markup both need to account for ARIA from the start. Retrofitting it later means changing the hook's return interface (it needs to expose `activeDescendantId`), the item rendering (each needs a stable `id`), and the input's attributes.
   - **Fix:** Add an ARIA subsection to Step 5 specifying the combobox pattern. Extend the `UseAutocompleteReturn` interface in Step 4 to include `activeDescendantId: string | null` and `listboxId: string`. Extend `AutocompleteItem` or the rendered item to include a stable `id` for `aria-activedescendant` linkage.

2. **Enter key behavior when autocomplete is open is unspecified**
   - **Section:** Step 6, item 3
   - The plan specifies Tab to accept and Escape to dismiss, then says "Otherwise -> existing Enter handler." This means pressing Enter while the dropdown is visible and an item is highlighted will submit the input (the existing behavior), not select the item. This is a UX gotcha — in most autocomplete implementations (VS Code, GitHub, browser address bars), Enter also accepts the selected item. Users who are accustomed to pressing Enter to confirm a selection will instead send a half-typed `@src/comp` to the Claude session. The plan should make a deliberate choice here and document it.
   - **Fix:** Add Enter to the keyboard handling specification in Step 6. Either (a) Enter accepts the selected item when autocomplete is open (matching common autocomplete conventions), or (b) explicitly document that Enter always submits and only Tab accepts, with a rationale for the deviation.

3. **Mouse/pointer interaction with dropdown items is missing from the hook interface**
   - **Sections:** Step 4, Step 5, Step 7
   - Step 7 adds a CSS `:hover` style for `.autocomplete-item`, which implies mouse interaction is expected. But the `UseAutocompleteReturn` interface has no `onItemClick` or `onItemHover` callback. Step 5 describes the dropdown as "pure presentation" but doesn't specify click-to-select behavior. Users will see hover highlights and expect to click items. Without an `onItemClick` handler, the dropdown is keyboard-only despite visual hover feedback, which is a confusing mixed signal. Additionally, hovering over items should update `selectedIndex` so keyboard and mouse navigation stay in sync (otherwise, arrow-down after hovering over item 5 goes to item 1 instead of item 6).
   - **Fix:** Add `onItemClick(index: number)` and `onItemHover(index: number)` to the hook's return interface. Wire click to accept and hover to update `selectedIndex`.

## Medium Issues

1. **Dropdown positioning assumes "above the input" but doesn't account for terminal window position near the top of the viewport** — if the terminal is dragged near the top edge, the dropdown would render offscreen. The plan should note that the dropdown should flip to below-input when there isn't enough space above. (Section: Step 5, Step 6 item 5)

2. **`@` trigger has no word-boundary check — Verification step 10 contradicts the trigger spec** — The Verification section says "Verify dropdown doesn't appear for `@` in middle of word without space before it," but Step 4's trigger detection says "`@` anywhere in input." These are contradictory. The plan should specify whether `@` requires a preceding space/start-of-input or truly triggers anywhere. Email addresses (`user@domain`) and other `@` occurrences would false-trigger without a boundary check. (Sections: Step 4, Verification item 10)

3. **No handling for when the dropdown is open and the user clicks outside** — Escape dismisses, but clicking elsewhere in the terminal (the output area, the title bar, or another window) should also dismiss the dropdown. The plan doesn't specify a blur/click-outside handler. Without it, the dropdown can persist in a stale state. (Section: Step 4)

4. **`onKeyDown` returns `boolean` but `accept()` is a separate call — Tab handling requires two calls in sequence** — For Tab, the wiring code needs to check `autocomplete.isOpen`, call `e.preventDefault()` + `e.stopPropagation()`, call `accept()`, then update the input value and cursor. This two-step pattern (check + act) creates a timing window where `items` could change between `onKeyDown` and `accept`. A cleaner interface would have `onKeyDown` handle Tab internally and return the new value, rather than splitting the responsibility. (Section: Step 4, Step 6)

5. **No mention of IME (Input Method Editor) or composition event handling** — Users typing CJK characters or using other IME-based input methods generate `compositionstart`/`compositionend` events. During composition, autocomplete trigger detection should be suppressed (the intermediate characters are not meaningful yet). Without this, Japanese users typing `@` via IME would see the dropdown flash and potentially interfere with composition. (Section: Step 4)

## Low Issues

1. **Cache invalidation for file list is time-based only (30s TTL)** — If a user creates a new file and immediately tries to `@`-reference it, it won't appear for up to 30 seconds. Consider also invalidating on focus or on a manual refresh gesture. (Section: Step 4)

2. **No loading state specified for the dropdown** — When the debounced file fetch is in-flight, the user sees either stale results or an empty dropdown. A subtle loading indicator (dimmed text, spinner) would improve perceived responsiveness. (Section: Step 5)

3. **`--max-count` flag mentioned in Risks doesn't exist for `git ls-files`** — Risk 1 says "Could add `--max-count` flag if needed" but `git ls-files` doesn't support `--max-count` (that's a `git log` flag). The server-side 100-result cap is the correct mitigation; the risk note is just misleading. (Section: Risks, item 1)

4. **Verification step 8 ("Tab to accept, Enter to send") implies a two-keystroke workflow** — Accepting a command with Tab then pressing Enter is two keystrokes where one could suffice. For `/` commands specifically, Tab-accepting could auto-submit since the command is complete. This is a minor UX polish question. (Section: Verification)

5. **No visual distinction between file types in file results** — All file items get the same green `+` prefix. Distinguishing directories from files, or showing file extensions with icons, would improve scanability in large result sets. (Section: Step 5)

## Impl-Notes

**Cursor management:**
- The `requestAnimationFrame` approach in Risk 4 for cursor positioning is correct but may need a fallback — React's batched state updates in concurrent mode can defer the paint. A `useLayoutEffect` or `flushSync` approach might be more reliable for setting `selectionStart`/`selectionEnd` after accepting a completion.
- Textarea auto-resize in the existing `onChange` (line 307-312) mutates `el.style.height` synchronously. The autocomplete's `onInputChange` call should happen after this resize so the dropdown positioning accounts for the new textarea height.

**Debounce cleanup:**
- The 150ms debounce for file fetches should be canceled on unmount and on trigger dismissal. If the user types `@f`, waits 100ms, then hits Escape, the fetch should not fire 50ms later and reopen the dropdown.

**Race conditions in fetch:**
- If the user types `@fo` then quickly `@foo`, two fetches may be in flight. The second response should supersede the first even if it arrives earlier. Use an abort controller or a monotonic request ID to discard stale responses.

**Empty state:**
- When `@` is typed and zero files match, should the dropdown show "No matches" or just not appear? Similarly for `/` with no matching commands. The plan doesn't specify; implementer should decide.

**Scroll lock interaction:**
- When the dropdown is open and the user arrow-keys through items, the terminal output area behind it might be scrolling (auto-scroll on new messages). This could cause the dropdown to shift position visually. Consider pausing auto-scroll while the dropdown is open, or using `position: fixed` relative to the viewport.

**Focus management on dismiss:**
- After accepting a completion or dismissing the dropdown, focus should remain on the textarea. This is likely the default behavior, but worth verifying — some dropdown implementations steal focus to the list, which would cause the textarea to lose focus on dismiss.

**`selectionStart` on textarea:**
- `e.target.selectionStart` in the wiring (Step 6, item 2) returns `number | null` for textareas. The hook's `onInputChange` signature takes `cursorPosition: number` — a null check is needed at the call site.

## Summary

The plan has a solid structure and correctly identifies the main technical risks (tab conflicts, cursor position, large repos, session timing). However, it has two critical issues: it is designed around `<input type="text">` when the actual component uses a `<textarea>` (affecting trigger detection, cursor handling, and positioning), and the Tab key priority chain has gaps that will cause event bubbling conflicts with the existing tab trap. The plan also lacks any accessibility specification — the ARIA combobox pattern needs to be designed in from the start rather than retrofitted. The mouse interaction story (click-to-select, hover tracking) and Enter-to-accept behavior both need explicit decisions before implementation begins.
