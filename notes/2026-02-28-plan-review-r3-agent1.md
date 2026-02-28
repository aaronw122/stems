# Plan Review R3 (Final): weft-flow (Infinite Canvas / Spatial UX Perspective)

**Reviewer role:** Product/UX Designer specializing in infinite canvas tools
**Date:** 2026-02-28
**Plan revision:** 3

---

## Round 2 Issue Status

- **[Medium] Terminal subscription model underspecified** -- Not explicitly clarified in revision 3. However, applying the final-round scope test: the WS protocol already has `subscribe_terminal` / `unsubscribe_terminal`, the server already buffers 500 lines per node, and the topic pattern `terminal:{nodeId}` implies per-node streaming. The subscribe-sends-catchup-then-stream-deltas pattern is standard and an implementer would arrive at it naturally. No rework risk. **Downgrading to impl-note.**

- **[Medium] No persistence means node positions lost on restart** -- Not addressed; state is still session-scoped. However, applying the scope test: the in-memory Map is the correct intermediate data structure regardless of whether persistence is added. `Bun.write()` to a JSON file is purely additive (~20 lines) and can be layered onto any phase without reworking the data model or server architecture. No rework risk. **Downgrading to impl-note.**

---

## New Critical/Must-fix Issues

None.

---

## Summary

Plan is clean from UX/canvas perspective. The spatial model is sound (user-owned positions, dagre for initial placement only, structural vs property update separation). The data flow architecture (terminal data outside React Flow state) prevents the most common canvas performance pitfall. Phase gating on the CLI conversation model (Phase 0) protects against the biggest technical unknown.

The two unresolved R2 medium issues are real but fail the rework test -- both are additive improvements that slot in without architectural changes. They are worth remembering during implementation but do not warrant blocking the plan.

No further review rounds needed.
