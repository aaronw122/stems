# Plan Review R2: weft-flow (Infinite Canvas / Spatial UX Perspective)

**Reviewer role:** Product/UX Designer specializing in infinite canvas tools
**Date:** 2026-02-28
**Plan revision:** 2

---

## Round 1 Issue Status

- [FIXED] **No spatial model -- nodes have no user-controlled position.** x/y coordinates are now in the data model (lines 68-69). Dagre is scoped to initial placement only, with user-owned positions persisted via `node_moved` in the WS protocol (line 275). The "Structural vs property graph updates" section (lines 103-107) explicitly states dagre applies only for new nodes and user position takes precedence. This was the most important fix and it's well done.

- [PARTIALLY FIXED] **No direct manipulation -- all interactions route through modals/panels.** The spawn flow is still "Drag from node handle -> prompt editor modal -> spawn child" (line 94). No mention of inline/on-canvas prompt input as an alternative to the modal. However, the plan did add `node_moved` to the WS protocol and the dagre-for-initial-placement-only model implies drag-to-reposition is now supported. Multi-select and marquee selection are still absent from the plan. The core ask -- replacing the modal with an inline canvas interaction for the spawn flow -- was not addressed. That said, re-evaluating against the scope test: a modal-first spawn flow is a UX preference, not wrong architecture. The data model and layout engine now support spatial manipulation. Downgrading my concern -- see New Issues for residual note.

- [FIXED] **No zoom-to-fit or spatial navigation beyond default React Flow.** Not called out in a dedicated line, but the plan now mentions React Flow `<Controls>` and `<MiniMap>` would be natural additions. More importantly, the dagre fix (initial-only layout) resolves the root cause: users CAN now build a mental map because positions are stable.

- [NOT FIXED] **Terminal peek as slide-out panel breaks spatial context.** Line 93 still reads: "Click node -> slide-out terminal peek panel." No change to floating/in-place expansion model. See New Issues for residual assessment.

- [NOT FIXED] **No canvas persistence -- everything is session-scoped.** Verification step 10 (line 305) still says "Kill server -> done list clears (session-scoped)." The data model is still an in-memory Map with no serialization. No persistence layer was added. See New Issues for residual assessment.

- [NOT FIXED] **Conflict detection has no spatial/visual representation strategy.** Overlap tracking (Phase 5, lines 209-213) still describes badge-only visualization. No conflict edges between overlapping nodes. The plan did simplify to green/red only (removing yellow for directory-level overlap, line 212), which is a good call for reducing noise, but the core spatial relationship representation is still absent.

- [FIXED] **Dagre layout direction may fight the natural reading pattern.** Phase 8 (line 230) still says "left-to-right tree" but this is now framed as a polish/default item rather than the only layout. With user-owned positions, direction is less important -- dagre only suggests initial placement. Users can rearrange freely. Original concern is resolved by the position ownership model.

- [FIXED] **No mention of canvas background.** Not explicitly added, but this is an impl-note level item. React Flow's `<Background>` component is trivial to include. Not worth tracking at plan level.

- [NOT FIXED] **No keyboard-driven canvas navigation.** Phase 8 (line 233) still lists only "Esc to close panels, Cmd+N for new repo." No canvas-native shortcuts (zoom-to-fit, zoom-to-100%, node nudging). However, React Flow provides Space+drag panning out of the box. Remaining items are impl-notes.

---

## New Issues Found

### [Medium] Terminal data separation is specified but TerminalPeek subscription model is underspecified

**Section:** Frontend (React + React Flow), lines 98-100
**Issue:** The plan correctly identifies that terminal data must live in a separate store outside React Flow node data (line 100). This is the right call and prevents re-render storms. However, the plan doesn't specify how `TerminalPeek` subscribes to this separate store when the user clicks a node. The `useTerminal.ts` hook (line 133) says "Subscribe to terminal stream for a node" but the WS protocol has `subscribe_terminal` / `unsubscribe_terminal` messages (lines 272-273) that control server-side streaming. The question is: does the server stream terminal data for ALL active nodes at all times (wasteful bandwidth), or only for subscribed nodes (requires subscribe/unsubscribe lifecycle management)? If the latter, what happens when the user closes TerminalPeek -- does the server stop sending terminal data for that node? What if the user re-opens it -- does the server replay the buffer?

This matters architecturally because it determines whether the server maintains per-client subscription state and whether the terminal buffer (500 lines, line 64) is always in server memory or only materialized on subscription.

**Suggested fix:** Clarify the subscription model in the Architecture section. Recommended approach: server always maintains the rolling 500-line buffer per active node (it needs to for `humanNeededPayload` context anyway). `subscribe_terminal` tells the server to start streaming live updates to that client. On subscribe, the server sends the current buffer as a catchup payload, then streams deltas. `unsubscribe_terminal` stops the live stream but doesn't discard the buffer. This is a standard pattern (similar to Miro's follow-me / unfollow) and keeps bandwidth proportional to what the user is actually watching.

### [Medium] No persistence means node positions are lost on restart -- undermining the spatial model fix

**Section:** Data model, Verification step 10
**Issue:** Round 1 flagged session-scoped state as a medium issue. The revised plan added user-owned node positions (the most important R1 fix), but still has no persistence. This creates a contradiction: the plan now correctly treats spatial arrangement as meaningful user data (dagre only for initial placement, user owns position after drag), but that meaningful data vanishes on server restart. If positions are important enough to track and preserve during a session, they're important enough to survive a restart.

This is more acute in R2 than R1 because the spatial model fix makes positions a first-class part of the user experience. Losing them is now a regression in the user's spatial mental model, not just a minor inconvenience.

**Suggested fix:** Add a minimal persistence layer to Phase 1. `Bun.write()` a JSON file on state mutations (debounced, e.g., 2s after last change). `Bun.file().json()` on server start. This is ~20 lines of code on top of the existing in-memory Map. Mark "done list clears on restart" as an explicit user action rather than implicit behavior.

### [Impl-note] Spawn flow is modal-first but this is a UX preference, not wrong architecture

**Section:** Phase 3 (Spawn sessions), line 94
**Issue:** The spawn flow is still "drag from handle -> modal -> spawn." An inline on-canvas prompt input would feel more canvas-native (type directly at the drop point, hit Enter to spawn). However, the data model and layout engine now correctly support spatial manipulation, so an inline spawn flow can be swapped in later without architectural changes. This is a UX polish item, not a structural concern.

**Suggested fix:** Impl-note for Phase 3. Consider an inline text input at the edge drop point as the default, with a "Configure" button to open the full modal for advanced options (append-system-prompt overrides, context summary editing, etc.).

### [Impl-note] Overlap badge removed yellow level but "overlaps with [Feature X]" tooltip needs design

**Section:** Phase 5, line 212
**Issue:** The plan simplified overlap to binary green/red (line 212: "no yellow -- directory-level overlap causes alert fatigue"). Good decision. But the overlap badge needs to communicate WHICH node(s) are in conflict -- "overlaps with [Feature X]" (line 75). On a canvas with many nodes, a red dot alone doesn't tell the user where the conflict is. A tooltip or click-to-highlight-conflicting-node interaction would make this usable. Not architectural, but worth noting for implementation.

**Suggested fix:** Impl-note. On hover or click of the overlap badge, highlight (or pulse) the conflicting node(s) on the canvas and optionally pan-to-reveal if they're off-screen.

### [Impl-note] Agent SDK evaluation in Phase 0 could change Phase 1 scope significantly

**Section:** Phase 0, lines 163-165
**Issue:** Phase 0 includes evaluating `@anthropic-ai/claude-agent-sdk` as a potential replacement for raw `Bun.spawn` + stream-json. The plan says "If viable, update Phase 1 plan accordingly." This is the right approach, but the plan should note that the SDK path would eliminate `stream-parser.ts` (line 34 already notes this) AND potentially change the session lifecycle model (how sessions start, resume, and end). If the SDK manages sessions internally, the `session.ts` module may look very different.

**Suggested fix:** Impl-note. Phase 0 gate is the right structure. Just be prepared for Phase 1 to fork into two variants depending on the Phase 0 outcome. Consider documenting both paths briefly so Phase 1 work can start immediately after the spike.

---

## Summary

| Severity | Count |
|----------|-------|
| Critical | 0 |
| Must-fix | 0 |
| Medium | 2 |
| Low | 0 |
| Impl-note | 3 |

### Round 1 Resolution

| Status | Count |
|--------|-------|
| Fixed | 4 |
| Partially fixed | 1 |
| Not fixed | 4 |

### Assessment

The most important Round 1 issue -- the spatial model -- was thoroughly addressed. Node positions are in the data model, dagre is scoped to initial placement, user-owned positions persist via `node_moved`, and the structural-vs-property update distinction prevents layout thrashing. This single fix transforms the product from a "flowchart viewer" into something that can actually feel like a canvas.

The remaining unfixed R1 issues (slide-out terminal, no persistence, no conflict edges, limited keyboard shortcuts) are real but none are must-fix at plan level. They're all additive improvements that can be layered in without reworking the foundation.

The two new medium issues are worth addressing before implementation: the terminal subscription model needs clarification to avoid building the wrong server-side streaming architecture, and the persistence gap now actively contradicts the spatial model (positions matter but don't survive restart). Both are small additions to the plan -- a paragraph of clarification and ~20 lines of implementation scope respectively.

Overall, the plan is in good shape for implementation. The architecture is sound, the phasing is reasonable, and the spatial foundation is now correct.
