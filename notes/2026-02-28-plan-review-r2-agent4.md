# Plan Review R2: Frontend Performance / Canvas Rendering
**Reviewer perspective:** Frontend Performance Engineer (Canvas/WebGL)
**Date:** 2026-02-28
**Plan file:** `/Users/aaron/weft-flow/plan.md` (revision 2)

---

## Round 1 Issue Status

- [FIXED] **High-frequency terminal streaming will cause React Flow re-renders** — The plan now includes a dedicated "Data flow separation (critical for performance)" section (lines 98-107) that explicitly states terminal data must live in a separate store outside React Flow node data, with `TerminalPeek` subscribing directly. This is exactly what was needed. However, see "Residual contradiction" in New Issues below — `terminalBuffer` still appears in the node data model.

- [FIXED] **No mention of React rendering optimization for streaming state updates** — The plan now includes a "Structural vs property graph updates" section that distinguishes structural changes (trigger dagre re-layout for new nodes only) from property updates (patch in-place, no re-layout). Frame-aligned batching via `requestAnimationFrame` or 16ms throttle is explicitly called out. This is a clean fix.

- [NOT FIXED] **Dagre layout in Phase 8 (was Phase 9) should be Phase 2** — Dagre auto-layout still lives in Phase 8 (Polish), line 230. Meanwhile Phase 2's `useGraph.ts` description (line 180) says "server state -> React Flow nodes/edges with dagre layout," and the new "Structural vs property graph updates" section (line 104) describes dagre behavior for initial placement. The plan now has three places that assume dagre exists during the core phases, but the actual implementation is deferred to Phase 8. This contradiction is worse than in Round 1 because the new structural/property separation section makes dagre's early availability even more load-bearing. Nodes need positions from Phase 2 onward.

- [FIXED] **ANSI rendering in `<pre>` tags — DOM cost at 500 lines** — Not directly addressed with xterm.js or virtualization, but the terminal data separation fix significantly reduces the blast radius of this issue. Terminal rendering jank is now isolated to the peek panel and cannot affect the graph. The core concern (DOM cost during rapid updates) remains an implementation-time decision, which is appropriate. Downgrading this from Medium to Impl-note given the isolation.

- [FIXED] **No throttling/batching strategy for WebSocket messages** — Line 106 adds frame-aligned batching for property updates. This addresses the concern directly.

- [NOT FIXED] **React Flow `colorMode="dark"` may conflict with custom node styling** — No change, still just "Dark mode (Tailwind + React Flow `colorMode="dark"`)" in Phase 8. This was Low severity and remains so — acceptable to leave as-is for a v1 plan.

---

## New Issues Found

### [Must-fix] `terminalBuffer` still listed in node data model despite separation mandate

**Section:** Data Model (line 64) vs "Data flow separation" section (lines 98-100)
**Issue:** The data model section lists `terminalBuffer: rolling last ~500 lines of output` as a field that "each node tracks" (line 64). The performance section added in revision 2 explicitly says "Terminal data (buffers, streaming output) must live in a **separate store** outside React Flow node data" (line 100). These two sections directly contradict each other. An implementer reading the data model top-down will put the terminal buffer on the node object, then hit the performance section and have to refactor. More importantly, the `shared/types.ts` file will encode whichever version is implemented first, and the "wrong" choice propagates through the entire codebase.

**Suggested fix:** Remove `terminalBuffer` from the node data model list (line 64) and add a separate "Terminal data (separate from node state)" subsection that defines the terminal buffer structure. Something like:

```
### Terminal data (separate from node state)
Stored in a dedicated Map<nodeId, string[]>, not on WeftNode:
- terminalBuffer: rolling last ~500 lines of output per node
- Subscribed to directly by TerminalPeek via useTerminal hook
```

This makes the separation structural in the plan document itself, not just advisory.

### [Medium] Dagre placement contradiction remains unresolved (carried from R1, escalated)

**Section:** Phase 2 (line 180), Phase 8 (line 230), Structural vs property updates (line 104)
**Issue:** This is the same issue from Round 1 but it has gotten worse. The revision added a "Structural vs property graph updates" section that describes dagre behavior in detail — "trigger dagre re-layout for newly added nodes only" (line 104), "dagre applies only for initial placement" (line 107). This section reads as core architecture that exists from Phase 1/2 onward. But dagre is still listed as a Phase 8 task. The plan now has load-bearing references to dagre in three places (Phase 2 hook description, structural updates section, node position ownership) while deferring its implementation to the second-to-last phase. What layout algorithm are Phases 2-7 using?

**Suggested fix:** Move dagre initialization to Phase 2. Phase 8 can retain "layout polish" items (animation, incremental layout for large graphs, manual override persistence) but the basic `dagre.layout()` call that computes initial node positions must exist before any node is rendered. Without it, Phase 2's test step ("open browser, add a repo, see it render as a node") has no position to render at.

### [Impl-note] Batching interval for property updates may need two tiers

**Section:** Structural vs property graph updates (line 106)
**Issue:** The plan specifies a single batching interval ("requestAnimationFrame or 16ms throttle") for all property updates. In practice, some property updates are user-visible and latency-sensitive (e.g., `needsHuman` flipping to true should show the red flash within ~100ms) while others are cosmetic (stage changes, overlap status). A single 16ms batch is probably fine for both — 16ms is fast enough for human perception — but worth noting that if the batch interval is ever increased for performance reasons (e.g., to 100ms or 200ms to reduce render frequency), `needsHuman` updates should be exempted or handled as high-priority. This is an implementation detail, not a plan issue.

**Suggested fix:** No plan change needed. Implementation note for the batching logic.

---

## Summary

| Severity | Count |
|----------|-------|
| Critical | 0 |
| Must-fix | 1 |
| Medium | 1 |
| Low | 0 |
| Impl-note | 1 |
| **Total** | **3** |

### Round 1 Resolution

| Status | Count |
|--------|-------|
| Fixed | 4 |
| Not fixed | 2 |
| **Total** | **6** |

(3 Impl-notes from Round 1 not re-evaluated — they were flagged as implementation-time concerns and remain valid.)

## Overall Verdict

The revision made meaningful progress on the highest-impact issues. The terminal data separation and frame-aligned batching sections are well-specified and will prevent the primary performance pitfalls I identified in Round 1. The remaining must-fix is a documentation contradiction — `terminalBuffer` appears in both the node data model (where it shouldn't be) and the separation mandate (where it should be). This is a one-line edit to resolve but it matters because `shared/types.ts` will encode the data model directly.

The dagre placement issue is the most frustrating carry-over. The revision actually made it worse by adding more dagre-dependent architecture without moving dagre earlier in the phase sequence. This will cause confusion during Phase 2 implementation at minimum, and potentially a layout refactor when dagre is finally integrated in Phase 8. Moving `dagre.layout()` to Phase 2 is the obvious fix and aligns with what the plan already describes as the intended behavior.
