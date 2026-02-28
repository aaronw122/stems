# Plan Review: weft-flow (Infinite Canvas / Spatial UX Perspective)

**Reviewer role:** Product/UX Designer specializing in infinite canvas tools
**Date:** 2026-02-28
**Plan reviewed:** `/Users/aaron/weft-flow/plan.md`

---

## Overall Assessment

The plan describes a solid orchestration GUI built on React Flow. The data model (Workspace > Repo > Feature > Subtask), the streaming architecture, and the phased delivery are well-structured for what this product actually is: a **DAG-based process manager with terminal peek**.

However, the plan claims to be "an infinite canvas similar to Figma," and the interaction model described is far from that. What's actually specified is closer to an auto-laid-out directed graph with panels -- more Miro board-on-rails than Figma canvas. That gap matters because it determines whether the spatial affordances are designed in from the start or bolted on later (at which point they never feel right). The issues below focus on where the plan either misses canvas-native interaction patterns entirely or makes architectural choices that will fight against canvas feel later.

---

## Issues

### [Must-fix] No spatial model -- nodes have no user-controlled position
**Section:** Data model, Phase 2 (React Flow canvas), Phase 9 (Polish)
**Issue:** The data model tracks stage, conflict status, PR state, terminal buffer, and title for each node -- but **no x/y position or size**. Phase 9 mentions "Dagre auto-layout" as a polish item, which implies nodes are always algorithmically placed. In every real canvas tool (Figma, Miro, tldraw), the user's spatial arrangement IS the information architecture. If nodes are always auto-laid-out by dagre, you've built a flowchart viewer, not a canvas. Users cannot cluster related nodes, create spatial regions, or maintain a mental map -- because every graph mutation reshuffles positions.

This is architectural: if positions aren't part of the data model from Phase 1, everything downstream (persistence, layout, multi-user state) has to be retrofitted.

**Suggested fix:** Add `x: number, y: number` (and optionally `width`, `height`) to `WeftNode` in `shared/types.ts` from Phase 1. Dagre should only apply for initial placement of new nodes (give them a sensible default position), not continuously re-layout the entire graph. Once a node is placed, the user owns its position. Add `node_moved` to the WS protocol so position changes persist on the server.

### [Must-fix] No direct manipulation -- all interactions route through modals/panels
**Section:** Phase 3 (Spawn sessions), Phase 2 (React Flow canvas)
**Issue:** The primary interaction for creating child nodes is: "Drag from node handle -> prompt editor modal -> spawn child." Every creative canvas tool treats direct manipulation (drag, drop, connect, resize) as the primary interaction and modals/dialogs as escape hatches for complex configuration. The described flow breaks canvas feel because:

1. Opening a modal pulls focus away from the spatial context.
2. There's no "draw a connection then configure" pattern -- the connection and configuration are fused into one modal step.
3. There's no way to rearrange, group, or directly manipulate the graph spatially.

The plan also has no mention of: multi-select, box selection (marquee), drag-to-reorder, or any standard canvas selection mechanics. These are foundational to canvas feel.

**Suggested fix:** Phase 2 should include basic selection mechanics (click-select, shift-click multi-select, marquee box select) and drag-to-move. The spawn flow in Phase 3 should work as: drag from handle to create a pending edge -> drop on empty canvas -> inline prompt input appears on-canvas (not a modal) -> submit to spawn. Modal should be the fallback for advanced configuration, not the default path. Add `selection` and `node_moved` to the WS protocol.

### [Medium] No zoom-to-fit or spatial navigation beyond default React Flow
**Section:** Phase 2, Phase 9
**Issue:** The plan mentions React Flow but never specifies zoom/pan behavior, minimap, zoom-to-fit, or focus-on-node navigation. For a tool managing multiple repos with branching feature trees, the graph will quickly exceed the viewport. Canvas tools solve this with: minimap overlay, zoom-to-fit button, focus-on-node (double-click or search), and spatial bookmarks. React Flow provides minimap and controls as opt-in components but they need to be planned for.

With auto-layout (dagre) continuously applied, this problem is even worse -- the user can't build a mental map of "where things are" because positions shift on every mutation.

**Suggested fix:** Add to Phase 2: React Flow `<MiniMap>` component, `<Controls>` component (zoom in/out/fit), and a "focus on node" action (e.g., clicking a node in the done list or a search result zooms/pans to it). These are trivial to add with React Flow but need to be in the plan so the layout accounts for them.

### [Medium] Terminal peek as slide-out panel breaks spatial context
**Section:** Phase 3 (TerminalPeek)
**Issue:** "Click node -> slide-out terminal peek panel" is a sidebar pattern, not a canvas pattern. When you click a node and a panel slides in from the side, the canvas shifts/resizes to accommodate it, breaking the user's spatial frame of reference. In Figma, inspecting an element doesn't displace the canvas -- it overlays or docks in a fixed region.

More importantly, if I'm watching 3-4 agents run in parallel, I want to glance at multiple terminal outputs simultaneously. A single slide-out panel means constant click-to-switch context.

**Suggested fix:** Consider an expandable node pattern: clicking a node expands it in-place on the canvas to show a terminal preview (first ~20 lines). A full terminal view could open as a floating panel (draggable, resizable, stays on-canvas) rather than a page-level sidebar. This lets users position multiple terminal views spatially and see them simultaneously. Alternatively, support pinning multiple terminal panels side by side.

### [Medium] No canvas persistence -- everything is session-scoped
**Section:** Data model, Phase 6 (Done list), Verification step 10
**Issue:** "Kill server -> done list clears (session-scoped)" and the data model is an in-memory Map. This means spatial arrangements, node positions (if added), graph state, and the entire workspace vanish on restart. For a tool that manages multi-day feature work across repos, session-scoped state means the user rebuilds their spatial workspace every time they restart the server. This fundamentally undermines the canvas metaphor -- a canvas you can't come back to isn't a canvas, it's a whiteboard someone erases every night.

This is architectural because it affects the state layer design from Phase 1. An in-memory Map with no serialization is a deliberate choice that will require significant rework to change later.

**Suggested fix:** Add a simple file-based persistence layer (JSON file on disk) starting from Phase 1. State writes on mutation (debounced), state reads on server start. Doesn't need to be a database -- `Bun.write()` to a `.weft-flow/state.json` is sufficient. Mark the done-list-clears behavior as an explicit user action ("Clear completed") rather than an implicit server restart side effect.

### [Medium] Conflict detection has no spatial/visual representation strategy
**Section:** Phase 5 (Conflict tracking)
**Issue:** The plan describes conflict detection (green/yellow/red badges) and context injection into spawned sessions. But the visual representation is just a badge on the node. In a canvas context, conflicts are spatial relationships -- if two nodes are editing the same files, the user should see that relationship, not just independent colored dots. Canvas tools represent relationships as visible connections (edges, proximity indicators, shared highlighting).

**Suggested fix:** When a conflict is detected between two nodes, add a visual edge/connection between them (dashed red line, for example) in addition to the badge on each node. This makes conflicts spatially discoverable rather than requiring the user to mentally correlate badges across a large graph.

### [Low] Dagre layout direction may fight the natural reading pattern
**Section:** Phase 9 (Dagre auto-layout, left-to-right tree)
**Issue:** "Left-to-right tree matching the sketch" -- this is a reasonable default for DAG visualization, but for a workspace where the primary hierarchy is Repo > Feature > Subtask, top-to-bottom often feels more natural (repos at the top, work flowing downward). Left-to-right works well for process flows but can feel cramped when nodes have varying widths (long titles, badges, etc.).

**Suggested fix:** Make layout direction configurable (LR vs TB) or test both during Phase 2 before committing. This is easy to change in dagre config but harder to change after the node components are designed around one orientation.

### [Low] No mention of canvas background (grid, dots, or plain)
**Section:** Phase 2 (React Flow canvas)
**Issue:** Every infinite canvas tool has a visible background pattern (dots, grid, cross-hatch) that provides spatial grounding -- the user can perceive zoom level and position relative to the background. React Flow supports `<Background>` as an opt-in component. Without it, the canvas feels like a blank void with no spatial anchoring.

**Suggested fix:** Add React Flow `<Background>` component (dots variant is standard) to Phase 2 canvas setup. Trivial to add, easy to forget.

### [Low] No keyboard-driven canvas navigation
**Section:** Phase 9 (Keyboard shortcuts)
**Issue:** Phase 9 mentions "Esc to close panels, Cmd+N for new repo" but no canvas-native shortcuts: Space+drag for pan (standard in Figma/Miro), Cmd+0 for zoom-to-fit, Cmd+1 for zoom to 100%, arrow keys to nudge selected nodes. These are muscle memory for anyone who uses canvas tools and their absence makes the tool feel like a web app with a graph in it rather than a canvas tool.

**Suggested fix:** Add canvas keyboard shortcuts to Phase 9 list. React Flow handles Space+drag panning natively, but the zoom shortcuts and node nudging need explicit wiring.

### [Impl-note] ANSI rendering in terminal peek
**Section:** Phase 3 (TerminalPeek)
**Issue:** "ANSI-rendered text in `<pre>`" using `ansi-to-html` -- ANSI rendering has many edge cases (cursor movement, color nesting, wide characters). This will need iteration during implementation but isn't an architectural concern.
**Suggested fix:** Log for implementation. Consider `xterm.js` if ANSI fidelity becomes important (it handles all escape sequences properly), but `ansi-to-html` is a fine starting point.

### [Impl-note] Stream-json idle timeout of 120s for "stuck" detection
**Section:** Human-needed detection
**Issue:** 120 seconds may be too aggressive -- Claude Code regularly pauses for extended thinking, large file reads, or slow network operations. Tuning this value will require real-world testing.
**Suggested fix:** Implementation-level tuning. Start with 120s, adjust based on observed false positive rate.

### [Impl-note] Context summarization quality and latency
**Section:** Phase 7 (Context summarization)
**Issue:** Spawning `claude -p` to summarize a parent's terminal buffer adds latency to child creation and the summary quality depends heavily on the prompt and buffer content. This needs experimentation during implementation.
**Suggested fix:** Implementation-level. Try it, iterate on the summarization prompt.

### [Impl-note] React Flow performance with many nodes
**Section:** Phase 2
**Issue:** React Flow handles ~100-200 nodes well but can degrade with complex custom nodes, frequent re-renders from WebSocket state updates, and large terminal buffers being passed through React state. Performance profiling during implementation will determine if virtualization or throttling is needed.
**Suggested fix:** Implementation-level. React Flow's built-in virtualization (only rendering visible nodes) helps, but WebSocket-driven state updates need throttling if they trigger full graph re-renders.

---

## Summary

| Severity | Count |
|----------|-------|
| Critical | 0 |
| Must-fix | 2 |
| Medium | 4 |
| Low | 3 |
| Impl-note | 4 |

### Key Takeaway

The plan builds a strong orchestration backend and a functional DAG viewer, but it does not deliver on the "infinite canvas similar to Figma" framing. The two must-fix issues (no spatial model for node positions, no direct manipulation) are the core gap. Without user-owned positions and direct manipulation, this will feel like a dashboard with a graph widget, not a canvas tool. These need to be designed into the data model and interaction layer from Phase 1-2, not layered on as polish.

The medium issues (no navigation aids, sidebar terminal peek, session-scoped state, spatial conflict visualization) all compound the same theme: the plan treats the canvas as a display surface for algorithmic layout rather than as a user-controlled spatial workspace. Fixing the must-fix issues will naturally pull most of the medium issues along with them.

The good news: React Flow already supports all of this (draggable nodes, minimap, background, controls, custom edges). The framework choice is right. The plan just needs to lean into what the framework offers rather than constraining it to auto-layout-only mode.
