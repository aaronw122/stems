# Floating Terminal Window -- UX/Interaction Design Review (Round 2)

**Reviewer:** UX/Interaction Design specialist
**Plan version:** v2 (`/docs/intents/floating-terminal.md`)
**Prior review:** `/notes/2026-02-28-floating-terminal-review-r1-agent3.md`
**Date:** 2026-02-28

---

## R1 Issue Disposition

### Issue 4 (Must-fix): Keyboard accessibility -- RESOLVED

R1 flagged three sub-issues: (a) focus management on open/close, (b) Escape key ambiguity during drag/resize, (c) Tab order.

The v2 plan adds three new ENSURE items that address all three:

- "On open, focus moves to terminal input field; on close, focus returns to canvas" -- resolves (a).
- "Escape during an active drag/resize cancels the interaction and restores prior position (does NOT close the window)" -- resolves (b). The parenthetical clarification is important: it disambiguates Escape-during-gesture from Escape-to-close, which was the core architectural concern.
- "Tab cycles through terminal interactive elements (input, Send, close button) before reaching canvas" -- resolves (c).

All three are well-specified. No remaining gaps.

### Issue 7 (Must-fix): Drag/resize events propagating to canvas -- RESOLVED

R1 flagged that pointer events inside the terminal would bubble to React Flow and cause simultaneous canvas panning.

The v2 plan adds a detailed ENSURE item: "Drag/resize uses `pointerdown` on the respective handle, then promotes to `document.addEventListener('pointermove'/'pointerup')` for the gesture duration. No full-screen overlay element. `stopPropagation()` called on pointer events within the terminal root to prevent canvas pan/zoom from firing."

This is thorough. The document-level listener promotion pattern is the correct approach for drag/resize that needs to continue even when the pointer leaves the element. The explicit "no full-screen overlay element" constraint prevents the common shortcut that would violate the DON'T ("don't block canvas interaction").

Additionally, the plan adds: "Terminal scroll container uses React Flow's `nowheel` CSS class to prevent wheel events from bubbling to the canvas `panOnScroll` handler." This addresses a sub-issue I didn't call out in R1 -- wheel events on the terminal body triggering canvas pan. Good catch; this closes the interaction gap cleanly.

### Issue 2 (Medium): Viewport resize re-clamping -- NOT ADDRESSED

R1 recommended adding "On viewport resize, re-clamp position so title bar remains reachable" to ENSURE. The v2 plan does not include this.

**Revised severity: Impl-note.** On reflection, the reactive clamping approach is the only reasonable strategy for this scope, and any implementer who builds the "stays within viewport bounds" constraint will naturally wire up a `resize` listener or otherwise discover this during testing. The constraint as written ("title bar always reachable") is testable and implies viewport resize behavior. This won't cause architectural rework.

### Issue 3 (Medium): "Title bar always reachable" ambiguity -- PARTIALLY ADDRESSED

R1 noted tension between "stays within viewport bounds" (strict) and "keep at least the title bar visible" (loose/macOS-style). The v2 plan still contains both phrasings:

- DON'T: "Don't allow the window to be dragged fully off-screen (keep at least the title bar visible)"
- ENSURE: "Stays within viewport bounds (title bar always reachable)"

These remain slightly contradictory. However, reading them together with reasonable interpretation, the intent is clear: the title bar must stay within the viewport; the body may extend past edges. The implementer will almost certainly interpret it this way. Not worth blocking on.

**Revised severity: Impl-note.** Won't cause architectural rework. The implementer will clamp the title bar's y to >= 0 and ensure some horizontal overlap, which is the right behavior regardless of which phrasing they follow.

### Issue 9 (Medium): Migration path unclear -- NOT ADDRESSED

R1 asked the plan to clarify whether this is an in-place refactor of `TerminalPeek` or a new wrapper component. The v2 plan does not specify this.

**Revised severity: Impl-note.** The TRUST section marks "implementation approach" as autonomous. Either strategy (refactor in-place or wrapper component) is viable and neither creates rework if the other is chosen later. The plan's TRUST delegation covers this appropriately.

### Issue 10 (Medium): Resize handles vs. interior elements conflict -- NOT ADDRESSED

R1 flagged that bottom-edge and right-edge resize handles would conflict with the input field, scrollbar, and Send button.

**Revised severity: Impl-note.** The v2 plan's ENSURE item on drag/resize specifies `pointerdown` on "the respective handle," which implies dedicated handle elements. The implementer will need to position these handles to avoid conflicts, but that's standard resize-handle implementation. The common pattern (invisible hit areas extending outside the visible border) is well-understood and doesn't require plan-level guidance. If handles are inside the border, the conflict will surface immediately in testing and is trivially fixable by moving them outside.

### Issue 5 (Low): Double-click title bar -- Acknowledged, deferral is fine

Not addressed in v2, as recommended. No change needed.

### Issues 1, 6, 8, 11, 12 (Impl-notes): All remain impl-notes

These were informational in R1 and remain so. No plan changes expected or needed.

---

## New Items in v2

### N1. `nowheel` CSS class for scroll isolation

**New ENSURE item:** "Terminal scroll container uses React Flow's `nowheel` CSS class to prevent wheel events from bubbling to the canvas `panOnScroll` handler."

**Assessment: Good addition, no issues.** React Flow's `nowheel` class is the idiomatic solution for this exact problem. It's a single className addition, well-documented in React Flow's API. No interaction conflicts introduced.

### N2. Escape during drag/resize cancels interaction

**New ENSURE item:** "Escape during an active drag/resize cancels the interaction and restores prior position (does NOT close the window)"

**Assessment: Good, one impl-note.** The behavior is well-specified. The "(does NOT close the window)" parenthetical is critical -- without it, Escape during drag would be ambiguous between "cancel drag" and "close terminal."

**Impl-note:** The implementer needs to store a snapshot of position/size at `pointerdown` for the drag/resize gesture, so Escape can restore it. This is a natural part of the drag state machine (capture start position, apply deltas on move, commit on pointerup, revert on Escape). No architectural concern; just noting that the "restores prior position" language implies a pre-gesture snapshot, which the implementer should plan for.

### N3. Tab cycling through terminal elements

**New ENSURE item:** "Tab cycles through terminal interactive elements (input, Send, close button) before reaching canvas"

**Assessment: Well-specified, one interaction nuance to note.**

**Impl-note:** The current component has three interactive elements: the close button (traffic light red), the input field, and the Send button. The "scroll to bottom" button appears conditionally when `autoScroll` is false. If Tab cycling is implemented via natural DOM tab order (which it should be -- `tabIndex` on the terminal root is not needed if elements are natively focusable), the scroll-to-bottom button will join the tab cycle when visible. This is correct behavior and doesn't need plan-level specification; just noting it for completeness.

The phrase "before reaching canvas" implies the terminal elements come first in tab order, then focus escapes to canvas elements. Since the terminal is rendered as a sibling after `FlowCanvas` in the DOM (per current App.tsx structure), native tab order already flows from canvas to terminal. To make terminal elements come first, the implementer would need either: (a) render the terminal before the canvas in DOM order (breaking visual layering expectations), or (b) use `tabIndex` values, or (c) accept that Tab from canvas reaches terminal, and Tab from the last terminal element reaches canvas again (natural cycle). Option (c) is the most pragmatic and matches how floating windows work in practice -- Tab within the terminal cycles its elements, and there's no strict "terminal first" ordering. The plan's intent is likely (c). If strict "terminal first" ordering is actually needed, that would require focus trapping, which the R1 review correctly noted would be wrong for a non-modal floating window. No plan change needed; the implementer should go with natural tab order.

### N4. State lifetime clarification in WANT

**Updated WANT item:** "Position and size persist across open/close cycles within a session (state lives in parent or Zustand store, not inside TerminalPeek, since the component unmounts on close). First open centers; subsequent opens restore last position/size. Resets on page reload."

**Assessment: Thorough and clear.** This addresses R1 issue 11's ambiguity about "per-session vs. per-node." The answer is: per-session, position persists across different nodes, first open centers, subsequent opens restore. The parenthetical about why state can't live in TerminalPeek (component unmounts on close) is a helpful implementation hint.

### N5. TRUST item on mounting location

**New TRUST item:** "[ask] TerminalPeek must be mounted as a sibling of `<ReactFlow>` inside the `div.relative.flex-1` container in App.tsx, NOT as a child of ReactFlow. React Flow's wrapper applies `overflow: hidden` and its own pointer-event/stacking-context behavior that would break drag, scroll, and z-index."

**Assessment: Important constraint, correctly flagged as [ask].** This is the current mounting structure (TerminalPeek is already a sibling of FlowCanvas in App.tsx), so it's really a "don't change this" constraint rather than a new requirement. Marking it as [ask] means the implementer should confirm before altering the mounting location, which is appropriate since getting this wrong would break everything.

---

## New Issues Introduced by v2

None. The v2 additions are conservative and well-scoped. The keyboard accessibility items (Escape cancel, Tab cycling, focus management) are all standard patterns that don't conflict with each other or with the drag/resize interaction model. The `nowheel` class is additive and conflict-free.

---

## Summary

| R1 # | Issue | R1 Severity | R2 Status | Notes |
|-------|-------|-------------|-----------|-------|
| 4 | Keyboard accessibility | Must-fix | RESOLVED | Three new ENSURE items cover all sub-issues |
| 7 | Event propagation to canvas | Must-fix | RESOLVED | Detailed pointer event strategy + nowheel class |
| 2 | Viewport resize re-clamping | Medium | Downgraded to Impl-note | Implied by existing constraint; won't cause rework |
| 3 | Title bar constraint ambiguity | Medium | Downgraded to Impl-note | Slightly ambiguous but interpretable; won't cause rework |
| 9 | Migration path | Medium | Downgraded to Impl-note | Covered by TRUST/autonomous delegation |
| 10 | Resize handles vs. interior elements | Medium | Downgraded to Impl-note | Standard implementation concern |
| 5 | Double-click title bar | Low | Unchanged | Deferred, appropriate for MVP |
| 1,6,8,11,12 | Various | Impl-note | Unchanged | Issue 11 now explicitly resolved by WANT clarification |

**New items from v2 changes:** None above Impl-note severity. Two impl-notes (N2: pre-gesture position snapshot; N3: Tab order is natural DOM order, not strict "terminal first").

**Verdict:** Both must-fix issues are resolved. All medium issues have been downgraded to impl-notes on re-evaluation -- they won't cause architectural rework. No new issues introduced by v2 changes. The plan is ready for implementation.
