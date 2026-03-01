# Floating Terminal Window -- UX/Interaction Design Review

**Reviewer:** UX/Interaction Design specialist
**Plan:** `/docs/intents/floating-terminal.md`
**Files reviewed:** `TerminalPeek.tsx`, `flow.css`, `App.tsx`, `FlowCanvas.tsx`, `useGraph.ts`
**Date:** 2026-02-28

---

## 1. Cursor styling for resize handles

**Severity: Impl-note**

The plan says "Resizable by dragging edges and corners" (ENSURE) and "Resize handle styling (subtle grab indicators)" (TRUST/autonomous), but never specifies which edges/corners or what cursor styles to use.

Standard expectation for a resizable floating window is eight handles: n, s, e, w, ne, nw, se, sw. Each needs a distinct CSS cursor (`n-resize`, `ew-resize`, `nwse-resize`, `nesw-resize`, etc.) to communicate affordance. The plan is right to trust this to implementation, and the implementer won't need to come back for clarification -- this is well-understood convention. But do make sure:

- Hit targets for edge handles are at least 6-8px wide. The visible border can be 1px, but the invisible hit area needs to extend beyond it. Without this, edge-resize on a 1px border is nearly impossible.
- Corner handles should have priority over edge handles where they overlap (corners sit "on top" in terms of pointer hit testing).
- The resize cursor should appear on hover, not only during active drag. This is the primary discoverability affordance.

No plan change needed. Standard implementation concern.

---

## 2. Browser/viewport resize while terminal is near edge

**Severity: Medium**

The plan says "Stays within viewport bounds (title bar always reachable)" but does not address what happens when the viewport itself shrinks (user resizes the browser window, or a dev tools panel opens). If the terminal is positioned near the right or bottom edge and the viewport shrinks, the terminal can end up partially or fully off-screen with no mechanism to recover it.

**Why this matters before implementation:** The approach to this problem shapes the architecture. You have two fundamental strategies:

1. **Reactive clamping:** Add a `resize` event listener on `window` that re-clamps position whenever the viewport changes. This is simple but can cause jarring jumps if the user is mid-drag or if the terminal has been carefully positioned.
2. **Proportional/anchored positioning:** Store position as a percentage or as an offset from a viewport edge, so the terminal naturally tracks viewport changes. This is more complex but smoother.

Strategy 1 is almost certainly the right call here given the scope ("session-only memory, resets on reload"), but the plan should name it explicitly so the implementer doesn't discover the edge case mid-build and have to decide on the fly.

**Recommendation:** Add a note under ENSURE: "On viewport resize, re-clamp position so title bar remains reachable."

---

## 3. "Title bar always reachable" constraint definition

**Severity: Medium**

The plan says "Don't allow the window to be dragged fully off-screen (keep at least the title bar visible)" (DON'T) and "Stays within viewport bounds (title bar always reachable)" (ENSURE). These two statements are slightly different constraints:

- "Title bar visible" means: the top ~36px of the window must overlap the viewport. The body can be off-screen below, and the window can extend past the left/right/bottom edges as long as the title bar region intersects the viewport.
- "Stays within viewport bounds" is stricter: the entire window stays inside the viewport.

macOS convention is the former: you can drag a window so only the title bar is on-screen, and the content hangs off any edge. This is important because it lets users park a window mostly off-screen to get it out of the way while keeping it retrievable.

**Recommendation:** Clarify the constraint. Suggested language: "At least the full width of the title bar (or a minimum 100px strip of it) must remain within the viewport, so the user can always grab and reposition the window. The body may extend past any edge." This gives a precise implementation target.

Also define behavior for the top edge specifically: can the title bar be dragged above the top of the viewport? On macOS, no -- the menu bar blocks this. In a browser, there's no menu bar, so the implementer needs guidance. Suggestion: prevent the title bar from going above y=0 (the top of the viewport).

---

## 4. Keyboard accessibility (Escape to close, focus management)

**Severity: Must-fix**

The plan does not mention keyboard accessibility at all. The current implementation in `App.tsx` already handles Escape to close (when `selectedNodeId` is set, pressing Escape calls `setSelectedNode(null)`), but the plan doesn't acknowledge this existing behavior or extend it for the floating window context.

Issues the plan should address:

**a) Focus trapping / management.** When the terminal opens, where does focus go? Currently there's no `autoFocus` on the terminal input. For a floating window that doesn't block the canvas, full focus trapping (like a modal) would be wrong. But the plan should specify: "On open, focus moves to the terminal input field. On close (Escape or traffic light), focus returns to the canvas." Without this, keyboard users will have no way to efficiently interact with the terminal after opening it.

**b) Escape key ambiguity.** The current global Escape handler in `App.tsx` already closes the terminal by clearing `selectedNodeId`. But the plan introduces drag and resize interactions. What happens if the user presses Escape mid-drag or mid-resize? Convention is: Escape cancels an in-progress drag/resize and returns the window to its pre-interaction position. The plan should note this so the implementer builds a "cancel interaction" path, not just a "close window" path.

**c) Tab order.** A floating window overlaying a canvas creates a non-obvious tab order. The terminal's input field, Send button, and close button should be reachable via Tab. The canvas elements underneath should not be reachable via Tab while the terminal is open (or if they are, the terminal should come first in tab order). The plan should specify this.

**Why must-fix:** Focus management shapes how the component mounts, what refs it holds, and how it communicates with the parent. Discovering mid-implementation that focus needs to be managed will require reworking the component lifecycle and possibly the parent's Escape handler.

---

## 5. Double-click title bar behavior

**Severity: Low**

macOS convention: double-clicking the title bar minimizes the window (or in some configurations, zooms it). The plan doesn't mention this. Options:

- **Ignore it.** Acceptable for an MVP. Double-click on the title bar does nothing special.
- **Toggle maximize.** Double-click toggles between the user's custom size/position and a "maximized" state (e.g., filling most of the viewport with some margin). This is a nice power-user feature.
- **Minimize to title bar only.** Collapse the window body so only the title bar is visible, and double-click again to restore. This is a classic Mac OS 9 "windowshade" behavior that fits the retro aesthetic.

No plan change required for MVP. But if the retro Mac aesthetic is a priority, the "windowshade" collapse could be a delightful detail worth noting as a future enhancement.

---

## 6. Snap behavior

**Severity: Impl-note**

macOS has edge-snap (drag to screen edge to tile the window). Windows has Aero Snap. The plan doesn't mention snap-to-edge behavior.

For an MVP floating window, no snap behavior is fine. If the team later wants it, edge-snapping is additive and doesn't affect the drag/resize architecture. No plan change needed.

---

## 7. Drag interaction vs. canvas pan conflict

**Severity: Must-fix**

The current implementation renders `TerminalPeek` inside the same `relative` container as `FlowCanvas`. The canvas uses `panOnScroll` and handles mouse/pointer events for node dragging and panning.

When the terminal becomes a floating, draggable window, pointer events on the terminal's title bar (for dragging) will bubble to the React Flow canvas underneath unless explicitly stopped. This means:

- Dragging the title bar could simultaneously pan the canvas.
- Mousedown on resize handles could trigger canvas interactions.

The plan says "Don't block canvas interaction -- no full-screen overlay behind the terminal. Clicking the canvas around the terminal should still work." This is the right intent, but it creates a specific technical requirement: the terminal must call `stopPropagation()` on pointer/mouse events within its bounds, so that events inside the terminal don't reach the canvas, while events outside the terminal pass through naturally.

**Why must-fix:** This is an architectural decision that affects how the component is wired. If the implementer doesn't plan for event isolation from the start, they'll hit the "dragging the title bar also pans the canvas" bug immediately and have to restructure event handling.

**Recommendation:** Add to ENSURE: "Pointer events within the terminal window do not propagate to the canvas (stopPropagation on the terminal's root element)."

---

## 8. z-index layering with other overlays

**Severity: Impl-note**

Current z-index stack:
- Terminal: `z-40`
- PromptEditor modal: `z-50`
- Add Repo modal: `z-50`
- React Flow controls/minimap: default React Flow z-indices

The plan says the terminal should float above the canvas but doesn't specify how it interacts with the existing modals. Currently this works fine (modals at z-50 sit above terminal at z-40). But when the terminal becomes freely positioned, it could visually overlap with the minimap or controls in the bottom-left corner.

No plan change needed. Implementation should just keep the existing z-index hierarchy and ensure the terminal doesn't obscure React Flow's built-in controls (or if it does, that the user can drag it away).

---

## 9. Current layout is "docked right" -- migration path unclear

**Severity: Medium**

The current `TerminalPeek` is absolutely positioned to the right edge:
```
className="absolute top-0 right-0 bottom-0 z-40 flex w-[480px] ..."
```

This is a full-height right sidebar, not a window. The plan says "Convert the TerminalPeek panel from a fixed right-sidebar into a floating, draggable, resizable window" but doesn't specify whether this is a refactor of the existing component or a new component that replaces it.

This matters because:
- The existing component has no concept of position state (x, y), size state (width, height), or drag/resize handlers.
- The parent (`App.tsx`) renders it inline with no position management.
- The component's internal layout (flex column with flex-1 for the scroll area) works for a fixed-height sidebar but needs adaptation for a variable-height window.

**Recommendation:** The plan should state explicitly: "Refactor `TerminalPeek` in-place. Add position/size state. Replace absolute-right positioning with absolute positioning driven by state (top/left/width/height)." Or alternatively: "Create a new `FloatingTerminal` wrapper that handles position/size and renders the existing `TerminalPeek` content inside it." The second approach is cleaner for separation of concerns (window chrome vs. terminal content).

---

## 10. Resize interaction vs. terminal body scroll conflict

**Severity: Medium**

The plan says "Draggable by title bar (not by terminal body -- body should scroll)" and "Resizable by dragging edges and corners." But the bottom edge resize handle is directly adjacent to (or overlapping with) the terminal's scrollable content area and the input field.

Specific conflict scenarios:
- **Bottom-edge resize handle vs. input field:** If the resize handle is at the very bottom, it overlaps with the input/send area. The user intending to click into the input field might accidentally start a resize.
- **Right-edge resize handle vs. scrollbar:** The scrollable terminal area will show a scrollbar on the right edge. The resize handle for the right edge sits in the same zone.
- **Corner resize (se) vs. Send button:** The bottom-right corner handle overlaps with the Send button.

**Recommendation:** The plan should note that resize handles are positioned outside or overlapping the border of the window, not inside the content area. A common approach is to use negative margins or pseudo-elements that extend a few pixels outside the visible window border, so they don't compete with interior interactive elements. Alternatively, reserve a visible 4-6px border/bezel around the entire window specifically for resize affordance -- which would also fit the retro Mac aesthetic (classic Mac OS windows had a visible resize grip in the bottom-right corner).

---

## 11. Opening animation and initial centering

**Severity: Impl-note**

The plan says "Opens centered in the viewport on first open." A few clarifications that the implementer will need:

- **"First open" per session or per node?** If the user opens terminal for Node A, drags it somewhere, closes it, then opens terminal for Node B, does Node B open centered or at Node A's last position? The plan says "One terminal at a time (opening a new one replaces the current)" and "Remembers position/size during session." This suggests the position persists across different nodes within a session, which means only the very first terminal open is centered, and subsequent opens reuse the last position. The plan should confirm this intent.
- **Transition/animation:** Should the terminal appear instantly or animate in (e.g., scale from center, fade in)? macOS windows typically appear instantly with a subtle shadow animation. No plan change needed, but the implementer should know whether animation is desired.

---

## 12. Terminal input not mentioned as needing preservation across node switches

**Severity: Impl-note**

Currently, the input field state (`useState('')`) resets when the component remounts for a different node. The plan says "One terminal at a time (opening a new one replaces the current)" but doesn't say whether in-progress input text should be preserved. This is fine -- clearing it on node switch is reasonable. Just noting it for completeness.

---

## Summary table

| # | Issue | Severity | Plan change needed? |
|---|-------|----------|-------------------|
| 1 | Cursor styling for resize handles | Impl-note | No |
| 2 | Viewport resize re-clamping | Medium | Yes -- add to ENSURE |
| 3 | "Title bar always reachable" ambiguity | Medium | Yes -- clarify constraint |
| 4 | Keyboard accessibility (focus, Escape, Tab) | Must-fix | Yes -- add to ENSURE |
| 5 | Double-click title bar | Low | No |
| 6 | Snap-to-edge behavior | Impl-note | No |
| 7 | Drag/resize events propagating to canvas | Must-fix | Yes -- add to ENSURE |
| 8 | z-index layering with other overlays | Impl-note | No |
| 9 | Migration path (refactor vs. wrapper) | Medium | Yes -- clarify approach |
| 10 | Resize handles vs. interior elements conflict | Medium | Yes -- add guidance |
| 11 | Opening behavior: per-session vs. per-node | Impl-note | Optional clarification |
| 12 | Input text preservation across node switch | Impl-note | No |

**Must-fix (2):** Issues 4 and 7 should be addressed in the plan before implementation. Both affect how the component is structured at an architectural level.

**Medium (4):** Issues 2, 3, 9, and 10 would benefit from plan clarification to prevent mid-implementation decisions that could cause rework.

**Low (1):** Issue 5 is deferrable.

**Impl-note (5):** Issues 1, 6, 8, 11, 12 are real but won't cause architectural rework.
