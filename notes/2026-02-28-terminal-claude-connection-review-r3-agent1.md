# Review: Get Terminal Connected to Claude CLI (rev 3)

**Reviewer:** Systems/IPC Architect
**Plan file:** `notes/2026-02-28-terminal-claude-connection.md`
**Round:** R3 (Final) Agent 1
**Date:** 2026-02-28

---

## Disposition of R2 Must-Fix Issues

### R2-3 [Must-fix] `clearHumanNeeded` fix needs refinement for `idle` and `result` cases

**Status: FIXED.** Rev 3 (Bug 2 fix description) now specifies three distinct clearing paths:

1. **Idle recovery:** Clear `idle`-type needs-human on any incoming stream activity (in `processEvent`). This is the correct behavior — if events are flowing, the session isn't idle.
2. **Question/permission:** Clear only in the `send_input` handler in `server/index.ts`, guarded against `error` type. Correctly defers to user action.
3. **Session complete:** Clear all needs-human unconditionally on `result` event.

Step 2 (lines 119-123) mirrors this with implementation guidance. The `idle`-only clearing in `processEvent`, the `send_input` guard, and the unconditional clear on `result` are all explicitly called out. The `error`-type exclusion in `send_input` is also specified (line 122: "but **only if** the node's current `humanNeededType` is `'question'` or `'permission'` (NOT `'error'`)").

This matches the R2 recommendation exactly. The three-path state machine is sound.

---

## Disposition of R2 Medium Issues

### R2-1 [Medium] `--verbose` flag risk to stdout stream integrity

**Status: NOT ADDRESSED.** Rev 3 still does not mention `--verbose`. The flag remains in `session.ts` line 62.

**R3 assessment: Downgrade to Impl-note.** I verified the stream parser (`parseStreamLine` at stream-parser.ts:72-81) returns `null` for non-JSON lines, and `pipeFrom` (line 362-367) simply skips null results. The newline-delimited protocol in `pipeFrom` splits on `\n` boundaries, processes complete lines individually, and retains partial lines in the buffer across chunks. The hypothetical corruption scenario from R2 (verbose output flushed in the same chunk splitting a JSON line) is not actually possible with this parser: lines are split on newlines, not chunks, so a verbose line would always be its own complete line that `parseStreamLine` drops as non-JSON.

The only risk is wasted processing of verbose lines. Not a rework issue.

### R2-2 [Medium] Process exit without `result` event leaves orphaned running nodes

**Status: NOT ADDRESSED.** Rev 3 does not cover this lifecycle gap.

**R3 assessment: Remains Medium, but not a blocker.** Looking at `session.ts` lines 112-125, the exit handler transitions to `crashed` on non-zero exit, but does nothing on code 0 without a `result` event. This can leave a node stuck in `running` state if the process exits cleanly without emitting `result` (e.g., `killSession()` sends SIGTERM).

However: this is a single-line fix during implementation (`if nodeState is still running after exit code 0, set it to completed`). It does not affect any other step in this plan and would not cause rework. The plan's Step 7 smoke test would likely surface it. Not blocking implementation.

---

## Disposition of R2 Low Issues

### R2-4 [Low] Terminal replay deduplication strategy unspecified

**Status: FIXED.** Rev 3 Bug 4 (lines 71-73) now specifies:
- Use a distinct `terminal_replay` message type (added to `ServerMessage` union)
- Client handles `terminal_replay` with `setLines` (replace entire buffer) rather than `appendLines`
- Step 4 (lines 133-136) reiterates this: add `setLines(nodeId, lines)` to the Zustand store, handle `terminal_replay` by calling `setLines`

This is the correct approach and fully resolves the deduplication concern.

---

## New Findings in Rev 3

### 1. [Must-fix] Step 2 Extraction of `clearHumanNeeded` Introduces Circular Dependency Risk

**Section:** Bug 2 / Step 2, lines 117-123

**Issue:** Step 2 says to "Export a `clearHumanNeeded(nodeId)` helper from `server/state.ts`" so it can be called from both `stream-parser.ts` and `server/index.ts`. The plan proposes this helper calls `updateNode(nodeId, { needsHuman: false, nodeState: 'running', ... })`.

The problem: it always resets `nodeState` to `'running'`. But Step 2 also says to call `clearHumanNeeded(nodeId)` unconditionally on the `result` event (line 121). The `result` handler (stream-parser.ts:277-293) sets `nodeState: 'completed'` *after* processing. If `clearHumanNeeded` is called before the `completed` transition (which the plan implies — "call `clearHumanNeeded(nodeId)` unconditionally" in the result handler, before the `updateNode` that sets `completed`), it would briefly set the node to `running`, then immediately to `completed`. Two broadcasts for one transition — a minor inefficiency but not a functional bug.

However, there's a subtler concern: if `clearHumanNeeded` is called *after* `updateNode(nodeId, { nodeState: 'completed' })` in the result handler, it would overwrite `completed` back to `running`. The plan doesn't specify ordering within the result handler.

**Rework test:** Getting the call ordering wrong in the `result` handler would cause a completed session to revert to `running` state. The developer would see a node that never shows as completed and have to debug the state transitions. This is a real rework risk.

**Fix:** The `clearHumanNeeded` helper should NOT hardcode `nodeState: 'running'`. Instead, it should only reset the needs-human fields (`needsHuman: false`, `humanNeededType: null`, `humanNeededPayload: null`) and leave `nodeState` alone. The caller is responsible for setting `nodeState` appropriately. This is cleaner separation: clearing the human-needed flag is orthogonal to state transitions.

Revised helper signature in `state.ts`:
```ts
export function clearHumanNeeded(nodeId: string): void {
  const node = getNode(nodeId);
  if (!node?.needsHuman) return;
  const updated = updateNode(nodeId, {
    needsHuman: false,
    humanNeededType: null,
    humanNeededPayload: null,
  });
  if (updated) broadcast({ type: 'node_updated', node: updated });
}
```

The `send_input` handler in `index.ts` would separately set `nodeState: 'running'` when clearing question/permission states. The `result` handler doesn't need to touch `nodeState` via this helper at all — it already sets `nodeState: 'completed'`. The idle-recovery path in `processEvent` would set `nodeState: 'running'` separately.

---

## Issues NOT Present (Verified Clean)

- **Terminal replay protocol:** `terminal_replay` message type, `setLines` method, unicast delivery — all correctly specified. The `ServerMessage` union addition is noted in the Files to Modify table.
- **`send_input` error guard:** The plan correctly specifies that `send_input` must NOT clear error-type needs-human. Error states require restart, not input.
- **Reconnect re-subscribe:** Step 4 line 137 correctly identifies that `useWebSocket.ts` must re-send `subscribe_terminal` on reconnect. This is a real gap in the current code and the plan addresses it.
- **One-shot stdin handling:** Bug 3 presents three valid options with clear tradeoffs. No architectural issues.
- **`--include-partial-messages`:** Bug 1 / Step 1 is straightforward and correct.

---

## Overall Assessment

Rev 3 successfully resolved the R2 Must-fix (the `clearHumanNeeded` three-path state machine for idle/question/result). The two R2 Medium items remain unaddressed but neither would cause significant rework — one (verbose flag) I'm downgrading to Impl-note after verifying the parser handles it safely, and the other (exit-without-result) is a one-line fix that would be caught during smoke testing.

One new Must-fix emerged: the `clearHumanNeeded` helper as specified would hardcode `nodeState: 'running'`, which creates an ordering hazard in the `result` handler. The fix is simple (decouple needs-human clearing from state transitions) and doesn't affect the plan's overall structure.

**Remaining items:**

| # | Severity | Summary |
|---|----------|---------|
| 1 | Must-fix | `clearHumanNeeded` helper must not hardcode `nodeState: 'running'` — decouple from state transitions |
| R2-2 | Medium | Process exit code 0 without `result` leaves node in `running` (one-line fix, would surface in smoke test) |

**Recommendation:** Address Finding 1 in the plan text (revise the helper signature in Step 2), then this plan is ready for implementation. The Medium item can be discovered and fixed during Step 7 smoke testing without rework.
