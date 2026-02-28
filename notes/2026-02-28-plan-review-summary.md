# Plan Review Summary

**Plan:** /Users/aaron/weft-flow/plan.md
**Rounds:** 3
**Final revision:** 3

## Issues Found & Fixed

### Round 1 (4 Critical, 10 Must-fix fixed)

**Critical:**
1. Missing `-p` flag on core CLI invocation — `--input-format stream-json` requires `--print` mode
2. Multi-turn stream-json conversation model unverified — architecture depends on `claude -p` staying alive for multiple turns, which is undocumented
3. Permission model for spawned sessions undefined — no specification for `--dangerously-skip-permissions` vs. permission-approval UI
4. Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) exists and should be evaluated as replacement for raw CLI stream-json piping

**Must-fix:**
1. `send_input` WS message has no corresponding UI or specified protocol for question/permission/text payloads
2. `--add-dir` does not set working directory; `cwd` must be set on `Bun.spawn`
3. Stage detection heuristics too naive — collapsed to 3-state primary model with heuristic display layer
4. Conflict detection reactive only, renamed to "file overlap tracking" with advisory-only v1 scope
5. Context summarization moved from Phase 7 to Phase 3 (minimal: parent prompt + first assistant message)
6. Phase 8 plan viewer cut — moved to Future Enhancements
7. Node data model missing session lifecycle state (sessionId, processState, errorInfo, cost tracking)
8. No spatial model — added x/y positions to node data model, dagre for initial placement only
9. Terminal streaming separated from React Flow state — dedicated store outside node data
10. Structural vs property graph updates separated — only add/remove triggers dagre, properties patch in-place

### Round 2 (3 Must-fix fixed)
1. Collapsed dual `primaryState`/`processState` into single `nodeState` (`idle | running | needs-human | completed | crashed`)
2. Removed `terminalBuffer` from node data model — moved to separate terminal data store
3. Added orphaned process cleanup: PID tracking, stale cleanup on startup, SIGTERM/SIGINT handlers

### Round 3
No Critical or Must-fix issues found. All 4 reviewers confirmed plan is clean.

## Remaining Issues (Medium/Low — acceptable for implementation)

- Agent SDK evaluation in Phase 0 creates unresolved fork in Phase 1 (resolves at Phase 0 gate)
- `--append-system-prompt` assumed but not validated (caught by Phase 0 spike)
- In-memory state with no persistence (additive feature, no rework needed)
- Dagre placement deferred to Phase 8 but referenced earlier (implementer will naturally add in Phase 2)
- Terminal subscription model underspecified (standard pattern, implementer will arrive at it)
- WS reconnection semantics unspecified (standard reconnect pattern)
- `humanNeededType: "idle"` semantics questionable
- `--dangerously-skip-permissions` makes permission UI dead code in v1
- Terminal buffer content format ambiguous (raw JSON vs rendered text)

## Implementation Notes
- ANSI rendering may not apply if stream-json produces structured events — clarify what `terminalBuffer` contains
- `--include-partial-messages` produces high-frequency messages — batch on server (100ms coalesce)
- WS reconnect should trigger `full_state` push; client re-subscribes to terminal topics
- Context summarization adds latency to spawn — consider caching
- Dagre layout should be debounced, only on structural changes
- Terminal buffer memory: use ring buffer with line-length limits
- React Flow minimap should use throttled render independent of property updates
- `gh` polling should use single sequential loop or batched GraphQL
- Subtask-to-parent result flow unspecified — acceptable v1 limitation

## Reviewer Personas Used
1. **Product/UX Designer (Infinite Canvas Specialist)** — Interaction patterns, spatial UX, Figma/Miro mental models
2. **Cynical Senior Engineer** — Scope creep, hand-waved complexity, missing error paths, production readiness
3. **Senior Systems Architect** — State management, data persistence, event systems, API contracts
4. **Frontend Performance Engineer (Canvas/WebGL)** — Rendering strategy, frame budgets, memory management, DOM vs Canvas tradeoffs
