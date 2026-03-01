# Floating Terminal Plan Review -- Frontend Architect

**Reviewer:** Frontend Architect (agent1)
**Date:** 2026-02-28
**Plan:** `docs/intents/floating-terminal.md`
**Codebase files reviewed:** `src/App.tsx`, `src/components/panels/TerminalPeek.tsx`, `src/styles/flow.css`, `src/components/FlowCanvas.tsx`, `src/components/panels/PromptEditor.tsx`, `src/components/panels/DoneList.tsx`

---

## Summary

The plan is well-scoped with clear WANT/DON'T/ENSURE constraints. Most of what needs to happen is a contained refactor of `TerminalPeek.tsx` plus CSS additions. However, several architectural decisions are underspecified that could cause rework if discovered mid-implementation.

---

## Issues

### 1. Pointer event conflict between drag/resize and React Flow canvas

**Severity: Must-fix**

The plan says "Canvas remains interactive behind/around the terminal window" and "no full-screen overlay." The current implementation uses `absolute top-0 right-0 bottom-0 z-40` which covers only the right column. Converting to a floating window means the terminal sits _over_ the React Flow canvas in the same stacking context (the `div.relative.flex-1` wrapper in App.tsx).

The problem: React Flow's pan/zoom listens on `pointerdown`/`pointermove` at the canvas level. A floating `<div>` with `z-40` will intercept pointer events over its area, which is the desired behavior _on_ the terminal. But the plan doesn't address:

- **Edge/corner resize handles need to extend slightly _outside_ the terminal bounds** (typically 4-8px grab zones). These invisible extensions will eat pointer events from the canvas. If you use a transparent overlay/border approach for resize handles, canvas interaction breaks in a halo around the terminal.
- **During an active drag or resize, `pointermove` events must be captured on `document`** (not the terminal div) to handle fast mouse movement that leaves the element bounds. The plan should specify that drag/resize uses `document.addEventListener('pointermove', ...)` with cleanup, not just React `onPointerMove` on the element. This is a well-known pattern but architecturally important because it means the drag/resize logic is _not_ purely component-scoped -- it touches global event listeners.

**Recommendation:** The plan should specify that resize handles use `pointerdown` capture on thin edge zones, then promote to document-level `pointermove`/`pointerup` listeners for the duration of the gesture. This prevents canvas event leaking during resize while keeping canvas interactive when idle.

---

### 2. z-index layering strategy is undefined

**Severity: Medium**

Current z-index landscape:
- React Flow controls/minimap: internal z-indices (typically z-5 to z-10)
- DoneList toggle + panel: `z-20`
- TerminalPeek: `z-40`
- PromptEditor overlay: `z-50`
- Add Repo modal overlay: `z-50`

The plan doesn't specify what z-index the floating terminal should use. Currently `z-40` works for a sidebar, but a floating window creates new layering questions:

- Should the terminal float _above_ the DoneList panel (z-20)? Almost certainly yes, but it's unspecified.
- When the PromptEditor modal opens (z-50 with full backdrop), should it cover the terminal? Currently yes, which seems correct. But if the terminal is also z-50, they compete.
- React Flow's minimap and controls have their own internal z-indices. A floating terminal dragged over the minimap could produce visual glitches if z-indices aren't coordinated.

**Recommendation:** Keep terminal at z-40 (above DoneList's z-20, below modals at z-50). This matches the current implicit layering. State this explicitly in the plan so implementation doesn't accidentally change it.

---

### 3. The plan says "no changes to component API" is [ask], but the mount point needs to change

**Severity: Must-fix**

Under TRUST, the plan says: `[ask] Any changes to the component API or how TerminalPeek is mounted in the parent`. This is flagged as requiring human approval, but the conversion _inherently_ changes how TerminalPeek is mounted:

**Current mount (App.tsx lines 227-234):**
```tsx
{selectedNodeId && (
  <TerminalPeek
    nodeId={selectedNodeId}
    nodeTitle={selectedNodeTitle}
    onClose={handleTerminalClose}
    onSendInput={handleTerminalInput}
  />
)}
```

TerminalPeek is rendered inside `div.relative.flex-1`, which is the React Flow container. It uses `absolute top-0 right-0 bottom-0` to position itself relative to this container.

**Required changes for floating:**
- Position must change from `absolute` anchored to parent edges to `fixed` or `absolute` with `left/top` offset from pointer-event-derived state.
- The component likely needs to accept or internally manage `position: { x, y }` and `size: { width, height }` state.
- If using `position: fixed`, the component could be moved _outside_ the `div.relative.flex-1` container entirely (to avoid transform-induced fixed positioning bugs from React Flow).

The props interface may not need to change (position/size can be internal state), but the _mount location_ in the component tree likely should change. This is exactly the kind of thing the plan asks to `[ask]` about, but it's not surfaced as a decision point -- the implementer might not realize this needs approval before starting.

**Recommendation:** Add a decision point to the plan: "TerminalPeek will continue to render inside the `div.relative.flex-1` wrapper using `absolute` positioning with computed `left`/`top`/`width`/`height`, OR it will be moved to a portal/fixed-position mount outside the flow container." The choice affects how viewport bounds are calculated and whether React Flow transforms interfere with positioning.

---

### 4. "Opens centered in the viewport" vs. "opens centered in the flow container"

**Severity: Medium**

The plan says "Opens centered in the viewport." The current mount is inside `div.relative.flex-1`. If the terminal uses `position: absolute`, centering means centering within the flex-1 container, not the viewport. These are currently the same (flex-1 fills the screen since there's no header bar), but this is a fragile assumption.

If the component stays `absolute` inside the flow container, centering logic is:
```
left = (container.offsetWidth - windowWidth) / 2
top = (container.offsetHeight - windowHeight) / 2
```

If the component uses `position: fixed` or a portal, centering is:
```
left = (window.innerWidth - windowWidth) / 2
top = (window.innerHeight - windowHeight) / 2
```

This is tightly coupled to issue #3. Resolve the mount point question and this resolves automatically.

---

### 5. Viewport bounds enforcement during window resize

**Severity: Impl-note**

The plan says "keep at least the title bar visible" and "stays within viewport bounds." It doesn't specify what happens when the _browser_ window is resized and the terminal ends up partially off-screen. Should the terminal snap back? Clamp on next interaction? Passively allow it?

This is implementation-level since any reasonable choice works and can be tuned later. But worth noting so the implementer thinks about it.

---

### 6. Drag initiation vs. title bar text selection

**Severity: Impl-note**

The plan correctly says "Draggable by title bar." The title bar currently contains selectable text (the node title). Starting a drag on `pointerdown` will conflict with text selection if the user tries to select/copy the title text. The current implementation has `select-none` on the title text, so this is already handled. Just confirming: keep `select-none` and apply `cursor: grab` / `cursor: grabbing` to the title bar.

---

### 7. Interaction between terminal input focus and drag

**Severity: Impl-note**

When the user clicks the terminal input field, focus should go to the input, not initiate a window interaction. Since drag is title-bar-only and resize is edge-only, this should naturally work. But the implementer should verify that `pointerdown` on the input doesn't bubble up to any drag handler. Standard pattern: drag handlers only attach to the title bar element, not the window root.

---

### 8. No mention of Escape key behavior change

**Severity: Low**

Currently in App.tsx, pressing Escape when `selectedNodeId` is set calls `setSelectedNode(null)`, which closes the terminal. With a floating terminal, Escape closing the terminal immediately might be surprising if the user just wants to deselect the canvas but keep the terminal visible.

The plan doesn't say to change this, so current behavior persists. But it's worth a conscious decision: should Escape close the floating terminal, or should only the red traffic light close it? The floating window metaphor (like a real terminal app) suggests Escape should _not_ close it -- you close windows with the close button, not Escape. But this is a UX preference, not an architectural issue.

---

### 9. State management: position/size should be component-local, not Zustand

**Severity: Impl-note**

The plan says "Remembers position/size during session (resets on page reload is fine)." Since TerminalPeek unmounts when `selectedNodeId` is null, component-local state (`useState`) would reset position/size every time the terminal closes and reopens. If "remembers during session" means "across open/close cycles," the position/size state needs to live _outside_ TerminalPeek -- either in App.tsx or in a lightweight Zustand slice.

If "remembers during session" only means "while the terminal is open," then component-local state is fine. The plan should clarify which is intended, because it changes where state lives (architectural decision).

---

### 10. CSS `resize` property vs. custom pointer-based resize

**Severity: Impl-note**

The plan says `[autonomous] Implementation approach (pointer events vs. CSS resize vs. other)`. Worth noting: CSS `resize` only works on `overflow: auto/scroll/hidden` elements, only provides a single corner handle (bottom-right), and doesn't support minimum size enforcement or edge dragging. It also can't be styled to match the retro aesthetic. The plan's ENSURE requirements (resize from edges AND corners, minimum size enforcement) effectively rule out CSS `resize`. The implementation will need custom pointer-event-based resize logic. This is the right call but wanted to confirm the autonomous decision is already constrained by the requirements.

---

## Architecture Decision Summary

Two decisions need to be made before implementation begins:

1. **Mount point** (issue #3/#4): Does TerminalPeek stay inside `div.relative.flex-1` with `position: absolute`, or move to a portal/fixed mount? This determines centering logic, bounds enforcement, and whether React Flow transforms can interfere.

2. **Position/size state lifetime** (issue #9): Does position persist across open/close cycles within a session, or only while the terminal is open? This determines whether state lives in the component or is lifted.

Everything else is implementation-level and can be resolved during coding.

---

## Issue Count by Severity

| Severity | Count |
|----------|-------|
| Must-fix | 2 (#1, #3) |
| Medium | 2 (#2, #4) |
| Low | 1 (#8) |
| Impl-note | 5 (#5, #6, #7, #9, #10) |
