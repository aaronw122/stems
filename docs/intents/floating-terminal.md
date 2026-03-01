---
title: "Floating Terminal Window"
author: "human:aaron"
version: 2
created: 2026-02-28
---

# Floating Terminal Window

## WANT

Convert the TerminalPeek panel from a fixed right-sidebar into a floating, draggable, resizable window that opens centered on the viewport — like a macOS terminal window. One terminal at a time (opening a new one replaces the current).

- Drag by title bar to reposition
- Resize by dragging edges and corners
- Opens centered in the viewport on first open
- Position and size persist across open/close cycles within a session (state lives in parent or Zustand store, not inside TerminalPeek, since the component unmounts on close). First open centers; subsequent opens restore last position/size. Resets on page reload.

## DON'T

- Don't block canvas interaction — no full-screen overlay behind the terminal. Clicking the canvas around the terminal should still work (pan, select nodes, etc.)
- Don't allow the window to be dragged fully off-screen (keep at least the title bar visible)

## LIKE

- Keep the existing retro Mac OS X style — classic traffic lights, amber CRT glow, gradient title bar. Just make it float instead of dock.

## FOR

- Same users as stems: developers using the agent orchestration GUI
- Desktop browsers with touchpad (the canvas already has Figma-style gestures)
- React + TypeScript + Tailwind stack, no new dependencies

## ENSURE

- Opens centered in the viewport
- Draggable by title bar (not by terminal body — body should scroll)
- Resizable by dragging edges and corners
- Enforces a minimum size so the window doesn't collapse (e.g., 320x200)
- Stays within viewport bounds (title bar always reachable)
- Retains current retro styling (traffic lights, amber text, title bar gradient)
- Canvas remains interactive behind/around the terminal window
- Input field and scroll behavior still work as before
- Drag/resize uses `pointerdown` on the respective handle, then promotes to `document.addEventListener('pointermove'/'pointerup')` for the gesture duration. No full-screen overlay element. `stopPropagation()` called on pointer events within the terminal root to prevent canvas pan/zoom from firing.
- Terminal scroll container uses React Flow's `nowheel` CSS class to prevent wheel events from bubbling to the canvas `panOnScroll` handler.
- On open, focus moves to terminal input field; on close, focus returns to canvas
- Escape during an active drag/resize cancels the interaction and restores prior position (does NOT close the window)
- Tab cycles through terminal interactive elements (input, Send, close button) before reaching canvas

## TRUST

- [autonomous] Implementation approach (pointer events vs. CSS resize vs. other)
- [autonomous] Exact minimum size values
- [autonomous] Default window dimensions
- [autonomous] Resize handle styling (subtle grab indicators)
- [ask] TerminalPeek must be mounted as a sibling of `<ReactFlow>` inside the `div.relative.flex-1` container in App.tsx, NOT as a child of ReactFlow. React Flow's wrapper applies `overflow: hidden` and its own pointer-event/stacking-context behavior that would break drag, scroll, and z-index.
