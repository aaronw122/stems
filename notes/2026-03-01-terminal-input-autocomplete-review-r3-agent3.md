# React/Frontend Review — Terminal Input Autocomplete Plan (Round 3 — Final Verification)

## Prior Issue Resolution

### Round 1 Critical Issues

1. **Input element mismatch (`<input>` vs `<textarea>`)** -- RESOLVED. The plan's Context section (line 9) correctly identifies the input as a `<textarea>`. Multi-line trigger detection is thoroughly specified in Step 4 (lines 73-76): scan backward from `selectionStart` to nearest `\n` or start-of-string, treat each line independently. The `selectionStart` read-before-DOM-mutation concern is addressed in the "Important" note (line 18) and reiterated in Step 6 point 2 (line 150). Verified against actual code: the textarea is at line 324 of `TerminalPeek.tsx` with the auto-resize `onChange` handler at lines 327-333. The plan's guidance to read cursor position before `el.style.height` mutations is correct and necessary.

2. **`supportedCommands()` vs `initializationResult()` conflation** -- RESOLVED. Step 2 (lines 41-42) now consistently uses `queryInstance.initializationResult()` returning `SDKControlInitializeResponse` containing `commands: SlashCommand[]`. The plan correctly notes `queryInstance` does not need to be stored on Session. The `source` field on the endpoint response (line 48) enables the client to know when to re-fetch, which cleanly handles the timing problem.

### Round 1 Must-Fix Issues

1. **Tab key conflict / precedence chain** -- RESOLVED. Step 6 contains an explicit "Tab key priority chain" (lines 156-159) covering four cases: autocomplete open with items, open with empty list, Shift+Tab while open, and autocomplete closed. `stopPropagation()` is specified (line 157) to prevent bubble-up to `handleTabTrap`.

2. **`onKeyDown` event consumption model ambiguity** -- RESOLVED. Step 4 (lines 89-90) specifies the hook internally calls both `e.preventDefault()` and `e.stopPropagation()` for all consumed keys. The interface comment on line 105 (`// true = consumed (preventDefault + stopPropagation already called)`) makes the contract explicit. The caller simply checks the boolean return.

3. **Escape key conflict with `useFloatingWindow`** -- RESOLVED. Step 6 (lines 167-168) and Risk #5 (lines 226-228) provide detailed analysis. Verified against actual code: `useFloatingWindow.ts` lines 277-294 show the capture-phase Escape listener gated on `gestureRef.current !== null`. The plan correctly identifies that both handlers firing simultaneously is practically impossible (can't be mid-drag and typing), and specifies `stopPropagation()` as defensive practice.

4. **Dropdown positioning / overflow** -- RESOLVED. This was carried over as the sole unresolved must-fix in Round 2. Step 5 (lines 122-123) now explicitly calls out the `overflow-hidden` problem on TerminalPeek's root div (line 232 of the actual code confirms: `overflow-hidden` class is present). The plan mandates `createPortal` to `document.body` with absolute viewport positioning using `getBoundingClientRect()`. It also addresses the textarea auto-resize interaction: recalculate portal position whenever textarea dimensions change, either on every render when `isOpen` or via `ResizeObserver`. This is the correct approach and avoids the clipping problem entirely.

### Round 2 Must-Fix Issues

(Round 2 had no must-fix issues beyond the carried-over dropdown positioning, resolved above.)

### Round 2 Medium Issues (checking resolution since they were flagged as worth addressing)

1. **`handleTabTrap` focusable selector excludes `<textarea>`** -- RESOLVED. Step 6 (lines 154) now explicitly calls out this pre-existing bug and specifies updating the selector to include `textarea:not([disabled])`. Verified against actual code: line 173-174 of `TerminalPeek.tsx` confirms the selector currently only has `button`, `input`, and `[tabindex]` -- no `textarea`.

2. **Initial `selectedIndex` value unspecified** -- RESOLVED. Step 4 (line 88) now explicitly states: "`selectedIndex` initializes to `-1` when the dropdown opens." The plan specifies it only becomes `>= 0` after explicit ArrowUp/ArrowDown navigation or pointer hover (`onItemHover`). The Enter key behavior in Step 6 (lines 162-165) is consistent with this: `selectedIndex === -1` means Enter dismisses the dropdown and falls through to submit, which is standard combobox behavior.

### Round 1/2 Remaining Low and Medium Issues (not requiring plan changes, tracked for completeness)

- **`AutocompleteItem` in `shared/types.ts` vs client-only**: Still placed in shared types (Step 3, lines 56-63). Convention issue, not correctness. No rework risk.
- **Files Summary lists `shared/types.ts` as "New file"**: Still says "New files (3)" (line 184) when it should be 2 new + 1 modified. Cosmetic. An implementor checking `shared/types.ts` will immediately see it exists.
- **Verification step 10 vs trigger detection spec**: The trigger detection in Step 4 says "`@` anywhere in input" while verification step 10 expects word-boundary awareness. The multi-line scan-backward-to-newline logic prevents cross-line phantom triggers, but `foo@bar` within a single line would still trigger. This inconsistency remains but is a UX tuning decision, not an architectural one.
- **CSS hardcoded `rgba(0,0,0,0.3)`**: Still present in Step 7 (line 176). Should use a theme variable. No rework risk.

## New Issues

None. After thorough review of the plan against the actual codebase:

- The portal rendering strategy in Step 5 correctly addresses the `overflow-hidden` constraint on the root div (line 232 of `TerminalPeek.tsx`).
- The Escape key layering analysis matches the actual capture-phase listener implementation in `useFloatingWindow.ts` (lines 277-294).
- The `handleTabTrap` selector fix (Step 6, line 154) targets the correct code (line 173-174 of `TerminalPeek.tsx`).
- The `selectionStart`-before-DOM-mutation guidance aligns with the actual auto-resize handler (lines 330-332 of `TerminalPeek.tsx`).
- The `handleKeyDown` delegation pattern (Step 6 point 3) integrates cleanly with the existing handler at lines 151-158 of `TerminalPeek.tsx`.

No issues that would cause significant architectural rework if discovered during implementation.

## Summary

All Critical and Must-fix issues from Rounds 1 and 2 are resolved. The plan at revision 3 is implementation-ready. The key improvements since Round 1 -- correct textarea identification, `initializationResult()` API, portal-based dropdown rendering, explicit key event precedence chains, `handleTabTrap` selector fix, and `selectedIndex` initialization -- address every concern that would have caused rework during implementation. The remaining low-severity items (shared types placement, files summary count, word-boundary trigger behavior, hardcoded CSS value) are cosmetic or tuning decisions that can be handled inline during implementation.
