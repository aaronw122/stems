---
title: "Figma-Style Canvas Interaction"
author: "human:aaron"
version: 1
created: 2026-03-02
---

# Figma-Style Canvas Interaction

## WANT
- Default cursor is pointer/select (dark arrow with white outline, Figma-style) — NOT the grab/pan hand
- Marquee/box selection: click and drag on empty canvas to draw a selection rectangle, selecting all nodes within it
- Full multi-select capabilities: selected nodes can be moved together, deleted together (Delete key)
- Scroll to pan (no hand-tool drag panning)
- Custom cursor: dark filled pointer arrow with white stroke/outline (matches Figma's default cursor)

## DON'T
- Don't break individual node click-to-select and drag-to-move
- Don't change zoom behavior (scroll-to-zoom stays as-is)
- Don't add a hand/grab tool or drag-to-pan

## LIKE
- Figma's default canvas interaction model (pointer-first, marquee select, scroll to pan)
- Figma's cursor styling (dark arrow with white outline)

## FOR
- Stems agent orchestration GUI users
- React Flow canvas (existing infrastructure)
- Desktop browser environment

## ENSURE
- Default cursor on canvas is the custom dark pointer (not grab hand)
- Clicking empty canvas deselects all nodes
- Click+drag on empty canvas draws a visible selection rectangle
- Nodes within the selection rectangle become selected (visual indicator)
- Multiple selected nodes can be dragged as a group
- Delete key removes all selected nodes (with existing confirmation if applicable)
- Individual node click-to-select still works
- Individual node drag-to-move still works
- Scroll pans the canvas (existing behavior preserved)
- Scroll-to-zoom still works (existing behavior preserved)

## TRUST
- [autonomous] Implementation approach and React Flow configuration
- [autonomous] CSS/cursor styling decisions
- [autonomous] Selection rectangle visual styling
- [ask] Any changes to existing node interaction handlers beyond what's needed
