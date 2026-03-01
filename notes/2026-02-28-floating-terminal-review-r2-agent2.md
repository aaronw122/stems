# Floating Terminal Plan Review R2 -- React Flow Integration Specialist

**Plan reviewed:** `/docs/intents/floating-terminal.md` (v2)
**Prior review:** `/notes/2026-02-28-floating-terminal-review-r1-agent2.md` (v1)
**Reviewer focus:** Event propagation, overlay/canvas interaction, z-index management, scroll conflicts
**Date:** 2026-02-28

---

## R1 Issue Disposition

### Issue 1: Mount location must be outside ReactFlow -- FIXED

**R1 severity:** Must-fix
**V2 status:** Fully addressed.

The plan now includes an explicit TRUST[ask] item: "TerminalPeek must be mounted as a sibling of `<ReactFlow>` inside the `div.relative.flex-1` container in App.tsx, NOT as a child of ReactFlow." The rationale references `overflow: hidden`, pointer-event behavior, and z-index stacking context -- all three failure modes I identified. This is exactly what was needed: an architectural constraint surfaced as a first-class plan item rather than left implicit.

No residual concerns.

---

### Issue 2: `panOnScroll` + terminal scroll conflict -- FIXED

**R1 severity:** Must-fix
**V2 status:** Fully addressed.

ENSURE now includes: "Terminal scroll container uses React Flow's `nowheel` CSS class to prevent wheel events from bubbling to the canvas `panOnScroll` handler." This is the defensive measure I recommended.

One small observation: the current `TerminalPeek` scroll container (line 87) uses `className="flex-1 overflow-y-auto px-4 py-3"`. The `nowheel` class needs to be added to this element during implementation. The plan correctly specifies the requirement; this is just a note on where it lands in the existing code.

No residual concerns.

---

### Issue 3: Drag implementation must avoid full-screen overlays -- FIXED

**R1 severity:** Medium
**V2 status:** Fully addressed.

ENSURE now explicitly specifies the mechanism: "Drag/resize uses `pointerdown` on the respective handle, then promotes to `document.addEventListener('pointermove'/'pointerup')` for the gesture duration. No full-screen overlay element. `stopPropagation()` called on pointer events within the terminal root to prevent canvas pan/zoom from firing."

This is exactly the approach I recommended. The addition of `stopPropagation()` on the terminal root is also correct -- since the terminal is a sibling of ReactFlow in the same `div.relative.flex-1` container, pointer events could theoretically bubble up to shared ancestors and trigger unexpected behavior. Stopping propagation at the terminal root is clean.

No residual concerns.

---

### Issue 4: z-index values need explicit documentation -- NOT ADDRESSED

**R1 severity:** Medium
**V2 status:** Not addressed, but downgrading to **Impl-note**.

The plan still does not document the z-index layering (terminal at z-40, modals at z-50, DoneList at z-20). However, applying the scope test: would discovering this during implementation cause significant rework or wrong architecture? No. The current code already has `z-40` on TerminalPeek, and the floating conversion does not change its z-index relationship to other elements. The implementer would naturally preserve the existing value. This is documentation hygiene, not an architectural risk.

**Recommendation stands** (add z-index map to plan or a code comment) but severity is **Impl-note**.

---

### Issue 5: Resize handle hit areas should be tight -- N/A

**R1 severity:** Impl-note
**V2 status:** Not explicitly addressed, which is appropriate for an impl-note. TRUST[autonomous] covers "Resize handle styling (subtle grab indicators)" which implicitly includes hit area sizing.

No action needed.

---

### Issue 6: Escape key / node selection coupling -- PARTIALLY ADDRESSED

**R1 severity:** Impl-note
**V2 status:** Partially addressed, remains **Impl-note**.

The plan added: "Escape during an active drag/resize cancels the interaction and restores prior position (does NOT close the window)." This addresses one Escape scenario (during drag/resize) but does not address the broader UX question I raised: what happens when Escape is pressed while the terminal is open but no drag/resize is active?

Currently in `App.tsx` (line 63), Escape with `selectedNodeId` set calls `setSelectedNode(null)`, which unmounts the terminal. The plan's statement "One terminal at a time (opening a new one replaces the current)" implies the terminal lifecycle is still coupled to node selection, which means the current Escape behavior persists.

This is fine -- the coupling is a known, intentional design choice. The new Escape-during-drag behavior needs to be integrated into the existing keydown priority chain in App.tsx (PromptEditor > drag/resize cancel > selectedNode > doneList). Scope test: would discovering this during implementation cause rework? No, it is a straightforward priority insertion.

**Impl-note:** The implementer should add drag/resize-cancel as a higher-priority Escape handler than node deselection, since the plan explicitly says Escape during drag "does NOT close the window."

---

### Issue 7: `fitView` does not account for terminal footprint -- N/A

**R1 severity:** Impl-note
**V2 status:** Not addressed, which is appropriate. This is a known limitation to defer.

No action needed.

---

## New Items in V2

### New ENSURE: Focus management on open/close

**V2 text:** "On open, focus moves to terminal input field; on close, focus returns to canvas."

**Assessment:** Sound. The current TerminalPeek does not manage focus programmatically (no `autoFocus` on the input, no `useEffect` with `ref.focus()`). Implementation will need to add a ref to the input element and call `.focus()` on mount. For "focus returns to canvas," the implementer should call `.focus()` on the React Flow wrapper element or simply `document.activeElement?.blur()` -- React Flow does not require explicit focus to receive keyboard shortcuts since it listens on the window/document level.

**Severity:** Impl-note. Straightforward to implement, no architectural risk.

---

### New ENSURE: Escape during drag/resize cancels interaction

**V2 text:** "Escape during an active drag/resize cancels the interaction and restores prior position (does NOT close the window)."

**Assessment:** This requires the drag/resize handler to store the position/size at gesture start and restore it on Escape. The handler must also listen for `keydown` during the gesture. Since the gesture uses `document.addEventListener('pointermove'/'pointerup')`, the Escape listener should similarly be on `document` and only active during a gesture.

There is a subtle interaction with the App.tsx global Escape handler: if the user presses Escape during a drag, both the gesture-cancel handler (on the terminal) and the global handler (on App.tsx) will fire. The gesture handler must call `stopPropagation()` on the keydown event OR the global handler must check whether a drag is in progress before deselecting the node. Otherwise, Escape during drag would both cancel the drag AND close the terminal -- contradicting the plan's "does NOT close the window" requirement.

**Severity:** Impl-note. The interaction is real but the fix is a single `stopPropagation()` or a state check. Scope test: would discovering this during implementation cause significant rework? No.

---

### New ENSURE: Tab trapping within terminal

**V2 text:** "Tab cycles through terminal interactive elements (input, Send, close button) before reaching canvas."

**Assessment:** This is focus trapping, a standard accessibility pattern. Implementation is straightforward: detect Tab/Shift+Tab on the terminal container and cycle focus among the three interactive elements. The terminal is not a modal (no backdrop), so focus should eventually escape to the canvas -- "before reaching canvas" implies a focus cycle that wraps within the terminal elements and then allows natural tab-out, not a hard trap.

Clarification needed: does "before reaching canvas" mean (a) Tab cycles through the three terminal elements and then moves to canvas elements, or (b) Tab cycles endlessly within the terminal until the user clicks elsewhere? Option (a) is more standard for a non-modal panel. The wording suggests (a).

**Severity:** Impl-note. Either interpretation is straightforward to implement.

---

### V2 WANT: Position/size persistence across open/close

**V2 text:** "Position and size persist across open/close cycles within a session (state lives in parent or Zustand store, not inside TerminalPeek, since the component unmounts on close). First open centers; subsequent opens restore last position/size. Resets on page reload."

**Assessment:** This is well-specified. The key insight -- state must live outside the component because it unmounts on close -- is explicitly called out. Implementation options: (1) Zustand store (already used for other app state), or (2) state in App.tsx lifted above the conditional render. Either works.

One interaction with the current architecture: `TerminalPeek` is conditionally rendered via `{selectedNodeId && <TerminalPeek ... />}` in App.tsx (line 181). On close, `setSelectedNode(null)` causes unmount. The position/size state must survive this unmount. Zustand is the cleaner choice since App.tsx already uses it for `selectedNodeId`.

**Severity:** No concern. Well-specified.

---

## New Concern: `stopPropagation()` on terminal root vs. canvas click-to-deselect

The V2 ENSURE says: "`stopPropagation()` called on pointer events within the terminal root to prevent canvas pan/zoom from firing."

This is correct for preventing canvas pan/zoom. But there is a subtle interaction worth noting: if the app ever adds a "click canvas to deselect node" behavior (click on the canvas background to clear `selectedNodeId` and close the terminal), `stopPropagation()` on the terminal root correctly prevents a terminal click from triggering that deselection. This is actually desirable behavior -- clicking inside the terminal should not close it.

Currently, `FlowCanvas.tsx` does not have a `onPaneClick` handler, so this is not an active concern. Just noting that the `stopPropagation()` approach is forward-compatible with that common pattern.

**Severity:** No action needed. The plan's approach is correct.

---

## Potential Conflict Check: New ENSURE Items

The V2 plan added several ENSURE items. Checking for conflicts:

1. **"No full-screen overlay element" vs. "Escape during drag cancels"** -- No conflict. Escape handling uses keyboard events, not pointer-capture overlays.

2. **"stopPropagation() on terminal root" vs. "Canvas remains interactive behind/around the terminal"** -- No conflict. `stopPropagation()` only stops events that originate within the terminal DOM subtree. Events originating on the canvas never enter the terminal subtree, so they are unaffected.

3. **"Terminal scroll container uses nowheel class" vs. "Input field and scroll behavior still work as before"** -- No conflict. The `nowheel` class prevents React Flow from intercepting wheel events; it does not prevent native scrolling. The scroll container's `overflow-y: auto` still works.

4. **"Focus moves to terminal input on open" vs. "Tab cycles through terminal elements before reaching canvas"** -- No conflict. Focus-on-open sets initial focus; Tab ordering governs subsequent navigation.

No conflicts found between new ENSURE items.

---

## Summary

| R1 # | Issue | R1 Severity | V2 Status | R2 Severity |
|-------|-------|-------------|-----------|-------------|
| 1 | Mount location outside ReactFlow | Must-fix | Fixed | Resolved |
| 2 | `panOnScroll` + scroll conflict | Must-fix | Fixed | Resolved |
| 3 | No full-screen overlay for drag | Medium | Fixed | Resolved |
| 4 | z-index documentation | Medium | Not addressed | Impl-note (downgraded) |
| 5 | Resize handle hit areas | Impl-note | N/A | Impl-note |
| 6 | Escape key / node coupling | Impl-note | Partially addressed | Impl-note |
| 7 | `fitView` + terminal overlap | Impl-note | N/A | Impl-note |

| New | Issue | Severity |
|-----|-------|----------|
| N1 | Escape during drag must `stopPropagation` to avoid also closing terminal | Impl-note |
| N2 | Tab cycling semantics (hard trap vs. cycle-then-escape) could be clarified | Impl-note |

**Bottom line:** All three actionable items from R1 (2 must-fix, 1 medium) have been addressed in V2. The mount-point clarification is thorough -- it names the specific container, the specific anti-pattern, and the three failure modes. The event-handling ENSURE items (pointer delegation to document, `stopPropagation`, `nowheel` class) form a coherent and correct strategy for coexisting with React Flow's event system. No new must-fix or medium issues introduced. The plan is ready for implementation.
