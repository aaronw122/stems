# Plan Review Round 2: weft-flow Agent Orchestration GUI

**Reviewer:** Cynical Senior Engineer (Agent 2)
**Date:** 2026-02-28
**Plan reviewed:** `/Users/aaron/weft-flow/plan.md` (revision 2)
**Prior review:** `/Users/aaron/weft-flow/notes/2026-02-28-plan-review-r1-agent2.md`

---

## Round 1 Issue Status

- [FIXED] **`--print` flag missing** — Architecture example and Phase 1 both now include `-p`. Correctly addressed.
- [FIXED] **Multi-turn conversation model unverified** — Phase 0 spike added with explicit gate. Tests multi-turn, documents format, identifies fallbacks, blocks Phase 1. Exactly what was needed.
- [FIXED] **Permission model undefined** — Dedicated section added. Uses `--dangerously-skip-permissions` for v1 with granular UI as future enhancement. Clear, defensible decision.
- [FIXED] **`send_input` has no UI** — TerminalPeek now includes text input with contextual UI (free-text for questions, approve/deny for permissions). `send_input` payload types are well-defined in WS protocol.
- [FIXED] **`--add-dir` doesn't set cwd** — `Bun.spawn` must set `cwd` to repo path is now called out in both architecture and Phase 1.
- [PARTIALLY FIXED] **Stage detection heuristics too naive** — Good structural fix: `primaryState` (authoritative) separated from `displayStage` (heuristic, approximate). Plan acknowledges stages are approximate. However, manual stage override is punted to "Future enhancements" rather than included in any build phase. This is acceptable for v1 — the two-layer model means bad heuristics degrade gracefully since `primaryState` is authoritative.
- [FIXED] **Conflict detection reactive not preventive** — Renamed to "File overlap tracking." Explicitly called "advisory only." File locking noted as future enhancement. Honest naming, honest limitations.
- [FIXED] **Context summarization too late** — Phase 3 now includes minimal context passing (parent prompt + first response). Phase 7 upgrades to proper summarization. Latency/cost noted. Good phasing.
- [FIXED] **Plan viewer is scope creep** — Moved to "Future enhancements." No longer a build phase. Correct decision.
- [NOT FIXED] **No persistence, no graceful shutdown** — Still in-memory only. No SIGTERM/SIGINT handling mentioned. No acknowledgment of orphaned child processes on crash. See new issue below.
- [NOT FIXED] **Terminal buffer 500 lines too small** — Still "rolling last ~500 lines." Context summarization in Phase 7 operates on this buffer — if important early context scrolled off, the summary input is incomplete. No full-log-to-disk option mentioned.
- [NOT FIXED] **`gh` polling rate limits** — Still "poll status every 30s" with no batching or adaptive interval. With 10 PRs that is 20 `gh` calls/minute, consuming 25% of the GitHub API rate limit before agents even touch it.
- [PARTIALLY FIXED] **No error recovery for crashed sessions** — Data model now has `processState: 'crashed'` and `errorInfo` fields. But error handling is still deferred to Phase 8 (polish). The data model acknowledges crashes exist but no build phase actually handles them until polish.
- [PARTIALLY FIXED] **Dagre should be Phase 2** — `useGraph.ts` description in Phase 2 says "with dagre layout," so it is implicitly part of Phase 2. But Phase 8 still lists "Dagre auto-layout" as if it hasn't been done yet. Contradictory — either remove it from Phase 8 or clarify what Phase 8 adds beyond Phase 2.
- [NOT FIXED] **No budget controls** — `costUsd` and `tokenUsage` added to data model (good for visibility), but no `--max-budget-usd` flag, no configurable budget limit, no kill button. A runaway agent still has no guardrail except manually finding the process.
- [NOT FIXED] **Bun version not pinned** — No change. Low severity, still applicable.
- [NOT FIXED] **No kill/cancel button for running agents** — No stop button in any node component. `close_node` behavior (SIGTERM? SIGKILL? just remove from UI?) still undefined.
- [NOT FIXED] **ANSI rendering clarity** — Impl-note, still applicable but acceptable to resolve during implementation.
- [NOT FIXED] **`--include-partial-messages` bandwidth** — Impl-note, still applicable.
- [NOT FIXED] **Auto-reconnect without state sync** — Impl-note, still applicable.

---

## New Issues Found

### [Must-fix] Agent SDK evaluation in Phase 0 could invalidate the entire Phase 1 plan

**Section:** Architecture (Agent SDK note), Phase 0
**Issue:** Phase 0 now includes evaluating `@anthropic-ai/claude-agent-sdk` as a potential replacement for raw `Bun.spawn` + stream-json. The plan says "If viable, it eliminates `stream-parser.ts` entirely and simplifies the architecture significantly." But Phase 1 is fully specified around `Bun.spawn` + `stream-parser.ts`. If the SDK evaluation concludes "yes, use this," Phase 1 needs to be rewritten — different file structure, different event model, different session management. The plan says "update Phase 1 plan accordingly" but doesn't sketch what a SDK-based Phase 1 would look like.

This creates a fork in the plan that won't be resolved until Phase 0 completes. That's fine if you acknowledge it, but right now the plan reads as if Phase 1 is settled when it actually depends on a Phase 0 outcome.

**Suggested fix:** Either (a) commit to `Bun.spawn` + stream-json as the architecture and evaluate the SDK as a post-MVP replacement, or (b) sketch both Phase 1 variants (Bun.spawn vs SDK) so the Phase 0 gate has clear next steps for either outcome. Option (a) is simpler and I'd recommend it — the SDK can always be swapped in later if the stream-json approach works.

---

### [Must-fix] `primaryState` and `processState` overlap creates ambiguous node lifecycle

**Section:** Data model
**Issue:** The data model now has two state fields that partially overlap:

- `primaryState`: `active` | `needs-human` | `done`
- `processState`: `'idle'` | `'running'` | `'completed'` | `'crashed'`

What does it mean when `primaryState` is `active` but `processState` is `crashed`? Or `primaryState` is `done` but `processState` is `running`? These are contradictory states that the code will need to reconcile. Some combinations are clearly invalid (`active` + `completed`), but there's no specification of which combinations are legal, which is authoritative when they disagree, or what transitions are allowed.

The two fields track related but different things (logical lifecycle vs process health), and that distinction is useful. But without a state machine that defines valid combinations, every consumer of this data will make its own assumptions about what `primaryState=done, processState=running` means.

**Suggested fix:** Add a brief state machine or truth table showing valid `(primaryState, processState)` combinations and their meaning. For example:
- `(active, running)` — normal operation
- `(active, crashed)` — impossible, should transition to `(done, crashed)` or `(needs-human, crashed)`
- `(needs-human, running)` — agent asked a question, process still alive
- `(done, completed)` — clean exit
- `(done, crashed)` — abnormal exit

This is 5 minutes of documentation that prevents hours of debugging contradictory states.

---

### [Medium] `--dangerously-skip-permissions` contradicts `send_input` permission payloads

**Section:** Permission Model, WS protocol
**Issue:** The plan commits to `--dangerously-skip-permissions` on all sessions (line 40). But the WS protocol still defines `send_input` with a `{ type: "permission", allow: boolean }` payload type (line 278), and `humanNeededType` still includes `"permission"` (line 57). If all sessions skip permissions, these fields are dead code in v1. They exist solely for the future "supervised mode" enhancement.

This is not wrong, but it's confusing. Someone implementing the WS protocol will build infrastructure for permission handling that can never be triggered. The UI description for TerminalPeek also mentions "approve/deny buttons for permission prompts" (line 96, 193) — which will never appear in v1.

**Suggested fix:** Add a one-line note to the `send_input` permission type and `humanNeededType: "permission"` saying these are reserved for the future supervised mode and are not triggered in v1. Alternatively, remove them from v1 scope entirely and add them when supervised mode is actually built. Dead protocol fields invite dead code.

---

### [Medium] Phase 3 context passing uses `--append-system-prompt` — is this a real flag?

**Section:** Phase 3 (line 195)
**Issue:** Phase 3 says "inject parent's original prompt + first assistant message into child's system prompt via `--append-system-prompt`." The architecture section uses `--add-dir` and `-p` as CLI flags, which are documented. But `--append-system-prompt` was not mentioned in the Round 1 review's discussion of CLI flags, and it's not clear this flag exists in the Claude CLI. If this flag doesn't exist, the context injection mechanism for Phases 3-6 has no implementation path.

Alternatives if this flag doesn't exist: pass context as part of the initial user message (less clean but works), use a temporary CLAUDE.md file in the repo (hacky), or use the Agent SDK's session management.

**Suggested fix:** Verify `--append-system-prompt` exists in the Claude CLI during Phase 0. If not, specify the fallback: prepend context to the user's prompt as a `[Context from parent session]` block. This is less elegant but universally works.

---

### [Medium] Orphaned Claude processes on server crash — no mitigation

**Section:** Architecture — Server
**Issue:** Carried forward from Round 1 (persistence issue) but worth calling out specifically: `Bun.spawn` creates child processes. If the Bun server crashes or is killed with SIGKILL, those child processes become orphans — still running, still consuming API credits, still editing files, but invisible to any future server instance. The plan has no process group management, no PID file, no cleanup-on-startup logic.

For a tool that spawns multiple autonomous agents with `--dangerously-skip-permissions`, orphaned processes are not a theoretical concern — they're agents with full filesystem access running unsupervised with no way to stop them short of `kill -9` on individual PIDs.

**Suggested fix:** At minimum, add to Phase 1: (1) write spawned PIDs to a file, (2) on server startup check for and kill stale PIDs, (3) set up SIGTERM handler that kills all children. This is 20 lines of code and prevents a real footgun.

---

### [Low] `humanNeededType: "idle"` is not a human-needed state

**Section:** Data model
**Issue:** `humanNeededType` includes `"idle"` as a value, triggered by "no events for 120+ seconds." But an idle agent isn't necessarily waiting for human input — it might be doing a long-running operation, waiting for an API response, or thinking. Flagging idle as "needs human" will create false positives that train the user to ignore the red flash, undermining the signal quality of actual human-needed states (questions and errors).

**Suggested fix:** Either remove `"idle"` from `humanNeededType` and use a separate `idleWarning` boolean, or significantly increase the timeout (300+ seconds). At minimum, make the idle timeout configurable and use a distinct visual treatment (amber vs red) so it doesn't look the same as a genuine question.

---

## Summary

| Category | Count |
|----------|-------|
| **Round 1 issues FIXED** | 9 |
| **Round 1 issues PARTIALLY FIXED** | 3 |
| **Round 1 issues NOT FIXED** | 8 |
| **New issues found** | 6 |

### New issue severity breakdown

| Severity | Count |
|----------|-------|
| Must-fix | 2 |
| Medium | 3 |
| Low | 1 |
| **Total new** | **6** |

## Overall Assessment

Solid revision. The three Critical issues from Round 1 are all resolved — the `-p` flag is in, Phase 0 validates the multi-turn assumption before any code is written, and the permission model is explicitly decided. The architectural foundation is now sound.

The most important remaining gaps are operational, not architectural: no graceful shutdown (orphaned agents with full permissions is a real footgun), no budget guardrails, no kill button, and the Agent SDK evaluation creates a fork in the plan that should be resolved by committing to one path.

The `primaryState` / `processState` overlap is the most likely source of implementation bugs — adding a 5-minute truth table now prevents a day of debugging contradictory states later.

The 8 unfixed Round 1 issues are mostly Medium/Low severity. They won't block initial development but several (graceful shutdown, budget controls, kill button) will bite during real use. I'd prioritize the orphaned-process mitigation above all others — it's the only issue where "we'll fix it later" means "agents run unsupervised with no off switch."
