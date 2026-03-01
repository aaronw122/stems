# Floating Terminal Plan Review -- React Flow Integration Specialist

**Plan reviewed:** `/docs/intents/floating-terminal.md` (v1)
**Reviewer focus:** Event propagation, overlay/canvas interaction, z-index management, scroll conflicts
**Date:** 2026-02-28

---

## Architecture Context

Before the issues, here is what I confirmed about the current stack:

**Mount structure (App.tsx):**
```
<div class="flex h-screen w-screen flex-col bg-[#0f0f0f]">
  <div class="relative flex-1">              ← position:relative wrapper
    <ReactFlow ... />                         ← creates its own stacking context
    <div class="absolute ... z-40"> ...       ← connection indicator (z-20), toolbar (z-20)
    <TerminalPeek class="absolute top-0 right-0 bottom-0 z-40" />
    <DoneList class="z-20" />
  </div>
</div>
```

**React Flow's internal wrapper style (from source, line 3579-3585 of `@xyflow/react`):**
```js
const wrapperStyle = {
    width: '100%',
    height: '100%',
    overflow: 'hidden',
    position: 'relative',
    zIndex: 0,
};
```

**React Flow's internal z-index layers:**
- Background: z-index -1
- Pane (pan/zoom target): z-index 1
- Viewport: z-index 2
- Nodesselection: z-index 3
- Renderer: z-index 4
- Panels (Controls, MiniMap): z-index 5
- Selection: z-index 6
- Connection line SVG: z-index 1001

The `zIndex: 0` on the wrapper creates a **new stacking context**, meaning all of React Flow's internal z-indexes are scoped within it and cannot escape to compete with sibling elements.

---

## Issue 1: Mount location -- inside vs. outside ReactFlow

**Severity: Must-fix**

The plan says the terminal should float over the canvas, be draggable, and not block canvas interaction. But it is silent on **where** the floating terminal should be mounted relative to the `<ReactFlow>` component.

Currently, `TerminalPeek` is a **sibling** of `<ReactFlow>`, both children of the `<div class="relative flex-1">` wrapper. This is the correct mount location for a floating overlay and must stay this way.

The risk is that during implementation, someone might consider mounting the terminal **inside** the `<ReactFlow>` component (e.g., as a child, which React Flow renders into its panel layer). This would be wrong for several reasons:

1. React Flow's wrapper has `overflow: hidden`. A draggable window positioned near the edges would get clipped.
2. Children of `<ReactFlow>` are rendered inside the `react-flow__panel` layer (z-index 5), which gets `pointer-events: none` during selection mode (`.react-flow__pane.selection .react-flow__panel { pointer-events: none; }`). This would intermittently disable the terminal during drag-select operations on the canvas.
3. React Flow intercepts wheel and pointer events on its container element. A terminal mounted inside would have its events compete with React Flow's internal event handling in ways that are difficult to control.

**Recommendation:** The plan should explicitly state: "Mount the floating terminal as a sibling of `<ReactFlow>`, not as a child of it. It must remain outside React Flow's stacking context." This is an architectural decision that belongs in TRUST[ask], per the plan's own rules.

---

## Issue 2: `panOnScroll` conflicts with terminal body scrolling

**Severity: Must-fix**

`FlowCanvas.tsx` currently sets `panOnScroll` on the `<ReactFlow>` component (line 107). This means **wheel events on the pane cause the canvas to pan** instead of zooming.

The plan says the terminal body should scroll (ENSURE: "Input field and scroll behavior still work as before"). The terminal's scroll container (`<div ref={scrollRef} onScroll={handleScroll} class="flex-1 overflow-y-auto">`) relies on native scroll via `overflow-y: auto`.

Here is the problem: React Flow attaches a wheel event listener to its pane element. When the terminal is mounted as a sibling (correct), wheel events on the terminal will **not** propagate to React Flow's pane because they are separate DOM subtrees. So there is no conflict **as long as the terminal stays outside ReactFlow**.

However, if the terminal is accidentally mounted inside ReactFlow (see Issue 1), wheel events on the terminal body would bubble up to React Flow's wheel handler, causing the canvas to pan while the user tries to scroll terminal output. React Flow's `nowheel` CSS class (`noWheelClassName`) can prevent this, but only if explicitly applied.

**Recommendation:** Add a `nowheel` class to the terminal's scroll container as a defensive measure, even when mounted outside. If the mount location ever changes (e.g., someone refactors), the terminal scroll will still work. Cost is zero; protection is real.

Additionally, the plan should explicitly call out: "Terminal scroll area must use the `nowheel` CSS class to prevent React Flow from intercepting wheel events."

---

## Issue 3: Pointer events -- drag vs. canvas interaction

**Severity: Medium**

The plan says: "Don't block canvas interaction -- no full-screen overlay behind the terminal. Clicking the canvas around the terminal should still work (pan, select nodes, etc.)" and "Draggable by title bar (not by terminal body)."

This requires careful pointer-event management. The floating terminal needs `pointer-events: auto` on itself (to receive clicks, scrolling, input focus) but must not have any invisible overlay behind it that would swallow events intended for the canvas.

The current TerminalPeek uses `position: absolute` with explicit bounds (`top-0 right-0 bottom-0`), which only covers the panel area. When converted to a floating window, the implementation must avoid a common anti-pattern: wrapping the draggable window in a full-viewport `position: fixed; inset: 0` container for drag tracking, which would block all canvas interaction.

**Recommendation:** Implement drag tracking via `pointermove`/`pointerup` listeners on `document` (or `window`), not via a full-screen overlay element. The drag should be initiated by `pointerdown` on the title bar, with `setPointerCapture` to track movement across the entire viewport. This is a zero-overlay approach that keeps the canvas fully interactive.

**Also:** React Flow uses `noDragClassName` (default: `"nodrag"`) and `noPanClassName` (default: `"nopan"`) to prevent its gesture handlers from interfering with interactive elements inside nodes. Since the terminal is mounted *outside* ReactFlow, these classes are not needed. But if the implementation adds any interactive elements that overlap React Flow's DOM (e.g., resize handles near the canvas edge), those elements should carry `nopan nodrag nowheel` classes defensively.

---

## Issue 4: z-index strategy needs explicit values

**Severity: Medium**

The current z-index map in the app:
- DoneList toggle button: z-20
- DoneList dropdown: z-20
- TerminalPeek: z-40
- Add Repo modal: z-50
- PromptEditor modal: z-50

React Flow's internal layers (scoped within its own stacking context, z-index 0 on wrapper):
- Panels (Controls, MiniMap): z-index 5

Because React Flow's wrapper has `zIndex: 0` and `position: relative`, it creates a stacking context. This means the app's z-40 on TerminalPeek correctly floats above React Flow's internals -- React Flow's internal z-index 1001 (connection line) cannot escape its stacking context.

The floating terminal should keep z-40. But the plan should explicitly document the z-index layering to prevent future conflicts. Specifically:
- The floating terminal must sit **below** z-50 (modals like PromptEditor, Add Repo) so that modals can overlay the terminal.
- It must sit **above** z-20 (DoneList) so it is not hidden behind the done list panel.

**Recommendation:** The plan should specify: "Floating terminal uses z-index 40 (same as current). Full-screen modals (z-50) overlay it. DoneList (z-20) sits beneath it."

---

## Issue 5: Resize handles near canvas edges may intercept React Flow events

**Severity: Impl-note**

When the floating terminal is positioned near the left or bottom edges of the viewport, its resize handles will visually overlap the canvas area. These handles need to intercept pointer events for resizing but must not interfere with React Flow's pan/zoom/selection gestures.

Since the terminal is a sibling of ReactFlow in the DOM (higher z-index), its resize handles will naturally receive pointer events first -- React Flow won't even see them. This is correct behavior: the user is interacting with the resize handle, not the canvas.

The only edge case is if resize handles are implemented as invisible hit areas that extend beyond the terminal's visual bounds (common for thin-edge resize). These invisible areas could swallow click events that the user intends for the canvas.

**Recommendation:** Keep resize hit areas tight (8-12px). Do not extend invisible hit areas more than 4-6px beyond the terminal's visual border. This is a tuning concern, not an architectural one.

---

## Issue 6: Escape key handling needs priority update

**Severity: Impl-note**

`App.tsx` has a global `keydown` listener that handles Escape in a priority chain: PromptEditor > selectedNode > doneList. Currently, closing the terminal (Escape when `selectedNodeId` is set) calls `setSelectedNode(null)`, which unmounts `TerminalPeek`.

When the terminal becomes a floating, draggable window, the Escape behavior should likely:
1. First close the terminal if it is open (regardless of whether the underlying node is still selected).
2. Or alternatively, minimize/hide the terminal without deselecting the node.

The plan is silent on this UX decision. The current behavior (Escape deselects the node, which also closes the terminal) couples node selection with terminal visibility. A floating terminal might want independent lifecycle -- e.g., the user drags the terminal somewhere, clicks a different node, and the terminal should stay open showing the previous node's output (or switch to the new node).

**Recommendation:** This is a UX decision that should be clarified before implementation. The plan's TRUST section marks component API changes as [ask], and this qualifies -- the relationship between node selection and terminal visibility is a component API concern.

---

## Issue 7: `fitView` interaction with floating terminal position

**Severity: Impl-note**

`FlowCanvas.tsx` uses `fitView` (line 112), which adjusts the viewport to fit all nodes on initial render. The plan says the terminal "Opens centered in the viewport." If "viewport" means the browser viewport, this is straightforward. But if it means "centered in the visible canvas area" (accounting for the terminal's own footprint), the centering calculation needs to know the terminal's dimensions.

Since the terminal is a sibling overlay (not part of React Flow's coordinate system), `fitView` does not account for it. This means nodes may be positioned behind the floating terminal after a `fitView` call.

**Recommendation:** This is a known limitation of overlay-based UIs and probably not worth solving now. But the plan should acknowledge that `fitView` and `relayout` may position nodes behind the floating terminal window. A future enhancement could add padding to `fitView` options to reserve space.

---

## Summary

| # | Issue | Severity | Rework risk |
|---|-------|----------|-------------|
| 1 | Mount location must be outside ReactFlow | Must-fix | Wrong mount = complete redo of event handling |
| 2 | `panOnScroll` + terminal scroll conflict | Must-fix | Subtle bug that only appears with panOnScroll enabled |
| 3 | Drag implementation must avoid full-screen overlays | Medium | Wrong approach = canvas interaction broken |
| 4 | z-index values need explicit documentation | Medium | Prevents future stacking bugs |
| 5 | Resize handle hit areas should be tight | Impl-note | Tuning concern |
| 6 | Escape key / node selection coupling | Impl-note | UX decision, not architecture |
| 7 | `fitView` does not account for terminal footprint | Impl-note | Known limitation, defer |

**Bottom line:** The plan is sound in its intent. The two must-fix items are about making implicit architectural decisions explicit: (1) the terminal must be mounted as a sibling of ReactFlow, not inside it, and (2) the terminal's scroll area needs defensive `nowheel` class protection against `panOnScroll`. The medium items are about documenting decisions (z-index map, drag implementation approach) so the implementer does not choose a path that conflicts with React Flow's event system.
