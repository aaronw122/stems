# Plan Review R2: weft-flow — Senior Systems Architect Perspective

**Reviewer:** Agent 3 (Senior Systems Architect — state management, data layers, event systems)
**Date:** 2026-02-28
**Plan version reviewed:** `/Users/aaron/weft-flow/plan.md` (revision 2)

---

## Round 1 Issue Status

- [FIXED] **Agent SDK exists and should replace raw CLI stream-json piping** — Plan now includes Agent SDK evaluation in Phase 0 with a gate before Phase 1. The SDK is acknowledged as a potential replacement. The plan keeps both paths open, which is the right call given Phase 0 will determine the answer. One residual concern elevated to a new issue below (what changes if the SDK is adopted).

- [FIXED] **No mechanism for sending user input back to the agent** — `send_input` now has three typed payload variants (`question_answer`, `permission`, `text_input`). Node model includes `humanNeededType` and `humanNeededPayload`. TerminalPeek specifies contextual UI (free-text for questions, approve/deny for permissions). This is well-specified.

- [FIXED] **Node data model missing session lifecycle state** — `sessionId`, `processState`, `errorInfo`, `costUsd`, and `tokenUsage` all added to the node model. This covers the gaps identified in R1.

- [FIXED] **Phase ordering creates late integration risk** — Phase 3 now includes minimal context passing (parent prompt + first assistant message via `--append-system-prompt`). Phase 7 refines this into full summarization. The hierarchical model is validated early. Good fix.

- [PARTIALLY FIXED] **Subtask context model is underspecified** — The early context passing in Phase 3 addresses the phasing issue, but the core R1 concerns remain: (1) no mechanism for subtask results to flow back to the parent session, (2) no specification for what happens when the parent continues after a subtask is spawned (context drift), (3) terminal buffer is still the input for Phase 7 summarization, which is lossy for long sessions. These are acceptable as v1 limitations if acknowledged — see new issue below.

- [PARTIALLY FIXED] **Conflict tracker is reactive, not preventive** — Directory-level yellow removed (reducing alert fatigue). Plan explicitly scopes v1 as "advisory only" with file locking deferred to future enhancements. This is an acceptable v1 scoping decision. The `Read` tracking suggestion was not adopted, which is fine — tracking reads would add complexity for marginal early-warning benefit in v1.

- [PARTIALLY FIXED] **Stage detection heuristics have gaps** — `displayStage` is now explicitly labeled as "optional heuristic display layer, approximate" with "v1 heuristics will need iteration." The `testing -> executing` loop is specified. Manual override deferred to future. The honest labeling as approximate is sufficient for v1.

- [NOT FIXED] **In-memory state with no persistence** — No persistence layer added. No orphan process cleanup on restart. No state snapshots. This remains a medium-severity gap — see below.

- [NOT FIXED] **WS protocol missing reconnection and state sync semantics** — `useWebSocket.ts` mentions "auto-reconnect" but the protocol still doesn't specify when `full_state` is sent, what it includes, or how terminal subscriptions are restored after reconnect. See below.

- [NOT FIXED] **`ansi-to-html` for terminal rendering is insufficient** — TerminalPeek still references "ANSI-rendered text in `<pre>`." No clarification on whether `terminalBuffer` contains raw ANSI output or structured events parsed from stream-json. See below.

- [PARTIALLY FIXED] **No specification for how repos are validated or tracked** — `cwd` is now correctly specified as set to repo path (important fix). But no validation spec for `add_repo` (does the path exist? is it a git repo?) and no repo node model definition. Demoting to Low given the `cwd` fix addressed the most architecturally significant part.

- [PARTIALLY FIXED] **PR tracking via stream sniffing is fragile** — `pr-tracker.ts` now says "Poll gh CLI for PR status" which adds polling. Initial detection is still stream-based but polling provides a fallback. Acceptable for v1.

- [NOT FIXED] **No consideration for concurrent server instances** — No lockfile or port-conflict handling. Demoting to Impl-note since this is a standard startup concern, not architectural.

- [ADDRESSED] **Dagre layout performance (Impl-note)** — Plan now specifies dagre applies only for initial placement of newly added nodes, and user-dragged positions are preserved. Good.

- [ADDRESSED] **Terminal buffer memory (Impl-note)** — Still ~500 lines per node, but the data flow separation section shows awareness of the performance concern. Remains impl-note.

- [NOT ADDRESSED] **WS topic design (Impl-note)** — Remains impl-note, fine.

- [NOT ADDRESSED] **Race condition in conflict detection (Impl-note)** — Remains impl-note, fine.

---

## New Issues Found

### [Must-fix] `primaryState` and `processState` overlap creates ambiguous state model

**Section:** Data model

**Issue:** The plan now has three layers of state per node:
1. `primaryState`: `active` | `needs-human` | `done`
2. `processState`: `idle` | `running` | `completed` | `crashed`
3. `displayStage`: `planning` | `executing` | `testing`

`primaryState` and `processState` overlap significantly and their relationship is undefined:
- When `processState` is `completed`, is `primaryState` `done`? Always? What if the session completed with an error?
- When `processState` is `crashed`, is `primaryState` `done` or `needs-human`? (A crash could mean "this is finished, badly" or "human needs to restart it.")
- When `processState` is `running`, `primaryState` could be `active` or `needs-human`. That makes sense. But `primaryState: active` + `processState: idle` is a contradictory state — how is it prevented?
- `done` (primaryState) vs `completed` (processState) are near-synonyms describing the same lifecycle event.

Every piece of frontend code that renders a node must choose which state to read from. Every piece of server code that updates state must keep them synchronized. This is a classic dual-source-of-truth problem that causes bugs.

**Suggested fix:** Choose one authoritative state machine. Recommended approach: make `processState` the single authoritative state, and derive `primaryState` from it:

```
processState: idle → running → completed | crashed
                ↕
              needs-human (substatus of running — process is alive but blocked)
```

Or alternatively, collapse them into a single field:
```
nodeState: idle | running | needs-human | completed | crashed
```

`displayStage` remains a separate heuristic layer on top of `running`, which is fine — it's explicitly approximate. But the two "authoritative" state fields must be merged.

### [Medium] Phase 0 gate does not specify plan changes if Agent SDK is adopted

**Section:** Phase 0, Architecture, Project structure

**Issue:** Phase 0 includes evaluating the Agent SDK with a gate ("do not proceed to Phase 1 until confirmed"). But the plan's file structure, Phase 1 tasks, and architecture section are all written assuming raw `Bun.spawn` + `stream-parser.ts`. If the SDK is adopted:
- `server/stream-parser.ts` is eliminated (noted in the Architecture callout)
- `server/session.ts` changes fundamentally (SDK manages sessions vs raw process management)
- Phase 1 tasks referencing "pipe stdout to event parser" and "parse newline-delimited JSON from Claude" become invalid
- The `processState` model changes (SDK manages session lifecycle vs PID tracking)

The plan acknowledges the SDK "eliminates `stream-parser.ts` entirely and simplifies the architecture significantly" but doesn't specify what the simplified architecture looks like.

**Suggested fix:** Add a brief "if SDK" column or section: "If the Agent SDK is adopted in Phase 0, the following changes apply: [list of affected files, changed phase tasks, removed components]." This doesn't need to be a full alternate plan — just enough that the implementer knows what to skip/change.

### [Medium] `--append-system-prompt` assumed but not validated

**Section:** Phase 3 (context passing)

**Issue:** Phase 3 specifies context injection via `--append-system-prompt`. This flag's availability and behavior with `--input-format stream-json` should be validated in Phase 0 alongside the other CLI capabilities. If it doesn't exist or doesn't work with stream-json mode, the Phase 3 context passing strategy needs a fallback (e.g., injecting context as the first user message in the stream, or using the SDK's system prompt configuration).

**Suggested fix:** Add to Phase 0: "Confirm `--append-system-prompt` works with stream-json mode. If not, plan to inject context as the first user turn in the stream."

### [Medium] In-memory state with no persistence (carried from R1)

**Section:** Architecture (Server)

**Issue:** Unchanged from R1. Server crash or restart loses all state. Orphaned Claude processes continue running with no tracking. This is the most likely cause of real frustration during daily use — it's not an edge case when the tool is being actively developed.

**Suggested fix:** Same as R1 — at minimum, add to Phase 8 (Polish):
- Periodic state dump to `weft-flow-state.json` (debounced on mutation)
- On startup: read state file, attempt to reconnect to running sessions via session IDs
- Track PIDs for orphan cleanup
- This is ~50 lines of code and prevents the worst failure mode.

### [Medium] WS reconnection semantics unspecified (carried from R1)

**Section:** WS protocol, `useWebSocket.ts`

**Issue:** Unchanged from R1. "Auto-reconnect" is listed as a feature of `useWebSocket.ts` but the protocol doesn't define the reconnection handshake. Without this, implementation will produce one of: (a) a client that reconnects but shows stale data until a state change triggers an update, or (b) a client that requests full state but loses terminal scroll position and subscription state.

**Suggested fix:** Add to WS protocol section:
- On new WS connection, server sends `full_state` automatically (node graph only, no terminal buffers)
- Client re-issues `subscribe_terminal` for any open TerminalPeek panels
- `subscribe_terminal` response includes the current buffer snapshot, then streams incremental updates

### [Low] `terminalBuffer` content format ambiguous (carried from R1)

**Section:** Data model, TerminalPeek

**Issue:** `terminalBuffer` is described as "rolling last ~500 lines of output" and TerminalPeek uses "ANSI-rendered text in `<pre>`." But if the session uses `--output-format stream-json`, stdout is structured JSON events — not ANSI terminal output. What goes into `terminalBuffer`?

Options: (a) raw stdout lines (JSON events, useless for display), (b) rendered text extracted from JSON events (assistant messages, tool outputs), (c) a hybrid (assistant text rendered cleanly, Bash tool output preserved with ANSI).

This determines what `ansi-to-html` processes and how TerminalPeek renders. The wrong assumption here means TerminalPeek either shows raw JSON or shows garbled ANSI.

**Suggested fix:** Specify: "The terminal buffer contains human-readable text assembled from stream-json events: assistant message text rendered as-is, tool use events rendered as `[Tool: name] input → output` summaries, and Bash tool output preserved with original ANSI formatting. `ansi-to-html` is applied only to Bash output segments."

### [Low] Subtask-to-parent result flow unspecified (carried from R1)

**Section:** Data model, Phase 3/7

**Issue:** When a subtask completes, how does the parent session learn about the result? The plan specifies parent-to-child context flow (via `--append-system-prompt`) but not child-to-parent. In practice, the user would need to manually read the subtask's output, then type a message to the parent session relaying the results. This is the manual coordination that weft-flow is supposed to eliminate.

This is acceptable for v1 if explicitly acknowledged as a limitation. But it should be mentioned in the Future Enhancements section since it's a natural next step.

**Suggested fix:** Add to Future Enhancements: "Subtask completion summary: when a subtask completes, auto-generate a summary and offer to inject it into the parent session as a user message."

---

## Summary

| Severity | Count |
|----------|-------|
| Must-fix | 1 |
| Medium | 4 |
| Low | 2 |
| **Total** | **7** |

### R1 Resolution

| Status | Count |
|--------|-------|
| FIXED | 4 |
| PARTIALLY FIXED | 4 |
| NOT FIXED | 3 |
| ADDRESSED (impl-note) | 2 |
| NOT ADDRESSED (impl-note) | 2 |

**Assessment:** The plan improved substantially between R1 and R2. The critical issues from R1 are resolved — the Agent SDK evaluation is properly gated in Phase 0, and the `send_input` protocol is well-specified. The session lifecycle state additions (`processState`, `sessionId`, etc.) are exactly what was needed but introduced a new must-fix: the dual `primaryState`/`processState` model that needs to be collapsed into a single authoritative state machine. The remaining carried issues (persistence, WS reconnection, terminal format) are all medium/low severity and won't block starting implementation, but should be addressed before Phase 3 (when terminal streaming and reconnection become exercised paths).
