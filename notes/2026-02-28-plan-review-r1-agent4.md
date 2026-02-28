# Plan Review: Frontend Performance / Canvas Rendering
**Reviewer perspective:** Frontend Performance Engineer (Canvas/WebGL)
**Date:** 2026-02-28
**Plan file:** `/Users/aaron/weft-flow/plan.md`

---

## Executive Assessment

This plan uses React Flow for its graph visualization layer. For the stated use case -- an agent orchestration GUI showing repos, features, and subtasks as a DAG -- this is a reasonable architectural choice. React Flow renders nodes as actual DOM elements (React components) positioned on an SVG/HTML canvas with a zoom/pan layer, and edges as SVG paths. The critical question is whether this rendering approach holds up at the realistic scale this tool will reach.

The good news: the practical node count for this application is modest. Even an aggressive multi-repo, multi-agent session is unlikely to exceed 50-100 visible nodes simultaneously. React Flow handles this comfortably -- its performance issues only emerge at 1,000+ nodes, which this application will never approach. The plan's choice of React Flow is well-suited to the problem.

The concerns I have are not about hitting Canvas/WebGL rendering walls. They center on the interaction between real-time streaming data, React rendering cycles, and how the plan handles (or doesn't handle) high-frequency state updates flowing through the WebSocket into React Flow's node data.

---

## Issues

### [Must-fix] High-frequency terminal streaming will cause React Flow re-renders
**Section:** Architecture > Frontend, Phase 3 (terminal peek), hooks/useGraph.ts
**Issue:** The plan routes terminal output through WebSocket messages (`terminal_data`) and stores a rolling buffer of ~500 lines per node (`terminalBuffer` on the node data model). If this buffer lives inside the React Flow node data, every chunk of terminal output from any active Claude session triggers a React Flow node data update, which triggers React Flow's internal diffing and potential re-render of the entire graph. With 5-10 active sessions streaming simultaneously, this means dozens of React Flow re-renders per second, none of which actually change the visual graph -- they only update terminal text that may not even be visible.

This is the single most impactful performance issue in the plan. React Flow is fast for graph mutations (add/remove/reposition nodes) but is not designed as a high-frequency data streaming layer. Pumping terminal bytes through its node data model will cause frame drops during pan/zoom interactions.

**Suggested fix:** Separate terminal data from React Flow node state entirely. The plan already has `useTerminal.ts` as a separate hook -- lean into that separation architecturally. Terminal buffers should live in their own store (a simple Map outside React Flow, or a dedicated Zustand slice) and only the `TerminalPeek` component should subscribe to them. React Flow node data should only contain graph-structural and visual properties: stage, title, needsHuman, conflict status, PR info. Terminal data flows through a parallel channel that never touches React Flow's reconciliation. The `subscribe_terminal` / `unsubscribe_terminal` messages already imply this separation -- make it explicit in the data architecture so it doesn't get implemented as "just another field on the node."

### [Must-fix] No mention of React rendering optimization for streaming state updates
**Section:** Architecture > Frontend, hooks/useGraph.ts
**Issue:** Even with terminal data separated out, the plan has multiple high-frequency update sources flowing into node state: stage changes, conflict status updates, PR polling results, human-needed detection, and auto-title extraction. The plan describes `useGraph.ts` as "server state -> React Flow nodes/edges with dagre layout." If every `node_updated` WebSocket message triggers a dagre re-layout, performance will degrade noticeably -- dagre layout computation is O(V+E) and intended to run once or on structural changes, not on every property update.

**Suggested fix:** Add explicit architectural separation in the plan between structural graph changes (node added/removed, edges changed) and property updates (stage changed, title changed, conflict status changed). Only structural changes should trigger dagre re-layout. Property updates should use React Flow's `setNodes` with a functional updater that patches individual node data without recomputing layout. This distinction should be documented in the `useGraph.ts` description. Consider: "useGraph.ts -- structural changes trigger dagre layout; property updates patch node data in-place without re-layout."

### [Medium] Dagre layout in Phase 9 should be Phase 2
**Section:** Phase 9 (Polish) vs Phase 2 (React Flow canvas)
**Issue:** The plan defers dagre auto-layout to Phase 9 (Polish), but Phase 2 already introduces the React Flow canvas with nodes. Without dagre or any layout algorithm, where do nodes go? React Flow requires explicit x/y positions. If Phase 2-8 run without layout, either (a) all nodes stack at 0,0, or (b) someone implements manual positioning that gets thrown away when dagre arrives in Phase 9. Layout is foundational to the graph being usable at all -- it's not polish.

The plan already mentions dagre in Phase 2's `useGraph.ts` description ("server state -> React Flow nodes/edges with dagre layout"), contradicting its placement in Phase 9. This should be resolved.

**Suggested fix:** Move dagre layout to Phase 2 where it's already implicitly referenced. The Phase 9 item should be "layout refinements" (animation, incremental layout, manual position overrides), not the initial layout algorithm.

### [Medium] ANSI rendering in `<pre>` tags -- DOM cost at 500 lines with rapid updates
**Section:** Phase 3 (TerminalPeek.tsx), Data Model (terminalBuffer)
**Issue:** The plan specifies ANSI-rendered text in a `<pre>` element with `ansi-to-html` conversion, buffering ~500 lines. ANSI-to-HTML converters produce heavily nested `<span>` elements with inline styles -- a 500-line terminal buffer with color codes can easily produce 2,000-5,000 DOM nodes. Combined with auto-scroll and streaming updates (new lines arriving multiple times per second), this means frequent large DOM mutations in the peek panel.

This won't cause architectural rework, but it will cause visible jank in the terminal peek panel during heavy output. At plan level, the choice of approach matters because it determines whether you need virtualization.

**Suggested fix:** Note in the TerminalPeek plan that the terminal rendering should use either: (a) a virtualized list that only renders visible lines (react-window or similar), or (b) a canvas-based terminal renderer like xterm.js which is specifically optimized for this use case and handles ANSI natively without DOM bloat. xterm.js is the stronger choice -- it renders to canvas, handles streaming input natively, and solves the auto-scroll problem. This is worth deciding at plan level because xterm.js has a different integration pattern than a `<pre>` tag.

### [Medium] No throttling/batching strategy for WebSocket messages
**Section:** Architecture > Server (WebSocket), hooks/useWebSocket.ts
**Issue:** The plan describes WebSocket topics (`graph` for state changes, `terminal:{nodeId}` for output) but doesn't mention any batching or throttling strategy. With multiple active Claude sessions, the server could emit hundreds of WebSocket messages per second. Each message hitting the React app triggers state updates and potential re-renders. Without batching, the browser's main thread gets saturated processing individual messages instead of rendering frames.

**Suggested fix:** Add a note to the WebSocket architecture that graph state updates should be batched on a frame-aligned interval (requestAnimationFrame or 16ms throttle). Terminal data can stream unbatched since it's isolated from React Flow (per the first issue's fix), but graph property updates (stage, conflict, PR status) should be coalesced so that multiple updates arriving within the same frame are applied as a single React state transition. This is a one-line architectural decision that prevents a class of performance issues.

### [Low] React Flow `colorMode="dark"` may conflict with custom node styling
**Section:** Phase 9 (Polish)
**Issue:** The plan mentions `React Flow colorMode="dark"` for dark mode. React Flow's built-in dark mode applies to its chrome (controls, minimap, background) but custom node components use whatever styles you give them. If custom nodes use Tailwind dark mode classes, the two systems need to be synchronized. This is minor but worth a note so dark mode doesn't require debugging mismatched themes.

**Suggested fix:** Add a note that custom node components should use Tailwind's `dark:` variants and that React Flow's `colorMode` should be driven by the same dark mode state (e.g., a class on `<html>` or a context provider).

### [Impl-note] Rolling terminal buffer size (500 lines) needs empirical tuning
**Section:** Data Model (terminalBuffer)
**Issue:** 500 lines is a reasonable starting point but may need adjustment. Claude Code sessions can produce very long output (especially during file reads or test runs). Too small and users lose context; too large and memory grows with each active session. The right number depends on typical session output volume and available memory.

**Suggested fix:** No plan change needed. During implementation, make the buffer size configurable and observe real-world memory pressure with multiple active sessions.

### [Impl-note] React Flow minimap performance with streaming node property changes
**Section:** Phase 9 (Polish)
**Issue:** If a minimap is added (common React Flow feature, not explicitly mentioned but likely), it re-renders on every node change. With the streaming update pattern, this could cause the minimap to be a hidden performance drain.

**Suggested fix:** No plan change needed. During implementation, if a minimap is added, ensure it uses a throttled render cycle independent of node property updates.

### [Impl-note] `gh` polling interval for PR status
**Section:** Phase 6 (PR tracking)
**Issue:** 30-second polling interval for `gh` CLI PR status checks is fine. Just noting that each `gh` call spawns a subprocess, so with many tracked PRs the polling becomes a minor resource concern. At realistic scale (5-20 PRs) this is negligible.

**Suggested fix:** No plan change needed. Implementation should use a single sequential polling loop rather than parallel `gh` calls.

---

## Summary

| Severity | Count |
|----------|-------|
| Critical | 0 |
| Must-fix | 2 |
| Medium | 3 |
| Low | 1 |
| Impl-note | 3 |
| **Total** | **9** |

## Overall Verdict

The rendering architecture is appropriate for the scale. React Flow over DOM is the right call here -- the node count will stay well within DOM rendering budgets, and the custom node component flexibility is worth more than raw Canvas performance at this scale. The two must-fix issues both concern the same core problem: the plan doesn't clearly separate high-frequency streaming data (terminal output, rapid state updates) from the React Flow graph rendering pipeline. Without that separation, every terminal chunk from every active session will ripple through React Flow's reconciliation, causing frame drops during pan/zoom. The fix is architectural (separate data channels for terminal vs. graph state, batch graph updates on frame boundaries) and should be specified in the plan before implementation begins. Everything else is tractable at implementation time.
