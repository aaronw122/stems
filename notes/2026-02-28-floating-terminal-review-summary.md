# Plan Review Summary

**Plan:** docs/intents/floating-terminal.md
**Rounds:** 2
**Final revision:** 2

## Issues Found & Fixed

### Round 1 Must-Fix Issues (all fixed in v2)

- **Pointer event conflict between drag/resize and React Flow canvas** (Frontend Architect + UX): No full-screen overlay approach was specified. v2 now requires drag/resize to use `pointerdown` on the handle, promote to `document.addEventListener('pointermove'/'pointerup')` for the gesture duration, and call `stopPropagation()` on pointer events within the terminal root.

- **Mount location unspecified — must stay outside ReactFlow** (React Flow Specialist + Frontend Architect): The plan was silent on where to mount the floating terminal. If mounted inside React Flow's wrapper: (1) `overflow: hidden` would clip it near edges, (2) pointer-events get disabled during canvas selection mode, (3) wheel/pointer events compete with React Flow internals. v2 adds an explicit TRUST[ask] item requiring TerminalPeek to remain a sibling of `<ReactFlow>` inside `div.relative.flex-1`, not a child of ReactFlow.

- **`panOnScroll` conflict with terminal body scrolling** (React Flow Specialist): Wheel events on the terminal could bubble to React Flow's pan handler. v2 adds a requirement to apply React Flow's `nowheel` CSS class to the terminal scroll container.

- **Position/size state lifetime undefined** (Frontend Architect): Component-local state would reset on every open/close cycle. v2 explicitly states state must live in the parent or Zustand store (not inside TerminalPeek which unmounts on close), first open centers, subsequent opens restore last position/size, resets on page reload.

- **Keyboard accessibility entirely unaddressed** (UX): No focus management, no Escape handling during gestures, no Tab order. v2 adds three ENSURE items: (a) focus moves to input on open, returns to canvas on close; (b) Escape during active drag/resize cancels and restores prior position without closing the window; (c) Tab cycles through terminal interactive elements (input, Send, close button) before reaching the canvas.

- **Drag/resize events propagating to canvas** (UX): Pointer events inside the terminal would bubble to React Flow causing simultaneous canvas pan. Fixed by the `stopPropagation()` + document-level listener strategy added to ENSURE in v2.

### Round 1 Medium Issues (all resolved or downgraded in v2)

- **"Viewport centering" vs. "container centering" ambiguity** (Frontend Architect): Resolved by the mount point decision — since TerminalPeek uses `position: absolute` inside `div.relative.flex-1` which fills the screen, container centering and viewport centering are equivalent.

- **z-index layering undefined** (React Flow Specialist + UX): Not explicitly documented in v2, but both reviewers downgraded to Impl-note on re-evaluation — the existing `z-40` on TerminalPeek is already correct and no implementer would change it without reason.

- **Drag implementation must avoid full-screen overlays** (React Flow Specialist): Addressed by the detailed ENSURE item specifying the document-level listener promotion pattern.

- **Viewport resize re-clamping** (UX): Not added to v2, downgraded to Impl-note — the "title bar always reachable" ENSURE constraint implies this and any implementer will discover it during testing.

- **Title bar constraint ambiguity — "stays within viewport bounds" vs. "keep at least title bar visible"** (UX): Remains slightly ambiguous in v2 but both phrasings together make intent clear. Downgraded to Impl-note.

- **Migration path unclear (refactor in-place vs. wrapper component)** (UX): Not addressed; downgraded to Impl-note since TRUST/autonomous delegation covers this and either approach is viable without causing rework.

- **Resize handles vs. interior elements conflict** (UX): Not addressed; downgraded to Impl-note since the standard outside-border hit-area pattern is well-understood and any conflict surfaces immediately in testing.

## Remaining Issues

- **Escape-to-close behavior vs. floating window metaphor** (Low — Frontend Architect): The existing App.tsx behavior of pressing Escape to close the terminal is preserved in v2. The plan adds Escape-during-drag cancels gesture, but Escape while idle still closes the terminal — a departure from macOS floating window convention where Escape does not close windows. Not worth changing for MVP; trivial to adjust post-implementation if UX feels wrong.

- **z-index map not documented in plan** (Impl-note — multiple reviewers): Terminal at z-40, DoneList at z-20, modals at z-50. React Flow's internal z-indices are scoped within its own stacking context (wrapper has `zIndex: 0, position: relative`) and cannot escape to compete. The implementer will naturally carry forward `z-40`.

- **Viewport bounds enforcement during browser window resize** (Impl-note — UX): Terminal may drift off-screen if the browser window shrinks after the terminal is positioned near an edge. The "title bar always reachable" constraint implies reactive clamping via a `window` resize listener; this is the obvious implementation and will surface in testing.

- **Title bar constraint needs precise definition** (Impl-note — UX): "Title bar always reachable" means y >= 0 and sufficient horizontal overlap. Body may extend past any edge. Implementer should clamp `top` to >= 0 and ensure at least ~100px of title bar width stays inside viewport left/right bounds.

- **Double-click title bar** (Low — UX): macOS convention is minimize or zoom. Plan correctly defers this. Could be a future "windowshade" collapse feature fitting the retro aesthetic, but not needed for MVP.

## Implementation Notes

- **`stopPropagation()` scope**: Apply on `pointerdown` specifically (which React Flow listens on to initiate pan). Applying it too broadly (all pointer events) could interfere with React's synthetic event system or prevent cleanup of document-level listeners. `pointermove`/`pointerup` propagate naturally since they are captured at document level by drag/resize handlers anyway.

- **`nowheel` class placement**: Must be added to the scroll container div (`scrollRef` div, line 87 of TerminalPeek.tsx). Adding it to the terminal root is also acceptable and covers all wheel events. Verify the class name with the project's version of `@xyflow/react` — the class name convention has varied across versions (`nowheel` vs `react-flow__nowheel`).

- **Escape key priority chain**: App.tsx has a global keydown handler. Escape during drag/resize (which should cancel the gesture only) must `stopPropagation()` or check gesture state before the global handler fires, otherwise Escape during drag would both cancel the gesture AND close the terminal — contradicting the plan requirement.

- **Pre-gesture position snapshot**: The "Escape cancels and restores prior position" requirement implies capturing a snapshot of position/size at `pointerdown` start. This is a natural part of the drag state machine (capture start → apply deltas on move → commit on pointerup → revert on Escape).

- **Focus trap semantics**: "Tab cycles through terminal elements before reaching canvas" means natural DOM tab order — cycle through terminal's interactive elements (close button, input, Send button, conditionally the scroll-to-bottom button), then let focus escape to canvas. Not a hard trap. Hard focus trapping would be wrong for a non-modal floating window.

- **Focus return on close**: "Focus returns to canvas" on close can be implemented as calling `.focus()` on the React Flow wrapper element, or simply `document.activeElement?.blur()`. React Flow listens on `window`/`document` for keyboard shortcuts and does not require explicit element focus.

- **CSS `resize` property**: The ENSURE requirements (resize from all 8 edges/corners, minimum size enforcement) effectively rule out CSS `resize`, which only provides a single bottom-right corner handle and requires `overflow: auto/scroll/hidden`. Custom pointer-event-based resize is required and is the right approach.

- **Position/size state location**: Zustand is the cleaner choice over App.tsx state since App.tsx already uses Zustand for `selectedNodeId`. State must survive the TerminalPeek unmount that happens when `setSelectedNode(null)` is called.

- **`fitView` and node visibility**: React Flow's `fitView` does not account for the terminal's footprint as a sibling overlay. Nodes may be positioned behind the terminal after fitView. Known limitation; not worth solving now. Future enhancement could add padding to `fitView` options.

- **Resize hit areas**: Edge handle hit targets should be at least 6-8px (invisible area extending slightly beyond the visible border). Keep invisible extension to 4-6px maximum to avoid swallowing click events intended for the canvas. Corner handles should have priority over edge handles where they overlap.

- **Title bar text selection**: Current code already has `select-none` on the title text. Keep this and apply `cursor: grab` / `cursor: grabbing` to the title bar on idle/active drag.

- **`nowheel` class and canvas deselect**: The `stopPropagation()` on the terminal root correctly prevents a terminal click from triggering any future "click canvas to deselect node" behavior — this is desirable and forward-compatible.

## Reviewer Personas Used

| Persona | Focus Area |
|---------|-----------|
| Frontend Architect (agent1, rounds 1 & 2) | Component architecture, state management, mount point decisions, CSS positioning strategies, React Flow stacking context |
| React Flow Integration Specialist (agent2, rounds 1 & 2) | Event propagation between the terminal and React Flow, z-index layering within React Flow's stacking context, `panOnScroll` conflicts, `nowheel`/`nodrag`/`nopan` class patterns |
| UX/Interaction Design specialist (agent3, rounds 1 & 2) | Drag and resize interaction patterns, keyboard accessibility (focus management, Escape key, Tab order), cursor styling, viewport boundary enforcement, migration path clarity |
