# Plan Review R3 (Final): Frontend Performance / Canvas Rendering
**Reviewer perspective:** Frontend Performance Engineer (Canvas/WebGL)
**Date:** 2026-02-28
**Plan file:** `/Users/aaron/weft-flow/plan.md` (revision 3)

---

## Round 2 Issue Resolution

- [FIXED] **`terminalBuffer` in node data model contradicting separation mandate** — `terminalBuffer` has been removed from the node data model (lines 53-67). Terminal data is now described exclusively in the dedicated "Terminal data store" paragraph (lines 100-101) as `Map<nodeId, string[]>` outside React Flow state. The contradiction is resolved. `shared/types.ts` will now encode the correct separation from the start.

- [NOT FIXED, downgraded] **Dagre placement contradiction** — Dagre auto-layout is still in Phase 8 (line 231) while Phase 2's `useGraph.ts` (line 181) and the structural updates section (lines 104-107) assume it exists. However, applying the final-round scope test: this will not cause significant rework or wrong architecture. The implementer will naturally add a basic `dagre.layout()` call in Phase 2 when building `useGraph.ts` (the hook description explicitly says "with dagre layout"). Phase 8's "Dagre auto-layout (left-to-right tree matching the sketch)" reads as layout polish, not initial implementation. The ambiguity is real but the risk is low — it's a phase-ordering documentation issue, not an architectural one. **Not escalating.**

---

## New Critical/Must-fix Issues

None found.

---

## Summary

The performance-critical architecture is solid:

- **Terminal data isolation** is clean — separate store, separate WS topic, no React Flow contamination
- **Batching strategy** is specified — frame-aligned interval for property updates, structural changes handled separately
- **Node position ownership** is clear — dagre for initial placement, user-owned after drag
- **Terminal buffer cap** is defined — 500 lines rolling window per node

Plan is clean from performance perspective. Ready for implementation.
