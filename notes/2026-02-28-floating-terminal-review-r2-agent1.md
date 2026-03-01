# Floating Terminal Plan Review R2 -- Frontend Architect

**Reviewer:** Frontend Architect (agent1)
**Date:** 2026-02-28
**Plan version reviewed:** v2 (`docs/intents/floating-terminal.md`)
**Prior review:** `notes/2026-02-28-floating-terminal-review-r1-agent1.md`

---

## R1 Issue Disposition

### R1 #1 -- Pointer event conflict between drag/resize and React Flow canvas
**R1 severity:** Must-fix
**Status: FIXED**

The v2 plan now explicitly specifies the correct pattern in ENSURE: "Drag/resize uses `pointerdown` on the respective handle, then promotes to `document.addEventListener('pointermove'/'pointerup')` for the gesture duration. No full-screen overlay element. `stopPropagation()` called on pointer events within the terminal root to prevent canvas pan/zoom from firing."

This is exactly the pattern I recommended. The addition of `stopPropagation()` on the terminal root is a good catch -- it prevents stray pointer events on the terminal body (not just handles) from leaking to React Flow.

No remaining concerns.

---

### R1 #2 -- z-index layering strategy is undefined
**R1 severity:** Medium
**Status: NOT ADDRESSED (downgraded to Impl-note)**

The v2 plan still does not explicitly state a z-index for the floating terminal. However, applying my own severity test: would discovering this during implementation cause significant rework or wrong architecture? No. The current `z-40` on TerminalPeek is already correct (above DoneList at z-20, below modals at z-50), and there is no reason an implementer would change it since the plan says to preserve existing styling. This is an implementation detail the implementer will naturally carry forward.

**Verdict:** Acceptable as-is. Downgraded to Impl-note.

---

### R1 #3 -- Mount point needs to change but was flagged as [ask]
**R1 severity:** Must-fix
**Status: FIXED**

The v2 plan resolves this decisively in TRUST: "TerminalPeek must be mounted as a sibling of `<ReactFlow>` inside the `div.relative.flex-1` container in App.tsx, NOT as a child of ReactFlow. React Flow's wrapper applies `overflow: hidden` and its own pointer-event/stacking-context behavior that would break drag, scroll, and z-index."

This is the right call. Looking at the current code in App.tsx (lines 143-196), TerminalPeek is already rendered as a sibling of `<FlowCanvas>` inside `div.relative.flex-1`. The `<ReactFlow>` component is encapsulated inside `FlowCanvas`, so TerminalPeek is already outside React Flow's wrapper. The plan's instruction aligns with the existing structure -- no move is needed.

One subtlety worth noting: the plan says `[ask]` on this item, but the content reads as a directive ("must be mounted as a sibling"), not as a question. This could confuse an implementer -- is this a decided answer or still pending approval? Given the `[ask]` tag, the implementer should confirm with Aaron before proceeding. But architecturally the decision is correct, so this is a process note, not a technical issue.

No remaining technical concerns.

---

### R1 #4 -- "Centered in viewport" vs. "centered in flow container"
**R1 severity:** Medium
**Status: FIXED (resolved by #3)**

With the mount point decided (sibling of ReactFlow inside `div.relative.flex-1` with `position: absolute`), centering is relative to the flex-1 container. Since flex-1 fills the screen, viewport centering and container centering are equivalent. The plan's language "Opens centered in the viewport" is accurate for the current layout.

No remaining concerns.

---

### R1 #5 -- Viewport bounds enforcement during browser window resize
**R1 severity:** Impl-note
**Status: NOT ADDRESSED (remains Impl-note)**

Still unspecified. Still fine as an implementation detail.

---

### R1 #6 -- Drag initiation vs. title bar text selection
**R1 severity:** Impl-note
**Status: NOT ADDRESSED (remains Impl-note)**

Still unspecified. Still fine -- `select-none` is already on the title text in the current code.

---

### R1 #7 -- Interaction between terminal input focus and drag
**R1 severity:** Impl-note
**Status: NOT ADDRESSED (remains Impl-note)**

Still unspecified. Still fine -- drag is title-bar-only by spec, input is in the body.

---

### R1 #8 -- Escape key behavior change
**R1 severity:** Low
**Status: PARTIALLY ADDRESSED**

The v2 plan adds: "Escape during an active drag/resize cancels the interaction and restores prior position (does NOT close the window)." This addresses the specific case of Escape during a gesture, which is good.

However, my original concern was broader: should Escape close the floating terminal at all (even when not dragging)? The current App.tsx behavior (line 63-64) closes the terminal on Escape when no modal is open. The plan doesn't change this, which means Escape still closes the floating window -- a departure from the macOS floating window metaphor where Escape doesn't close windows.

Applying the severity test: would this cause rework? No. The Escape handler is a single line in App.tsx. If the UX feels wrong after implementation, it's a trivial change. Remains Low / Impl-note.

---

### R1 #9 -- State management: position/size lifetime
**R1 severity:** Impl-note (but flagged as needing clarification)
**Status: FIXED**

The v2 plan explicitly states in WANT: "Position and size persist across open/close cycles within a session (state lives in parent or Zustand store, not inside TerminalPeek, since the component unmounts on close). First open centers; subsequent opens restore last position/size. Resets on page reload."

This is clear and complete. The architectural implication (state must be lifted out of TerminalPeek) is explicitly called out with the reason (component unmounts on close). Good.

No remaining concerns.

---

### R1 #10 -- CSS resize vs. custom pointer-based resize
**R1 severity:** Impl-note
**Status: NOT ADDRESSED (remains Impl-note)**

Still autonomous. The ENSURE requirements still effectively rule out CSS `resize`. Fine as-is.

---

## New Issues in v2

### N1. `stopPropagation()` on terminal root may block legitimate interactions

**Severity: Impl-note**

The v2 plan says: "`stopPropagation()` called on pointer events within the terminal root to prevent canvas pan/zoom from firing."

This is correct in principle, but the implementation needs care. If `stopPropagation()` is applied too broadly (e.g., on all pointer events including `pointerup`), it could interfere with React's synthetic event system or prevent cleanup of document-level listeners from other components. The implementer should apply `stopPropagation()` on `pointerdown` specifically (which is what React Flow listens for to initiate pan), and let `pointermove`/`pointerup` propagate normally (since those are captured at the document level by the drag/resize handlers anyway).

Would this cause rework? No -- it's a one-line fix if the initial approach is too aggressive. Impl-note is correct.

---

### N2. `nowheel` CSS class for scroll container -- interaction with React Flow's `panOnScroll`

**Severity: Impl-note**

The v2 plan adds: "Terminal scroll container uses React Flow's `nowheel` CSS class to prevent wheel events from bubbling to the canvas `panOnScroll` handler."

This is the correct approach -- React Flow checks for the `nowheel` class on the event target or its ancestors and skips pan handling if found. The current FlowCanvas has `panOnScroll` enabled (line 107 in FlowCanvas.tsx), so this is necessary.

One implementation note: the `nowheel` class must be on the scroll container (`scrollRef` div at line 84 of TerminalPeek.tsx) or an ancestor. Adding it to the terminal root div is safest since it covers all wheel events within the terminal. The implementer should verify this works with the version of `@xyflow/react` in use, since the class name convention has varied across versions (`nowheel` vs `nopan` vs `react-flow__nowheel`).

Would this cause rework? No. Impl-note.

---

### N3. Focus management spec is good but needs implementation awareness

**Severity: Impl-note**

The v2 plan adds two focus-related requirements:
- "On open, focus moves to terminal input field; on close, focus returns to canvas"
- "Tab cycles through terminal interactive elements (input, Send, close button) before reaching canvas"

The first is straightforward (`autoFocus` on the input or a `useEffect` with `ref.focus()`). The second implies a focus trap within the terminal window. A focus trap typically uses `tabIndex` manipulation and a `keydown` handler on Tab to cycle focus within a container. Since the plan says "no new dependencies," this needs to be implemented manually. Not difficult, but the implementer should know upfront that this is custom focus trap logic, not just a `tabIndex` attribute.

"Focus returns to canvas" on close is slightly ambiguous -- React Flow's canvas is a `div` that doesn't naturally accept focus. In practice, calling `.focus()` on the React Flow wrapper or simply letting focus return to `document.body` achieves the same effect (keyboard shortcuts resume working). The implementer should not overthink this.

Would this cause rework? No. Impl-note.

---

### N4. Escape during drag/resize -- edge case with Escape-to-close

**Severity: Impl-note**

The v2 plan specifies that Escape during an active drag/resize cancels the gesture (does NOT close the window). Meanwhile, the existing App.tsx Escape handler (line 60-68) closes the terminal when `selectedNodeId` is set.

These two behaviors need coordination. If the drag/resize Escape handler is inside TerminalPeek and the close handler is in App.tsx's global keydown listener, both could fire on the same Escape press. The drag/resize handler needs to `stopPropagation()` or set a flag to prevent the global handler from also closing the window.

This is a known interaction pattern and easy to implement (e.g., the drag handler calls `e.stopPropagation()` or `e.stopImmediatePropagation()`). But if the drag handler uses `document.addEventListener('keydown', ...)` at the same level as the App.tsx listener, ordering becomes relevant.

Would this cause rework? No, but it could cause a confusing bug if not handled. The fix is a few lines. Impl-note.

---

## Summary

### R1 Issues
| # | Issue | R1 Severity | R2 Status |
|---|-------|-------------|-----------|
| 1 | Pointer event conflict (drag/resize vs canvas) | Must-fix | FIXED |
| 2 | z-index layering undefined | Medium | Acceptable (Impl-note) |
| 3 | Mount point needs to change | Must-fix | FIXED |
| 4 | Viewport vs container centering | Medium | FIXED (by #3) |
| 5 | Browser resize bounds enforcement | Impl-note | Unchanged |
| 6 | Drag vs text selection | Impl-note | Unchanged |
| 7 | Input focus vs drag | Impl-note | Unchanged |
| 8 | Escape key behavior | Low | Partially addressed |
| 9 | Position/size state lifetime | Impl-note | FIXED |
| 10 | CSS resize vs custom resize | Impl-note | Unchanged |

### New Issues in v2
| # | Issue | Severity |
|---|-------|----------|
| N1 | `stopPropagation()` scope on terminal root | Impl-note |
| N2 | `nowheel` class version compatibility | Impl-note |
| N3 | Focus trap needs manual implementation | Impl-note |
| N4 | Escape during drag vs Escape-to-close coordination | Impl-note |

### Verdict

**Plan v2 is ready for implementation.** All R1 must-fix and medium issues are resolved or downgraded. The four new issues introduced by v2's additions are all implementation-level details that won't cause architectural rework. No remaining must-fix or medium issues.

---

## R2 Issue Count by Severity

| Severity | Count |
|----------|-------|
| Must-fix | 0 |
| Medium | 0 |
| Low | 1 (R1 #8, carried forward) |
| Impl-note | 8 (4 carried from R1, 4 new) |
