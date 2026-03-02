# Architect Review — Terminal Input Autocomplete Plan (Round 3 — Final Verification)

## Prior Issue Resolution

### Round 1 Issues

**M1. Input is `<textarea>`, not `<input>` — RESOLVED (R2 confirmed)**
The Context section (line 9) correctly identifies the input as a `<textarea>`. Step 4 trigger detection scans backward from `selectionStart` to `\n` or start-of-string for line boundaries. The `/` trigger checks `value[lineStart] === '/'`. Correct.

**M2. `queryInstance` lifecycle and cache invalidation — RESOLVED (R2 confirmed)**
Step 2 calls `queryInstance.initializationResult()` inline in `consumeTurn` after init, storing the result as `slashCommands` on Session. No concurrent-access concern. The endpoint returns `source: 'session' | 'fallback'` for client-side cache decisions. Both parts addressed.

**M3. Tab key event handling order — RESOLVED (R2 confirmed)**
Step 4 specifies `onKeyDown` calls both `e.preventDefault()` and `e.stopPropagation()` for consumed keys and returns `true`/`false`. Step 6 Tab priority chain explicitly uses `stopPropagation()` to prevent bubbling to `handleTabTrap`. The Escape handler does the same.

### Round 2 Issues

**M4. `handleTabTrap` selector doesn't include `<textarea>` — RESOLVED**
Step 6 now includes an explicit note: "Fix `handleTabTrap` selector: The existing `handleTabTrap` in TerminalPeek queries `'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'` — this excludes `<textarea>` elements. [...] Update the selector to include `textarea:not([disabled])`." (Plan lines 153-154.) This directly addresses the issue and ensures the focus trap works correctly with the textarea as a focusable element.

**M5. Slash commands unavailable for completed subtask sessions — RESOLVED**
The plan does not explicitly add a prose note about this, but the architecture handles it gracefully: the endpoint returns `source: 'fallback'` when no session exists (Step 2, line 47-48: "session's slash commands when available, or a hardcoded fallback for built-in commands [...] when the session hasn't initialized yet"). Since `sessions.delete(nodeId)` removes the session for completed subtasks, `getSlashCommands(nodeId)` would return `null`, and the endpoint falls through to the hardcoded fallback. The `source` field communicates this to the client. The behavior is correct; the lack of an explicit "completed subtasks always get fallback" note is an impl-note at most — the implementer will see the `sessions.get()` return `undefined` and the fallback path activate naturally.

**Med5. `onChange` ordering instruction emphasizes wrong boundary — RESOLVED**
Step 6 item 2 (line 150) now reads: "read `e.target.selectionStart` _before_ the auto-resize DOM mutation (`el.style.height = ...`), then call `autocomplete.onInputChange(value, cursorPos)`." The plan also has an important note at lines 17-18: "`selectionStart` must be read from the textarea element _before_ any DOM mutations." The emphasis is now correctly on "before any DOM mutations" rather than specifically "before resize." The guidance is clear enough for an implementer — read cursor position first, then do everything else.

**Med6. `source: 'fallback'` re-fetch mechanism unspecified — RESOLVED**
Step 2 (line 48) now explicitly states: "if `source === 'fallback'`, the client should re-fetch after session init completes (to avoid permanently caching the hardcoded fallback)." Step 4's caching section (line 81) says commands are "fetched once and cached for session lifetime," but the `source` field provides the discrimination. The mechanism is now specified: the client checks `source`, and if it's `'fallback'`, it knows not to treat the result as the permanent cache entry. The exact re-fetch trigger (next dropdown open vs. WebSocket event) is left to implementation, which is appropriate — the plan establishes the contract (`source` field), and the implementer picks the simplest approach. No architectural ambiguity remains.

**L4. ARIA `role="combobox"` placement — RESOLVED**
Step 5 (lines 139-142) now explicitly states: "The `<textarea>` itself gets `role='combobox'`, `aria-expanded={isOpen}`, `aria-activedescendant={activeDescendantId}`, and `aria-controls={listboxId}`. WAI-ARIA requires these attributes on the element that receives keyboard input — not a wrapper div." This is precise and correct.

**L5. `onItemClick` return value gap — RESOLVED**
Step 4 (lines 108-109) now includes both `onItemClick(index)` (accepts the item at index) and `onItemHover(index)` (updates selectedIndex on pointer hover). The dropdown component in Step 5 (lines 136-137) wires these to `onPointerEnter` and `onClick` respectively. The hook interface makes `onItemClick` a void action that internally triggers acceptance — the hook presumably manages the state update and the caller reads the result via the hook's reactive state. This is a reasonable API design. The `accept()` method is available for programmatic acceptance (keyboard Tab/Enter), while `onItemClick` handles the mouse path internally. No gap remains.

### Round 1 Medium/Low Issues (carried forward as impl-notes)

- **Med1 (abort controller):** Still unspecified. Remains an impl-note — standard fetch pattern, no architectural impact.
- **Med2 (non-git repo fallback):** Still unspecified. Remains an impl-note — try/catch and return empty array.
- **Med3 (dropdown clipping):** Still unspecified. Remains an impl-note — CSS-solvable during implementation.
- **Med4 (`AutocompleteItem` in shared types):** Still in `shared/types.ts`. Remains an impl-note — misplaced but no functional impact. The type could be moved client-side during implementation.
- **L1 (`git ls-files --max-count`):** Still references this non-existent flag. Remains an impl-note — the 100-result cap in application code is the actual mitigation.
- **L2 (verification step 10):** Still tests behavior not defined in the plan. Remains an impl-note.
- **L3 (Step 5 parallel with Step 4):** Implementation order diagram still shows them as parallel without noting the interface dependency. Remains an impl-note.

## New Issues

None. No new Critical or Must-fix issues identified. The revision 3 plan is architecturally sound.

The portal rendering approach for the dropdown (Step 5, lines 122-123) is a good addition — it correctly identifies the `overflow-hidden` constraint and specifies `createPortal` to `document.body` with `getBoundingClientRect()` positioning. The `ResizeObserver` suggestion for tracking textarea dimension changes is appropriate.

The Escape key layering analysis (Risk 5, lines 226-228) correctly identifies that `useFloatingWindow`'s capture-phase listener is gated on `gestureRef.current !== null`, making the conflict theoretical. The defensive `stopPropagation()` is the right call.

## Summary

All Critical and Must-fix issues from Rounds 1 and 2 are resolved. The plan at revision 3 is ready for implementation. The multi-line trigger detection, Tab/Escape key handling with explicit propagation control, `handleTabTrap` selector fix, ARIA attribute placement, portal-based dropdown rendering, and slash command fallback strategy are all well-specified. The remaining open items from prior rounds (abort controllers, non-git fallback, dropdown clipping, type placement) are appropriately scoped as implementation details that won't cause architectural rework.
