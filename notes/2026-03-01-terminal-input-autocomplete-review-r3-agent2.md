# UX/Interaction Review — Terminal Input Autocomplete Plan (Round 3 — Final Verification)

## Prior Issue Resolution

### R1 Critical Issues

1. **Input element mismatch (`<input>` vs `<textarea>`)** -- RESOLVED.
   Plan now correctly references `<textarea>` throughout (line 9). Multi-line trigger detection is fully specified with line-start scanning (lines 13-14, 73-76). The `selectionStart` / auto-resize sequencing concern is addressed explicitly (line 18: read cursor position before resize DOM mutation). No residual issues.

2. **Tab key handling conflicts — incomplete priority chain** -- RESOLVED.
   Complete four-case Tab priority chain specified in Step 6 (lines 156-160): open with items, open with empty list, Shift+Tab while open, and autocomplete closed. `stopPropagation()` explicitly called alongside `preventDefault()` for all consumed keys (line 90). No residual issues.

### R1 Must-Fix Issues

1. **No ARIA specification** -- RESOLVED.
   Full WAI-ARIA combobox pattern in Step 5 (lines 139-142). Hook interface exposes `activeDescendantId` and `listboxId` (lines 111-112). Stable `id` attributes on each option item specified. The R2 follow-up about `role="combobox"` placement is also fixed — see R2 Must-Fix #1 below.

2. **Enter key behavior unspecified** -- RESOLVED.
   Three-case Enter behavior in Step 6 (lines 162-165): accept when highlighted, dismiss-and-fall-through when nothing highlighted, pass-through when closed. Clean design that respects muscle memory. No residual issues.

3. **Mouse/pointer interaction missing** -- RESOLVED.
   `onItemClick(index)` and `onItemHover(index)` in hook interface (lines 108-109). Step 5 wires `onPointerEnter` for hover and `onClick` for acceptance (lines 136-137). Hover updates `selectedIndex` to keep keyboard and mouse navigation synchronized. No residual issues.

### R2 Must-Fix Issues

1. **ARIA `role="combobox"` placed on wrong element** -- RESOLVED.
   Step 5 now explicitly states: "The `<textarea>` itself gets `role="combobox"`, `aria-expanded={isOpen}`, `aria-activedescendant={activeDescendantId}`, and `aria-controls={listboxId}`. WAI-ARIA requires these attributes on the element that receives keyboard input — not a wrapper div." (line 140). This is correct and unambiguous.

2. **`selectedIndex` initial state unspecified** -- RESOLVED.
   Step 4 now states: "`selectedIndex` initializes to `-1` when the dropdown opens. It only becomes `>= 0` after explicit ArrowUp/ArrowDown navigation or pointer hover (`onItemHover`)." (line 88). This matches standard combobox behavior and aligns with the Enter key logic at lines 163-164.

### R2 Medium Issues (carried forward — checking status)

1. **Dropdown positioning / viewport overflow** -- PARTIALLY ADDRESSED.
   The plan now specifies portal rendering via `createPortal` to `document.body` with viewport-absolute positioning using `getBoundingClientRect()` (line 122-123). This solves the `overflow-hidden` clipping problem and is a significant improvement. However, there is still no mention of flipping the dropdown below the input when space above is insufficient. Since the dropdown is now a portal positioned in viewport coordinates, a top-of-viewport edge case would place it offscreen. This remains a minor UX polish issue — not architectural, since portal positioning logic can be adjusted without interface changes. Acceptable as an impl-note.

2. **`@` trigger word-boundary check contradicts Verification step 10** -- NOT RESOLVED.
   Step 4 (line 74) says "scan backward from `selectionStart` toward `lineStart` looking for `@`" with no word-boundary requirement. Verification step 10 (line 240) says "Verify dropdown doesn't appear for `@` in middle of word without space before it." These remain contradictory. See New Issues below for assessment of whether this crosses the must-fix threshold.

3. **No blur/click-outside dismiss handler** -- NOT RESOLVED.
   The plan still only specifies Escape and space-in-query as dismiss triggers. No blur handler on the textarea. Since the dropdown is now a portal on `document.body`, a stale dropdown floating disconnected from its source input is more visually jarring than when it was contained. However, this is a standard implementation pattern (blur + setTimeout) that doesn't affect architecture. Acceptable as an impl-note.

4. **`handleTabTrap` selector excludes `<textarea>`** -- RESOLVED.
   Step 6 now includes an explicit fix: "The existing `handleTabTrap` in TerminalPeek queries `'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'` — this excludes `<textarea>` elements... Update the selector to include `textarea:not([disabled])`." (line 154). Good — this ensures Tab fall-through from autocomplete correctly cycles to the input.

5. **Escape key `stopPropagation()` rationale inaccuracy** -- PARTIALLY ADDRESSED.
   The Escape key section in Step 6 (line 168) now correctly states that `stopPropagation()` prevents the event from "bubbling to `handleTabTrap` on the root div" — which is the correct primary justification. However, Risk 5 (line 227) has been updated to a more accurate description: it notes that the capture-phase listener fires first and the conflict is theoretical due to the `gestureRef.current` gate. The remaining slight imprecision is that line 168's final sentence still frames `stopPropagation()` as "good practice to prevent unexpected interactions" with `useFloatingWindow`, when in reality `stopPropagation()` in bubble phase cannot prevent capture-phase listeners. This is a documentation clarity issue, not a functional one — the behavior will be correct regardless. Not worth flagging further.

## New Issues

### Internal consistency: `@` trigger spec vs Verification step 10

**Sections:** Step 4 (line 74), Verification (line 240)

This contradiction was flagged in both R1 (Medium #2) and R2 (Medium #2) and remains unresolved. The trigger detection says "scan backward looking for `@`" with no boundary check, while Verification step 10 asks to verify the dropdown does NOT appear for `@` in the middle of a word.

**Scope test:** Would this cause significant architectural rework if discovered during implementation? No. The fix is either adding a single character-class check before the `@` position in the trigger detection function, or removing Verification step 10. Neither changes any interface, component boundary, or data flow. The implementer will simply have to make the decision the plan deferred.

**Verdict:** Impl-note, not must-fix. The implementer should decide: either add a word-boundary check (preceding character is whitespace, start-of-line, or opening bracket) and keep Verification step 10, or remove Verification step 10 and accept that `@` triggers anywhere (matching Slack/Discord behavior). The plan should ideally be internally consistent, but the inconsistency won't cause rework.

### Blur/click-outside dismiss

Also carried from R1 and R2. Same scope test: adding a blur handler with a setTimeout guard is a well-known pattern that touches only the hook's event wiring. No architectural impact. Impl-note.

## Summary

All Critical and Must-Fix issues from Rounds 1 and 2 are resolved in Revision 3. The two R1 Criticals (textarea mismatch, Tab priority chain) are thoroughly addressed with multi-line-aware trigger detection and a complete four-case Tab priority chain. All five Must-Fix items across both rounds (ARIA spec, Enter behavior, mouse interaction, combobox role placement, selectedIndex initialization) are properly specified with clear, unambiguous language. The plan also picks up the R2 Medium issue about `handleTabTrap`'s selector and the portal rendering approach effectively handles the overflow-hidden concern. The two remaining carried-forward items (`@` trigger boundary contradiction and blur dismiss handler) are implementation-level decisions that do not affect architecture. The plan is ready for implementation.
