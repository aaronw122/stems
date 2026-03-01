# Plan Review Summary

**Plan:** notes/2026-02-28-terminal-claude-connection.md
**Rounds:** 3
**Final revision:** rev 4

## Issues Found & Fixed

### Round 1 (rev 1 → rev 2)

1. **[Critical] `--include-partial-messages` missing from spawn args** — Without this flag, `content_block_delta` events are never emitted. Streaming is broken. Promoted to Bug 1 (Critical) in rev 2. *(All 3 agents)*
2. **[Must-fix] Bug 1 (`containerRef`) already fixed in codebase — plan was stale** — The plan described a bug that had already been resolved in the floating terminal window PR. Removed from plan. *(All 3 agents)*
3. **[Must-fix] One-shot sessions silently discard stdin input** — One-shot sessions don't use `--input-format stream-json`, so `sendInput()` writes to a pipe nobody reads. Added as Bug 3 with three fix options. *(Agents 1, 2, 3)*
4. **[Must-fix] `clearHumanNeeded` fires on every non-error event** — Any event following an `AskUserQuestion` tool_use immediately clears the `needs-human` state before the user can respond. Added as Bug 2 with differentiated clearing logic. *(Agents 1, 3)*
5. **[Must-fix] Missing `--input-format stream-json` on one-shot sessions** — Blocks future input and turn continuation for subtasks. Folded into Bug 3 / Step 3 as option 1. *(Agent 2)*
6. **[Must-fix] Plan used wrong field names (`type`/`allow` vs actual `kind`/`granted`)** — Plan documentation didn't match `shared/types.ts`. Resolved by removing inline payload schema from the plan. *(Agent 2)*
7. **[Must-fix] Terminal buffer not replayed on subscribe** — After page reload or re-subscribe, terminal appears empty. Added as Bug 4 with replay protocol details. *(Agents 1, 3)*

### Round 2 (rev 2 → rev 3)

1. **[Must-fix] `clearHumanNeeded` fix incomplete for `idle` and `result` cases** — Moving `clearHumanNeeded` entirely to `send_input` broke idle recovery (activity-based clearing) and left `needs-human` true on completed sessions. Rev 3 introduced three-path clearing: idle on activity, question/permission on `send_input`, unconditional on `result`. *(Agent 1)*
2. **[Must-fix] Terminal replay needs specified message type, send-not-broadcast, and dedup strategy** — Rev 2 was vague on replay approach. Rev 3 commits to a distinct `terminal_replay` message type, unicast delivery, and `setLines` (replace) semantics on the client. *(Agents 2, 3)*
3. **[Must-fix] `send_input` payload shape mismatch — `question_answer` and `permission` are dead code** — No UI path produces these payload kinds; only `text_input` exists. Acknowledged as v1 limitation. *(Agent 3)*
4. **[Low→Fixed] `clearHumanNeeded` is a closure, not callable from `index.ts`** — Plan specified calling it from `index.ts` but it was a private closure in the stream parser. Rev 3 specifies exporting a shared helper from `state.ts`. *(Agent 2)*

### Round 3 (rev 3 → rev 4)

1. **[Must-fix] `clearHumanNeeded` helper must NOT set `nodeState`** — The helper as specified hardcoded `nodeState: 'running'`, creating an ordering hazard in the `result` handler where `completed` gets overwritten back to `running`. Rev 4 removes `nodeState` from the helper and merges the human-needed fields directly into the `result` handler's `updateNode` call. *(Agents 1, 2)*
2. **[Must-fix] `proc.exited` can overwrite `completed` with `crashed`** — The `result` event sets `completed` via stdout parsing, but `proc.exited` fires independently and can overwrite to `crashed` on non-zero exit code. Rev 4 adds a `nodeState !== 'completed'` guard to the exit handler. *(Agent 2)*

## Remaining Issues (Medium/Low -- not fixed in plan)

### Medium

- **`--verbose` flag in spawn args** — Present in `session.ts` but not addressed in the plan. Could produce non-JSON stdout that gets silently dropped by the parser. Verified to be low risk: the newline-delimited parser handles it safely. If it causes issues, removing the flag is a one-line change. *(Agents 1-R1, 2-R1, 1-R2, 2-R2; downgraded to impl-note in R3 by Agent 1)*
- **`--include-partial-messages` flag validity unverified** — The plan treats this as the critical fix but doesn't verify the flag name exists in the installed Claude CLI version. If wrong, error is immediately obvious and fix is changing one string. *(Agents 2-R2, 3-R2)*
- **Process exit code 0 without `result` event leaves node in `running`** — If Claude exits cleanly but never emits `result`, the node stays stuck. One-line fix during implementation. *(Agents 1-R1, 1-R2)*
- **`user_message` may be wrong format for `AskUserQuestion` responses** — The `sendInput` function wraps all responses as `user_message`, but the CLI may expect a different format for tool responses. Low risk since `--dangerously-skip-permissions` suppresses most interactive scenarios. *(Agents 2-R2)*
- **Idle timer fires before first user input in interactive sessions** — `pipeFrom` starts the idle timer immediately on spawn, so interactive sessions (no prompt) get a false idle warning after 2 minutes. Fix: defer the timer until first `user_message`. *(Agent 3-R1, carried through R2 and R3)*
- **WebSocket reconnection drops terminal subscriptions** — Fixed in rev 3 with reconnect re-subscribe behavior. *(Agent 3-R2)*

### Low

- **`--add-dir` flag from `plan.md` not mentioned** — The architecture spec includes it but `session.ts` doesn't use it. May be unnecessary since `cwd` is set. *(Agent 1-R1)*
- **Smoke test for `needs-human` unrealistic with `--dangerously-skip-permissions`** — Claude auto-approves everything in this mode, making question/permission testing difficult. *(Agent 2-R1, carried through R2)*
- **Noisy event suppression should use an allowlist** — Bug 6 only covers `model_usage_metrics` but the Anthropic streaming protocol includes `message_start`, `content_block_start/stop`, `message_delta`, `message_stop` which all hit the default case. Should invert to display-worthy allowlist. *(Agents 2-R1, 2-R2)*
- **Step 3 Option 1 (unified stream-json) has a startup timing concern** — If the initial `user_message` is sent before CLI finishes initializing, it could be lost. Unlikely with `Bun.spawn` but worth testing. *(Agent 3-R2)*

## Implementation Notes

- **Per-character `content_block_delta` events cause high-frequency renders.** Each delta triggers a WebSocket message, Zustand state update (new Map copy), and React re-render. Consider batching terminal appends on a requestAnimationFrame boundary or coalescing deltas in the stream parser. *(Agents 1-R1, 2-R1, 3-R1)*
- **`dangerouslySetInnerHTML` with `ansi-to-html` output is an XSS vector.** If Claude discusses `<script>` tags, they could be rendered as HTML. Verify that `ansi-to-html` escapes HTML entities by default. *(Agent 1-R1)*
- **Idle timer fires during long tool executions.** Claude CLI may not emit events for >2 minutes during test suites or builds. Consider pausing the timer between `tool_use` and `tool_result`, or making the timeout configurable. *(Agent 1-R1)*
- **`content_block_delta` text fragments render as separate `<div>` lines.** Each token appears on its own line in the terminal. Fix by accumulating delta text into lines (split on `\n`) or using CSS `display: inline`. *(Agent 3-R2)*
- **`handleTerminalInput` trims whitespace.** Empty-after-trim messages are silently dropped. Fine for v1 but worth noting. *(Agent 3-R2)*
- **`clearHumanNeeded` closure in stream parser should be deleted after extraction.** After exporting the shared helper from `state.ts`, remove the private closure version to avoid drift. *(Agent 3-R3)*
- **`setLines` and `appendLines` ordering on reconnect.** Any `terminal_data` arriving between reconnect and `terminal_replay` would be overwritten by the replay. In practice, the replay is sent synchronously in the subscribe handler, so this race is unlikely. *(Agent 3-R3)*
- **Race between `result` and `proc.exited`.** Gate the `proc.exited` crash transition on `nodeState !== 'completed'`. *(Agent 2-R1, carried through R3 and fixed in rev 4)*
- **`pipeFrom` clears idle timer in `finally` block.** If stdout closes before `proc.exited` resolves, a clean exit without `result` leaves the session stuck in `running`. Check after stream reader loop ends whether `result` was received. *(Agent 2-R1)*

## Reviewer Personas Used

1. **Systems/IPC Architect** -- process management, streaming protocols, WebSocket architecture, concurrency
2. **CLI/Terminal Integration Specialist** -- Claude CLI protocol, Bun.spawn, JSON streaming
3. **Frontend Integration Reviewer** -- React + Zustand state, React Flow, real-time rendering
