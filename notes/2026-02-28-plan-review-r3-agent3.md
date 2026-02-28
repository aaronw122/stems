# Plan Review R3 (Final): weft-flow — Senior Systems Architect Perspective

**Reviewer:** Agent 3 (Senior Systems Architect — state management, data layers, event systems)
**Date:** 2026-02-28
**Plan version reviewed:** `/Users/aaron/weft-flow/plan.md` (revision 3)

---

## R2 Issue Resolution

### [FIXED] `primaryState` and `processState` overlap creates ambiguous state model (was Must-fix)

Collapsed into a single `nodeState` field: `idle | running | needs-human | completed | crashed`. `displayStage` remains as a separate heuristic layer on top of `running`. This is exactly the right design. Clean state machine, single source of truth, no synchronization bugs.

### [FIXED] In-memory state — orphaned process cleanup (was Medium)

Phase 1 now includes PID file tracking, stale PID cleanup on startup, and SIGTERM/SIGINT handlers. This addresses the dangerous failure mode (zombie `--dangerously-skip-permissions` processes). Full state persistence remains deferred — acceptable for v1.

### [NOT FIXED, demoting to Impl-note] Phase 0 gate does not specify plan changes if Agent SDK is adopted (was Medium)

Still no "if SDK" alternative path. But Phase 0 is a time-boxed spike with a hard gate — the implementer will naturally adapt the plan based on findings. Not worth blocking on.

### [NOT FIXED, demoting to Impl-note] `--append-system-prompt` not validated in Phase 0 (was Medium)

Phase 3 still assumes this flag works with stream-json mode. Will be caught during Phase 0 spike work or early Phase 3. Fallback (inject as first user message) is obvious.

### [NOT FIXED, demoting to Impl-note] WS reconnection semantics unspecified (was Medium)

Protocol still doesn't specify when `full_state` is sent or how terminal subscriptions restore after reconnect. This won't cause architectural rework — it's a standard reconnection pattern the implementer will handle.

### [NOT FIXED, demoting to Impl-note] Terminal buffer content format (was Low)

Lines in `Map<nodeId, string[]>` still unspecified as raw JSON vs rendered text. The data flow architecture (separate store, outside React Flow) is correct. The rendering detail will resolve itself during Phase 3 implementation.

### [NOT ADDRESSED] Subtask-to-parent result flow (was Low)

Not added to Future Enhancements. Fine for v1 — user can manually relay results.

---

## New Critical/Must-fix Issues

None.

---

## Assessment

Plan is clean from an architecture perspective. The must-fix from R2 (dual state model) is resolved with a textbook-correct single state machine. Orphaned process cleanup closes the most dangerous operational gap. The remaining unresolved items are all implementation details that won't cause rework — they'll resolve naturally during development.

Ready for implementation.
