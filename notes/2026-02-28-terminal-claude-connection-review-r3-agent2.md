# Review R3 (Final): Get Terminal Connected to Claude CLI

**Reviewer:** CLI/Terminal Integration Specialist (Agent 2)
**Date:** 2026-02-28
**Plan file:** `notes/2026-02-28-terminal-claude-connection.md` (rev 3)
**Prior review:** `notes/2026-02-28-terminal-claude-connection-review-r2-agent2.md`

---

## R2 Issue Resolution Status

| R2 # | R2 Severity | Finding | Status in Rev 3 |
|-------|-------------|---------|------------------|
| 1 | Medium | `--verbose` flag risk | **Not addressed** — see Assessment below |
| 2 | Medium | `--include-partial-messages` flag existence not verified | **Not addressed** — see Assessment below |
| 3 | Low | `clearHumanNeeded` is a parser closure, not callable from `index.ts` | **Fixed** — Step 2 now specifies exporting `clearHumanNeeded(nodeId)` from `state.ts` and calling it from both `stream-parser.ts` and `index.ts`. The mechanism note in Step 2 explicitly acknowledges the closure problem and prescribes the solution. |
| 4 | Low | Noisy event suppression should use allowlist | **Not addressed** — Step 6 still says "add cases for `model_usage_metrics` and any other noisy event types" |
| 5 | Low | Smoke test 7.8 unrealistic with skip-permissions | **Not addressed** |
| 6 | Must-fix | Terminal replay needs specified message type, send-not-broadcast, dedup strategy | **Fixed** — Bug 4 now commits to a distinct `terminal_replay` message type (added to `ServerMessage` union), specifies unicast `ws.send` (not broadcast), and prescribes `setLines` (replace entire buffer) instead of `appendLines` to handle dedup. Step 4 spells out all five substeps including adding `setLines` to the Zustand store and re-subscribing on reconnect. |
| 7 | Medium | `user_message` may be wrong format for question responses | **Not addressed** — see Assessment below |

**Summary:** The one Must-fix (#6) is fully resolved. The one Low that warranted plan-level specification (#3) is resolved. The remaining items (Medium #1, #2, #7 and Low #4, #5) were not addressed.

---

## Assessment of Unresolved R2 Items

The question for R3 is: do any of the unresolved R2 items rise to "would cause significant rework if discovered during implementation"?

### R2 #1 (`--verbose` flag) — No rework risk

The `--verbose` flag is already in the codebase (`session.ts:62`). The stream parser's `parseStreamLine` returns `null` for non-JSON lines, and the `pipeFrom` line splitter processes newline-delimited output correctly. The risk of interleaved non-JSON content within a single line is theoretical — Claude CLI's `--verbose` output goes to stderr in most configurations, and any edge case would surface as a dropped line (silent degradation, not corruption). If it causes problems during implementation, removing the flag is a one-line change. **No rework.**

### R2 #2 (`--include-partial-messages` validity) — Low rework risk, but worth noting

If the flag name is wrong, the fix is changing a single string in the spawn args array. The plan already includes Step 5 (manual verification of interactive mode) and Step 7 (end-to-end smoke test that explicitly checks for streaming output). Either step would catch a wrong flag name immediately. The plan's Step 5 should include verifying this flag specifically, but failing to do so would cost 5 minutes of debugging, not significant rework. **No rework.**

### R2 #7 (`user_message` format for question responses) — Low rework risk

This is a real concern: if Claude CLI's stream-json protocol requires a different input format for responding to `AskUserQuestion` tool use, the `sendInput` function in `session.ts` would need updating. However, `--dangerously-skip-permissions` suppresses most interactive scenarios (the plan acknowledges this), so this code path won't be exercised in the initial implementation. When supervised mode is added later, the `sendInput` format will need empirical verification regardless — the fix would be changing the JSON structure in a single function. **No rework for the current scope.**

### R2 #4 and #5 — Low severity, confirmed

These are genuine quality improvements (allowlist for event suppression, realistic smoke test for needs-human) but neither would cause rework if discovered during implementation. They're polish items.

---

## New Findings in Rev 3

### 1. `result` event handler does not call `clearHumanNeeded` — plan says it should

**Severity:** Must-fix
**Section:** Bug 2 / Step 2 (item 3)

The plan's Step 2, item 3 states:

> In `server/stream-parser.ts`, in the `result` event handler, call `clearHumanNeeded(nodeId)` unconditionally — session is complete, no further human action possible

This is correct and necessary. However, examining the current `result` handler in `stream-parser.ts:261-293`, it updates `nodeState` to `'completed'` but does **not** clear `needsHuman`, `humanNeededType`, or `humanNeededPayload`. If a session enters `needs-human` state (e.g., from idle timeout) and then the CLI exits with a `result` event, the node will be in `nodeState: 'completed'` but with `needsHuman: true` — a contradictory state.

The plan correctly identifies this fix. The issue is that the plan's Step 2 describes calling the **exported** `clearHumanNeeded(nodeId)` from `state.ts` (which doesn't exist yet), but the `result` handler also calls `updateNode` with `nodeState: 'completed'`. If `clearHumanNeeded` sets `nodeState: 'running'` (as specified in the plan's Step 2 item 1), and then the `result` handler sets `nodeState: 'completed'`, the order matters — `clearHumanNeeded` must be called **before** `updateNode` with `completed`, or the `clearHumanNeeded` helper must not set `nodeState` when called from the `result` path.

**Why this is plan-level:** The plan specifies `clearHumanNeeded` as always setting `nodeState: 'running'`, but the `result` handler needs it to set `nodeState: 'completed'` (or at least not overwrite the subsequent `completed` state). The plan should either:
- Specify that in the `result` handler, clear the human-needed fields directly via `updateNode` in the same call that sets `completed` (merge the fields), rather than calling `clearHumanNeeded` separately
- Or specify that `clearHumanNeeded` should accept an optional `nodeState` override parameter

Without this clarification, an implementer following the plan literally will produce a race between `clearHumanNeeded` (sets `running`) and the `result` handler (sets `completed`), causing two `node_updated` broadcasts and a brief flash of `running` state before `completed`.

**Recommended fix:** In the `result` handler, merge the human-needed clearing into the existing `updateNode` call:

```ts
updateNode(nodeId, {
  nodeState: 'completed',
  needsHuman: false,
  humanNeededType: null,
  humanNeededPayload: null,
  costUsd: ...,
  tokenUsage: ...,
});
```

This avoids the double-update and the transient incorrect state.

---

### 2. `proc.exited` handler can overwrite `completed` with `crashed` — existing code, but plan's changes make it more likely

**Severity:** Must-fix
**Section:** Step 2 / Step 7 (interaction with `session.ts:112-125`)

The R2 review noted this as an impl-note (R1 #6), but the rev 3 plan's changes to the `result` handler make it a concrete problem rather than a theoretical one.

Current `session.ts:112-125`:

```ts
proc.exited.then(async (code) => {
  sessions.delete(nodeId);
  if (code !== 0) {
    const updated = updateNode(nodeId, {
      nodeState: 'crashed',
      errorInfo: { ... },
    });
  }
});
```

The `result` event arrives via stdout parsing (async), and `proc.exited` fires when the process terminates. These are independent async callbacks. The typical sequence is:

1. Claude CLI writes the `result` JSON to stdout
2. Claude CLI exits with code 0
3. `pipeFrom` processes the `result` event (sets `completed`)
4. `proc.exited` fires (code 0, no overwrite)

But if Claude CLI exits with a non-zero code **after** emitting a `result` event (which can happen — e.g., the process receives SIGTERM during cleanup after writing the result), the sequence becomes:

1. `result` event sets `completed`
2. `proc.exited` fires with non-zero code, overwrites to `crashed`

The plan's Step 2 adds `clearHumanNeeded` to the `result` handler, making that handler do more work. But it doesn't address the `proc.exited` race, which could undo the entire `result` handler's state changes.

**Why this is plan-level:** The plan adds verification step 7.4 ("spawn subtask with prompt, see completion") and 7.6 ("confirm error state from send_input is not cleared"). If the `proc.exited` handler overwrites `completed` with `crashed`, test 7.4 will intermittently fail, and the developer won't know whether it's a plan bug or a timing bug. The plan should specify that `proc.exited` must check the current node state before overwriting:

```ts
proc.exited.then(async (code) => {
  sessions.delete(nodeId);
  if (code !== 0) {
    const node = getNode(nodeId);
    if (node && node.nodeState !== 'completed') {
      updateNode(nodeId, { nodeState: 'crashed', ... });
    }
  }
});
```

This is a one-line guard, but the plan should call it out because it directly affects whether the smoke tests in Step 7 will produce reliable results.

---

## No New Issues Introduced by R2 Fixes

The R2 Must-fix (#6, terminal replay) was addressed cleanly. The new `terminal_replay` message type, `setLines` method, and reconnect re-subscribe behavior are all internally consistent and don't conflict with existing code. The `clearHumanNeeded` extraction to `state.ts` (#3) is also clean — the plan correctly identifies the module boundary and the approach.

---

## Summary Table

| # | Severity | Finding | New/Carried |
|---|----------|---------|-------------|
| 1 | Must-fix | `clearHumanNeeded` in `result` handler will flash `running` before `completed` — merge into single `updateNode` call | New (introduced by rev 3 Step 2 specification) |
| 2 | Must-fix | `proc.exited` can overwrite `completed` with `crashed` — needs state guard | Carried (R1 #6 impl-note, upgraded because plan's changes make it testably broken) |

Both issues have simple fixes (merging fields in one `updateNode` call; adding a one-line state check). Neither requires architectural rework — they're specification gaps that would cause confusing test failures during Step 7 if not addressed.

---

## Verdict

The plan is architecturally sound and ready for implementation with two small amendments:

1. **Step 2, item 3:** In the `result` handler, merge the human-needed clearing fields (`needsHuman: false`, `humanNeededType: null`, `humanNeededPayload: null`) into the existing `updateNode` call that sets `nodeState: 'completed'`, rather than calling the separate `clearHumanNeeded` helper.

2. **Add to Step 1 or Step 2:** In `session.ts`, guard the `proc.exited` crash transition with `if (node.nodeState !== 'completed')` to prevent overwriting a successfully completed session.

With these two additions, the plan covers all the critical paths and the smoke tests in Step 7 will produce reliable results.
