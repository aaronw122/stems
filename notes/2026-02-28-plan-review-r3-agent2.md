# Plan Review Round 3 (Final): weft-flow Agent Orchestration GUI

**Reviewer:** Cynical Senior Engineer (Agent 2)
**Date:** 2026-02-28
**Plan reviewed:** `/Users/aaron/weft-flow/plan.md` (revision 3)
**Prior review:** `/Users/aaron/weft-flow/notes/2026-02-28-plan-review-r2-agent2.md`

---

## Round 2 Issue Status

### Must-fix issues

- **[FIXED] `primaryState`/`processState` overlap** — Collapsed into a single `nodeState` field (`idle | running | needs-human | completed | crashed`) with `displayStage` as a clearly-labeled rendering hint. Clean, unambiguous lifecycle. No more contradictory state combinations. Well done.

- **[ACCEPTABLE] Agent SDK evaluation could invalidate Phase 1** — On re-examination, this is not a rework risk. Phase 0 is a pre-code spike with an explicit gate before Phase 1 begins. If the SDK wins, Phase 1 adjusts on paper, not in code. No implementation gets thrown away. My Round 2 concern was valid in theory but the phasing already handles it.

### Medium issues

- **[FIXED] Orphaned process cleanup** — Phase 1 now includes PID file tracking, stale PID cleanup on startup, and SIGTERM/SIGINT handlers. Exactly the ~20 lines of code that were needed. Good.

- **[NOT FIXED] `--append-system-prompt` unverified** — Phase 3 still assumes this flag exists. However, Phase 0 is the right place to discover this, and the fallback (prepend context to user message) is trivial. Not a rework risk.

- **[NOT FIXED] Permission payload dead code** — `send_input` permission type and `humanNeededType: "permission"` still defined for v1 where they can never trigger. Confusing but not a rework risk.

### Low issues

- **[NOT FIXED] `humanNeededType: "idle"` semantics** — Still present. Won't cause rework.

---

## New Critical/Must-fix Issues

None found.

---

## Verdict

**Plan is clean from an engineering perspective.**

The single-`nodeState` lifecycle fix was the last structural issue. The remaining unfixed items (unverified CLI flag, dead protocol fields, idle semantics) are all discoverable during implementation without rework — Phase 0 catches the flag issue, and the others are cosmetic/documentation concerns.

The architecture is sound: Phase 0 validates assumptions before code is written, the data model is unambiguous, the permission model is explicit, process cleanup is specified, and the build phases have clear gates. Ship it.
