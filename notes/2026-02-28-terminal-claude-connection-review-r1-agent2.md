# Review: Get Terminal Connected to Claude CLI

**Reviewer:** CLI/Terminal Integration Specialist (Agent 2)
**Date:** 2026-02-28
**Plan file:** `notes/2026-02-28-terminal-claude-connection.md`

---

## Summary

The plan correctly identifies three issues preventing end-to-end Claude CLI connectivity and proposes reasonable fixes. However, comparing the plan against the actual codebase reveals that Bug 1 has already been fixed, and there are several issues the plan misses that will affect whether the connection actually works. Most significantly: the `sendInput` function sends raw text to one-shot sessions (which have no `--input-format stream-json`), but those sessions have already received their prompt as a positional arg and may not accept further stdin at all. The plan also misses a contract mismatch in how the client formats `send_input` payloads.

---

## Findings

### 1. Bug 1 (containerRef) is already fixed — plan is stale

**Severity:** Low
**Section:** Bug 1: `containerRef` Not Passed to TerminalPeek (Critical)

The plan states that `App.tsx` doesn't pass `containerRef` to `TerminalPeek`. However, the actual code in `src/App.tsx` (lines 18, 164, 206) already creates `canvasContainerRef`, attaches it to the canvas container div, and passes it as a prop. The plan is describing a bug that has been fixed.

**Suggested fix:** Remove Bug 1 from the plan or mark it as already resolved. This avoids wasted implementation time on a non-issue.

---

### 2. One-shot sessions: stdin input is silently discarded

**Severity:** Must-fix
**Section:** Current State / Two spawn modes

The plan describes two spawn modes but doesn't address what happens when a user sends input to a one-shot session. In `server/session.ts:188-194`, `sendInput()` writes raw text (not stream-json) to one-shot sessions' stdin. But one-shot sessions are launched as:

```
claude -p --verbose --output-format stream-json --dangerously-skip-permissions "the prompt"
```

With the prompt as a positional argument, Claude CLI processes that prompt and then exits. It does not read stdin for additional turns. Any `sendInput` call to a one-shot session will write to a pipe that nobody reads, or (worse) the process may have already exited.

The plan's "Two spawn modes" section documents this distinction but doesn't flag that input to one-shot sessions is a dead end. When a one-shot subtask hits a `needs-human` state (e.g., `AskUserQuestion`), the user's typed response will vanish.

**Suggested fix:** Add a step to either:
- Prevent the UI from showing an input field for one-shot sessions (since `--dangerously-skip-permissions` is always used, `AskUserQuestion` is the only realistic human-needed trigger, and that shouldn't happen in a one-shot with skip-permissions)
- Or convert the `sendInput` path for one-shot sessions to acknowledge that input can't be sent (log a warning, show an error in the terminal)
- Or launch all sessions with `--input-format stream-json` so they can accept follow-up turns

---

### 3. Interactive session `--verbose` flag may produce non-JSON output on stderr/stdout

**Severity:** Medium
**Section:** Bug 2: Interactive `-p` Mode May Not Work Without Initial Message

The plan flags that interactive `-p` without a prompt may not work, which is a valid concern worth testing. However, it misses that `--verbose` is included in the args (line 62 of `session.ts`). The `--verbose` flag can cause Claude CLI to emit additional diagnostic output that may not be valid JSON. If verbose output goes to stdout (mixed with the stream-json), `parseStreamLine` will silently drop non-JSON lines, which is fine. But it's worth noting that `--verbose` may also change the CLI's behavior around process lifecycle — for example, it may produce a startup banner or capability listing on stderr that's unrelated to the session.

This is partially mitigated because stderr is already drained separately. But if `--verbose` causes any stdout pollution, the stream parser's `JSON.parse` in `parseStreamLine` will return null, silently dropping those lines. This could cause the parser to miss the boundary between diagnostic output and actual stream events if they arrive in the same chunk.

**Suggested fix:** Verify during Step 2 testing that `--verbose` doesn't cause startup output on stdout that could be partially buffered with the first real JSON event. If it does, consider removing `--verbose` or adding a more robust line-splitting strategy that handles partial JSON lines at chunk boundaries (the current buffer-based approach should handle this, but it's worth explicit verification).

---

### 4. Missing `--input-format stream-json` for one-shot sessions prevents turn continuation

**Severity:** Must-fix
**Section:** Implementation Steps (general gap)

One-shot sessions are spawned without `--input-format stream-json` (only interactive sessions get it, per `session.ts:65-67`). This means if a one-shot session completes and the user wants to send a follow-up message, there's no mechanism to do so because the process doesn't understand stream-json input.

More importantly, if `--dangerously-skip-permissions` is ever removed for supervised mode (a planned future enhancement per `plan.md`), one-shot sessions would emit permission prompts that require stream-json formatted responses. Without `--input-format stream-json`, there's no way to approve/deny tool use.

**Suggested fix:** Either:
- Always include `--input-format stream-json` regardless of mode (simpler, more consistent)
- Or document clearly in the plan that one-shot sessions are fire-and-forget with no input capability, and ensure the UI reflects this

---

### 5. `send_input` payload mismatch: client sends `kind`, plan says `type`

**Severity:** Must-fix
**Section:** Current State / Input pipeline description

The plan describes the WS protocol for `send_input` payload as:
```
{ type: "question_answer", questionText: string, answer: string }
{ type: "permission", allow: boolean }
{ type: "text_input", text: string }
```

But the actual `shared/types.ts` (lines 56-59) and `server/index.ts` (lines 227-238) use `kind` as the discriminant, not `type`:
```ts
export type SendInputPayload =
  | { kind: 'question_answer'; answer: string }
  | { kind: 'permission'; granted: boolean }
  | { kind: 'text_input'; text: string };
```

Additionally, the plan says `allow: boolean` but the code uses `granted: boolean`. And the plan includes a `questionText` field that doesn't exist in the actual type.

The code itself is internally consistent (client, types, and server all agree on `kind`/`granted`), so this is a plan documentation error rather than a runtime bug. But if someone implements from the plan rather than the code, they'll create a breaking mismatch.

**Suggested fix:** Update the plan's WS protocol section to match the actual types in `shared/types.ts`.

---

### 6. `result` event: session marked completed but process may still be running

**Severity:** Impl-note
**Section:** Implementation Steps / Step 4: End-to-End Smoke Test

In `stream-parser.ts:277-292`, when a `result` event arrives, the node is immediately set to `completed`. But the Claude CLI process may still be flushing stdout/stderr or doing cleanup. The `proc.exited` handler in `session.ts:112-125` could then fire and set the node to `crashed` (if exit code is non-zero) even though the `result` event already arrived successfully. This creates a race condition where a successfully completed session could briefly show as completed then flip to crashed.

**Suggested fix:** During implementation, check in the `proc.exited` handler whether `nodeState` is already `completed` before overwriting to `crashed`. The current code doesn't gate on this.

---

### 7. No backpressure on terminal buffer: streaming deltas arrive per-character

**Severity:** Impl-note
**Section:** Step 4: End-to-End Smoke Test

`content_block_delta` events with `text_delta` produce individual `lines.push(delta.text)` calls in the stream parser. These deltas are often single characters or small fragments. Each delta triggers a `broadcastTerminal` call, which sends a WebSocket message and causes a Zustand state update + React re-render. During fast streaming, this could produce hundreds of updates per second.

The client-side `useTerminal` store creates a new `Map` on every `appendLines` call (`new Map(state.buffers)`), and TerminalPeek re-renders for each. The plan's smoke test should explicitly check for performance under fast streaming.

**Suggested fix:** During implementation, consider batching terminal lines on a short interval (16-50ms) before broadcasting, or coalescing deltas in the stream parser into complete lines before emitting. The `plan.md` already mentions frame-aligned batching for graph updates but this hasn't been applied to terminal data.

---

### 8. Idle timer fires for completed sessions if `result` event doesn't arrive

**Severity:** Impl-note
**Section:** Bug 3: `model_usage_metrics` Events Not Handled (tangential)

If the Claude CLI process exits abnormally (crash, SIGKILL) without emitting a `result` event, the `pipeFrom` function's `finally` block clears the idle timer. However, there's a window: the stream reader loop ends (returns `done: true`), but `proc.exited` may not have resolved yet. If the exit code is non-zero, the session gets marked `crashed`. If the exit is clean (code 0) but no `result` event was emitted, the session stays in `running` state forever. The idle timer would eventually catch this, but only after the `pipeFrom` finally block has already cleared it.

**Suggested fix:** During implementation, after the stream reader loop ends (stdout closes), check whether a `result` event was received. If not, mark the session as needing attention.

---

### 9. Plan misses that `AskUserQuestion` won't fire with `--dangerously-skip-permissions`

**Severity:** Low
**Section:** Bug 2 / Step 4: End-to-End Smoke Test

The smoke test plan says to "Test input during a `needs-human` state (when Claude asks a question)." With `--dangerously-skip-permissions` enabled on all sessions, Claude Code runs tools autonomously and is unlikely to use `AskUserQuestion`. The human-needed detection for questions may be untestable in the current permission model.

This doesn't affect architecture but means the smoke test step is unrealistic and may lead to false confidence that the input pipeline works when it hasn't actually been exercised.

**Suggested fix:** Note in the smoke test that testing `needs-human` question flow requires either: (a) removing `--dangerously-skip-permissions` on a test session, or (b) crafting a prompt that forces Claude to use `AskUserQuestion` even in full-auto mode (which is rare but possible).

---

### 10. `model_usage_metrics` fix is straightforward but incomplete

**Severity:** Low
**Section:** Bug 3: `model_usage_metrics` Events Not Handled

The plan correctly identifies `model_usage_metrics` as noisy. The suggested fix (silently ignore or extract token counts) is fine. However, the plan should also note other events that fall through to the `default` case. Claude CLI's stream-json output includes event types like `content_block_start`, `content_block_stop`, `message_start`, `message_stop`, and `message_delta` that are part of the Anthropic streaming protocol. These will all produce `[event_type] {...}` noise in the terminal.

**Suggested fix:** Instead of adding individual cases, consider inverting the logic: only broadcast to terminal for known, display-worthy event types, and silently ignore everything else. Add a `Set` of known-noisy types to suppress.

---

## Summary Table

| # | Severity | Finding |
|---|----------|---------|
| 1 | Low | Bug 1 (containerRef) is already fixed in code; plan is stale |
| 2 | Must-fix | One-shot sessions silently discard stdin input |
| 3 | Medium | `--verbose` flag may produce non-JSON stdout; needs verification |
| 4 | Must-fix | Missing `--input-format stream-json` on one-shot blocks future input |
| 5 | Must-fix | Plan documents wrong field names (`type`/`allow` vs actual `kind`/`granted`) |
| 6 | Impl-note | Race between `result` event and `proc.exited` can flip completed to crashed |
| 7 | Impl-note | Per-character deltas cause high-frequency renders; needs batching |
| 8 | Impl-note | Idle timer cleared before exit code checked; clean exit without `result` = stuck |
| 9 | Low | Smoke test for `needs-human` unrealistic with `--dangerously-skip-permissions` |
| 10 | Low | Multiple Anthropic streaming event types hit the noisy `default` case, not just `model_usage_metrics` |
