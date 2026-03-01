# Review: Get Terminal Connected to Claude CLI (rev 2)

**Reviewer:** Systems/IPC Architect
**Plan file:** `notes/2026-02-28-terminal-claude-connection.md`
**Round:** R2 Agent 1
**Date:** 2026-02-28

---

## Disposition of R1 Findings

### R1-1 [Must-fix] Plan Bug 1 Is Already Resolved -- Plan Is Stale
**Status: FIXED.** Rev 2 removes the stale `containerRef` bug entirely. The plan now starts with Bug 1 as `--include-partial-messages` missing. Good.

### R1-2 [Critical] `send_input` Payload Mismatch / One-Shot stdin Protocol
**Status: FIXED.** Rev 2 adds Bug 3 (One-Shot Sessions Silently Discard stdin Input) which covers this exact issue. The three fix options presented (always use `--input-format stream-json`, disable input in UI, or document the limitation) are appropriate. Step 3 provides implementation guidance for both the unified-protocol and disable-input approaches. The critical issue is addressed.

### R1-3 [Must-fix] No `--include-partial-messages` Flag
**Status: FIXED.** Rev 2 promotes this to Bug 1 (Critical) and Step 1. Correctly identified as the single most important fix. Good.

### R1-4 [Medium] `--verbose` Flag May Produce Non-JSON Noise on stdout
**Status: NOT ADDRESSED.** The rev 2 plan does not mention `--verbose` at all. The flag is still present in `session.ts` line 62. See Finding 1 below.

### R1-5 [Medium] Terminal Buffer Replay on Subscribe
**Status: FIXED.** Rev 2 adds Bug 4 (Terminal Buffer Not Replayed on Subscribe) and Step 4. The description correctly identifies the problem and the fix direction. Good.

### R1-6 [Medium] Process Exit Without `result` Event Leaves Node in `running` State
**Status: NOT ADDRESSED.** Rev 2 does not mention this lifecycle gap. See Finding 2 below.

### R1-7 [Medium] `clearHumanNeeded` on Every Non-Error Event
**Status: FIXED.** Rev 2 adds Bug 2 (clearHumanNeeded Fires on Every Non-Error Event) and Step 2. The fix (move `clearHumanNeeded()` from `processEvent` to the `send_input` handler in `server/index.ts`) is exactly right. Good.

### R1-8 [Low] Plan Doesn't Mention `--add-dir` Flag
**Status: NOT ADDRESSED.** Rev 2 still does not mention `--add-dir`. Low priority -- unchanged assessment.

### R1-9 through R1-12 [Impl-note / Low]
These were Impl-notes and Low items. Expected to be resolved during implementation, not in the plan. Not tracking.

**Summary:** 4 of 7 actionable findings (Critical + Must-fix + Medium) were fixed. Two Medium items remain unaddressed.

---

## New Findings in Rev 2

### 1. [Medium] `--verbose` Flag Still Unaddressed -- Risk of stdout Corruption

**Section:** Bug 1 / Step 1 (spawn args discussion)

**Issue:** The plan focuses on adding `--include-partial-messages` to spawn args but does not mention `--verbose`, which is already in the args array (`session.ts` line 62). This was R1 Finding 4, still unaddressed.

The concern: with `--include-partial-messages` now enabled, streaming events will arrive at much higher frequency. If `--verbose` writes any diagnostic output to stdout (rather than stderr), it would intersperse non-JSON lines with stream-json events. The `parseStreamLine` function returns `null` for non-JSON lines, so isolated verbose lines would be silently dropped. However, if a verbose log line is flushed in the same chunk as a JSON event line, and the chunk boundary splits a JSON line, the newline-delimited parsing in `pipeFrom` could produce a corrupted JSON line that also gets silently dropped -- losing a real event.

**Rework test:** If `--verbose` does write to stdout, discovering this during implementation would require re-diagnosing "why are some events missing?" -- a subtle, hard-to-reproduce bug. Worth noting in the plan.

**Fix:** Add a note to Step 1: verify that `--verbose` output goes to stderr (not stdout). If it goes to stdout, remove it from the args. If stderr, it's fine -- stderr is drained separately in `drainStderr()`.

---

### 2. [Medium] Process Exit Without `result` Event Still Leaves Orphaned Nodes

**Section:** Not covered (gap from R1-6, still present)

**Issue:** This was R1 Finding 6, still unaddressed. The `proc.exited` handler in `session.ts` (lines 112-125) only transitions the node to `crashed` if exit code is non-zero. If the process exits with code 0 but no `result` event was received (e.g., Claude CLI was killed via `killSession()`, or stdout pipe closed before final JSON was flushed), the node remains in `running` state forever.

With the rev 2 fixes (especially `--include-partial-messages` enabling real-time streaming), this becomes more likely: a user might kill a session that's mid-stream, the process exits cleanly (SIGTERM -> code 0 on many systems; actually Bun.spawn `process.kill()` sends SIGTERM which may result in non-zero, but this depends on the CLI's signal handling), and the node stays stuck.

**Rework test:** An orphaned `running` node with no live process would confuse the UI -- it looks active but produces no output and can't accept input. The idle timer would eventually fire (2 minutes), setting `needs-human: idle`, which is misleading. Fixing this during implementation is straightforward (add a fallback state transition in the exit handler), but it should be listed as a known gap so it doesn't get missed.

**Fix:** Add a note or step: in the `proc.exited` handler, after exit code 0, check if `nodeState` is still `running` and transition to `completed`. This provides a safety net for the happy path where `result` was missed.

---

### 3. [Must-fix] Step 2 Fix is Incomplete -- `clearHumanNeeded` Also Needed After `result` Event

**Section:** Bug 2 / Step 2

**Issue:** The plan says to move `clearHumanNeeded()` from `processEvent` to the `send_input` handler. This correctly fixes the race condition for questions and permissions. However, there's a scenario the plan doesn't account for:

1. Claude enters an idle state (no events for 2 minutes) -> `setHumanNeeded('idle', ...)`
2. Before the user acts, Claude resumes (e.g., a long tool execution finishes) and emits events
3. With the fix applied, `clearHumanNeeded()` would no longer be called on incoming events
4. The `needs-human: idle` state would persist even though Claude is actively working again

The `idle` case is semantically different from `question` and `permission`. For questions/permissions, clearing should only happen on user response. For `idle`, clearing should happen when activity resumes (i.e., when new events arrive).

Similarly, if a `result` event arrives while the node is in `needs-human` state (e.g., Claude was asked a question but then completed without waiting for the answer -- unlikely but possible with `--dangerously-skip-permissions`), the node would be set to `completed` nodeState but `needsHuman` would remain `true`, creating an inconsistent state.

**Rework test:** This would cause the UI to show a `needs-human` indicator on a node that's actively running (for idle) or already completed (for result). Would require re-examining the state machine during implementation.

**Fix:** Refine Step 2:
- For `question` and `permission`: clear only on `send_input` (as the plan says)
- For `idle`: clear when any new stream event arrives (keep the current behavior for the idle case only)
- For `result`: clear unconditionally when the node transitions to `completed`

The implementation in `processEvent` should be:
```ts
// Clear idle-triggered needs-human on activity (but NOT question/permission)
const node = getNode(nodeId);
if (node?.needsHuman && node.humanNeededType === 'idle') {
  clearHumanNeeded();
}
```

And in the `result` handler, add `clearHumanNeeded()` before setting `nodeState: 'completed'`.

---

### 4. [Low] Step 4 Terminal Replay May Cause Duplicate Lines on Client

**Section:** Bug 4 / Step 4

**Issue:** The plan says to replay buffered terminal lines on subscribe and notes "Ensure the client terminal store handles replayed content correctly (append, don't duplicate)." This is the right concern, but the plan doesn't specify _how_ to avoid duplication.

The client-side `useTerminal` store (line 15-27 in `useTerminal.ts`) simply appends incoming lines. If a user selects a node (subscribe), deselects (unsubscribe), and reselects (subscribe again), the client-side buffer already has the lines from the first subscription. The server replay would send the same lines again, and `appendLines` would duplicate them.

**Rework test:** Minor -- duplicated terminal output is visible but not architecturally wrong. The fix during implementation is straightforward (clear client buffer before replay, or send a `terminal_replay` message type that replaces rather than appends). This is more of an Impl-note, but since the plan already calls it out without a solution, worth noting.

**Fix:** Specify the approach in Step 4: either (a) use a distinct `terminal_replay` message type that the client handles by replacing the buffer rather than appending, or (b) have the client clear its buffer for that nodeId when it receives the first message after a `subscribe_terminal`.

---

### 5. [Impl-note] `send_input` Dispatches `question_answer` and `permission` as Plain Text

**Section:** Bug 2 / Bug 3

**Issue:** The `send_input` handler in `server/index.ts` (lines 226-239) translates `question_answer` into `sendInput(nodeId, payload.answer)` and `permission` into `sendInput(nodeId, payload.granted ? 'yes' : 'no')`. The `sendInput` function in `session.ts` then wraps this in `{ type: 'user_message', content: text }` for interactive sessions.

But Claude CLI's stream-json input protocol may expect specific message types for responding to tool use (like `tool_result` messages rather than `user_message`). If Claude asks a question via `AskUserQuestion` tool, the response format might need to be a tool result, not a user message.

This is hard to verify without testing against the actual CLI, so it belongs as an Impl-note rather than a plan fix. But it's worth flagging: during Step 5 (Verify Claude CLI Interactive Mode), also verify that a `user_message` response to an `AskUserQuestion` tool use is correctly interpreted by the CLI.

---

### 6. [Impl-note] Bug 1 Fix Says "Both Interactive and One-Shot" But One-Shot May Not Support `--include-partial-messages`

**Section:** Bug 1 / Step 1

**Issue:** The plan says to add `--include-partial-messages` to "both interactive and one-shot spawn modes." Currently, both modes share the same args array (line 62), so this is implicitly true. But if Step 3 changes one-shot mode to also use `--input-format stream-json` (Option 1), the args divergence needs careful handling. If Step 3 instead disables input for one-shot mode (Option 2), the one-shot session still gets `--include-partial-messages`, which is correct -- it enables streaming output even for non-interactive sessions.

No action needed in the plan, but worth being aware of during implementation.

---

## Issues NOT Present (Verified Clean)

- **Client/server `send_input` contract:** The `SendInputPayload` type in `shared/types.ts` matches both the client dispatch in `App.tsx` and the server handler in `index.ts`. No mismatch.
- **Terminal store message handling:** `useTerminal.ts` correctly accumulates lines and caps at 500. `useWebSocket.ts` routes `terminal_data` messages to the terminal store.
- **Stream parser `pipeFrom` newline parsing:** Correctly handles partial lines across chunk boundaries by retaining `buffer` across reads. Sound.
- **Process exit cleanup:** `sessions.delete(nodeId)` in the exit handler correctly prevents `sendInput` from writing to a dead process's stdin.

---

## Overall Assessment

Rev 2 is a significant improvement over rev 1. The four most important fixes (stale Bug 1 removal, `--include-partial-messages`, `clearHumanNeeded` race, one-shot stdin, terminal buffer replay) are all properly addressed. The plan is now actionable.

**Remaining items to address before implementation:**

| # | Severity | Summary |
|---|----------|---------|
| 3 | Must-fix | `clearHumanNeeded` fix needs refinement for `idle` and `result` cases |
| 1 | Medium | `--verbose` flag risk to stdout stream integrity |
| 2 | Medium | Process exit-without-result leaves orphaned running nodes |
| 4 | Low | Terminal replay deduplication strategy unspecified |

Findings 5 and 6 are Impl-notes -- no plan changes needed.

The Must-fix (Finding 3) is the only item I'd insist on resolving before implementation begins. The `clearHumanNeeded` fix as currently written would break the idle timeout recovery path, which is a regression from the current behavior. The Medium items are worth noting in the plan but can be discovered and fixed during implementation without significant rework.
