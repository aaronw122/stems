# Review: Get Terminal Connected to Claude CLI
**Reviewer:** Frontend Integration (React + Zustand + React Flow + real-time data rendering)
**Date:** 2026-02-28
**Plan file:** `notes/2026-02-28-terminal-claude-connection.md`

---

## Summary

The plan identifies three bugs and proposes five implementation steps. After cross-referencing every claim against the actual source code, I found that Bug 1 (containerRef) has already been fixed in the codebase — the plan is stale on that point. Bug 2 (interactive mode) is a genuine open question that needs manual verification. Bug 3 (noisy events) is valid. Beyond what the plan covers, I found several issues in the data flow between server and frontend that would affect the end-to-end connection this plan is trying to establish.

---

## Findings

### 1. [Must-fix] Bug 1 is already fixed — plan is stale and will cause confusion

**Section:** Bug 1: `containerRef` Not Passed to TerminalPeek

The plan claims `App.tsx` does not pass `containerRef` to `TerminalPeek`, but the actual code at `src/App.tsx:17-18` already creates `canvasContainerRef`, attaches it to the wrapper div at line 164, and passes it to `TerminalPeek` at line 206. The plan's "Current (broken)" code does not match reality.

If someone follows this plan literally, they will either create a duplicate ref (harmless but confusing) or waste time trying to "fix" something that is not broken.

**Fix:** Remove Bug 1 and Step 1 from the plan, or mark them as already resolved. Update the "Current State" section to reflect the actual code.

---

### 2. [Must-fix] `send_input` payload shape mismatch between client and server

**Section:** (Not explicitly covered in the plan — gap in the plan's bug analysis)

The plan says the input pipeline works: "user types -> `send_input` WS msg -> `sendInput()` writes JSON to Claude stdin." But there is a contract mismatch that would cause input to silently fail.

In `src/App.tsx:142-153`, `handleTerminalInput` sends:
```ts
{ type: 'send_input', nodeId, payload: { kind: 'text_input', text } }
```

In `server/index.ts:226-239`, the handler switches on `payload.kind` and for `text_input` calls `sendInput(nodeId, payload.text)`.

In `server/session.ts:180-196`, `sendInput` checks `session.interactive`:
- If interactive: formats as `JSON.stringify({ type: 'user_message', content: text })` + newline
- If not interactive: sends raw `text + '\n'`

This pipeline looks correct for **text_input**. However, there is a subtler problem: the `TerminalPeek` UI **only ever sends `text_input`** payloads. There is no UI path that produces `question_answer` or `permission` payloads. When Claude uses `AskUserQuestion` (detected in `stream-parser.ts:244`), the node transitions to `needs-human` with `humanNeededType: 'question'`, but TerminalPeek does not render any special UI for this state — it just shows the same freeform text input.

This means the `question_answer` and `permission` payload kinds in the `SendInputPayload` type are dead code. The plan's WS protocol section (inherited from `plan.md`) describes contextual UI ("free-text answer field for question prompts, approve/deny buttons for permission prompts") that does not exist.

This is not a blocker for basic text input to work, but it means the human-needed flow described in the plan and architecture is disconnected from the actual UI. If Claude asks a question via `AskUserQuestion`, the user can still type a response, and it will reach Claude as a `text_input` — but the stream-json format expects a specific response structure for `AskUserQuestion`, not a raw `user_message`.

**Fix:** Either:
(a) Document this as a known limitation in the plan — `text_input` is the only input mode for v1, and contextual question/permission UI is deferred. Verify that Claude CLI accepts a regular `user_message` as a response to `AskUserQuestion`.
(b) Add this as a Step 5 sub-item: wire `humanNeededType` state from node data into `TerminalPeek` so it can render appropriate UI.

---

### 3. [Medium] Node state not cleared when interactive session receives first input

**Section:** Step 2 / interactive mode flow

When a feature is spawned interactively (empty prompt), `spawnSession` in `session.ts:92` sets `nodeState: 'running'`. The stream parser starts the idle timer immediately (`pipeFrom` at line 348 calls `resetIdleTimer`). Since there is no prompt, Claude CLI emits nothing — there will be no events to reset the idle timer. After 2 minutes, the node will transition to `needs-human` with reason "No activity for 2 minutes."

This is actually correct behavior in one sense (the user needs to type something), but the UX is misleading: the node goes from `running` to `needs-human` (idle) before the user has even had a chance to type their first message. The plan mentions adding a "Type your first message to start" hint in Step 5, which is the right direction, but the idle timeout firing before the user acts is a separate issue.

**Fix:** For interactive sessions, do not start the idle timer until the first `user_message` has been sent to stdin. Add this to the plan as an explicit consideration in Step 2 or Step 5.

---

### 4. [Medium] Terminal buffer is not backfilled when subscribing to an already-running session

**Section:** Step 4: End-to-End Smoke Test / terminal rendering

The plan's smoke test includes: "click to peek, see live Claude output." But the terminal subscription flow has a gap.

When the user clicks a node, `App.tsx:36` sends `subscribe_terminal`. The server (`state.ts:116`) adds the WS client to the subscription set. From that point forward, new `terminal_data` messages will be forwarded.

However, any output that arrived **before** the subscription is lost. The server-side terminal buffer exists (`state.ts:17-27`, `appendTerminalLines`), but `subscribeTerminal` does not replay the buffer to the newly subscribing client. If a one-shot subtask runs quickly and completes before the user clicks on it, the terminal will show "Waiting for output..." despite the session having finished.

The plan does not mention this gap. During the smoke test (Step 4 item 7: "Test subtask spawning with a prompt (one-shot mode)"), a fast subtask could complete before the user peeks at it, producing a confusing empty terminal.

**Fix:** In `state.ts:subscribeTerminal`, after adding the WS client to the subscription set, replay the existing buffer:
```ts
const existingLines = terminalBuffers.get(nodeId);
if (existingLines && existingLines.length > 0) {
  ws.send(JSON.stringify({ type: 'terminal_data', nodeId, lines: existingLines }));
}
```
Add this as a bug to the plan or as a Step 3.5.

---

### 5. [Medium] `clearHumanNeeded` fires on every non-error event, masking the question state

**Section:** Step 4 / human-needed flow

In `stream-parser.ts:185-187`, every non-error event calls `clearHumanNeeded()`. This means if Claude emits `AskUserQuestion` (tool_use event at line 244, which calls `setHumanNeeded`), and then immediately emits a `content_block_delta` or any other event, the human-needed state gets cleared in the very next event processing cycle.

In a typical Claude stream, `tool_use` events are followed by `tool_result` events. So the sequence is:
1. `tool_use` (AskUserQuestion) -> sets `needsHuman: true`
2. `tool_result` (AskUserQuestion) -> `clearHumanNeeded` fires, sets `needsHuman: false`

The red flash on the node would appear for only a fraction of a second — functionally invisible to the user. The plan's Step 4 item 8 ("Test input during a `needs-human` state") would likely fail because the state would be cleared almost instantly.

**Fix:** `clearHumanNeeded` should not fire unconditionally. It should only clear when specific events indicate the user's response has been processed (e.g., when a `user_message` is sent, or when a new `assistant` turn begins after a `needs-human` state). Add this as a bug in the plan. One approach: only call `clearHumanNeeded` on `assistant` events, which indicate Claude has received input and started a new turn.

---

### 6. [Medium] One-shot sessions: `sendInput` writes raw text, but stdin is piped

**Section:** Step 2 / input pipeline

For one-shot sessions (non-interactive, `session.interactive === false`), `sendInput` in `session.ts:193` writes `text + '\n'` to stdin. But one-shot sessions are spawned with the prompt as a positional argument (`args.push(prompt)` at line 76), and the `--input-format stream-json` flag is only added for interactive sessions.

This means one-shot sessions receive the prompt via CLI arg and start processing immediately. If the user sends input to a one-shot session (e.g., answering a question Claude asks during execution), the raw text written to stdin may not be interpreted correctly by Claude CLI in `-p` mode without `--input-format`. Claude's `-p` mode may ignore stdin entirely when a prompt argument is provided, or it may read it as plain text appended to the conversation.

The plan does not address how input works for one-shot sessions. The smoke test (Step 4 item 8) only mentions `needs-human` testing generically without distinguishing interactive vs. one-shot.

**Fix:** Add to the plan: verify whether one-shot (`-p "prompt"`) sessions accept additional input on stdin at all. If they do, determine the expected format (plain text? stream-json?). If they do not, either:
(a) Make all sessions interactive (always use `--input-format stream-json`, send the initial prompt as a `user_message` on stdin).
(b) Disable the input field in TerminalPeek for one-shot sessions (or show a "read-only" indicator).

---

### 7. [Low] Plan references `--include-partial-messages` from plan.md but session.ts does not use it

**Section:** Current State / spawn args

`plan.md:23` shows the canonical spawn command as:
```
claude -p --input-format stream-json --output-format stream-json --include-partial-messages --add-dir /path/to/repo
```

But `session.ts:62` uses:
```ts
[CLAUDE_BIN, '-p', '--verbose', '--output-format', 'stream-json', '--dangerously-skip-permissions']
```

Two differences:
1. `--include-partial-messages` is absent. Without it, `content_block_delta` events may not be emitted, meaning the terminal would not show streaming text — it would only show the complete `assistant` message once the entire turn is finished. This directly affects the plan's goal of "see live Claude output streaming in real-time."
2. `--verbose` is present but not mentioned in `plan.md`. This is harmless but worth noting for consistency.

**Fix:** If `--include-partial-messages` is required for streaming deltas, add it to the spawn args in `session.ts`. If `--verbose` is what enables the same behavior in newer Claude CLI versions, document that in the plan. Either way, reconcile the spawn flags between `plan.md` and `session.ts`.

---

### 8. [Impl-note] `content_block_delta` handling accumulates text for title extraction but may receive partial UTF-8

In `stream-parser.ts:206-213`, `content_block_delta` events are processed and their text is passed to `tryExtractTitle`. Since the stream is decoded from `Uint8Array` chunks in `pipeFrom` with `{ stream: true }`, partial UTF-8 sequences are handled correctly at the byte level. However, individual stream-json events from Claude CLI should always be complete JSON objects on a single line, so this is unlikely to be an issue in practice. Noting for awareness during implementation if unusual characters appear truncated.

---

### 9. [Impl-note] Terminal store creates a new Map on every `appendLines` call

In `useTerminal.ts:16`, every `appendLines` call creates `new Map(state.buffers)`. During rapid streaming (many `content_block_delta` events per second), this creates significant GC pressure. The plan should note that if terminal rendering feels janky during fast streams, this is the first place to look. A potential optimization: batch terminal updates on the client side (aggregate lines received within a 16ms window before calling `appendLines`).

---

### 10. [Impl-note] `--verbose` flag may produce additional event types beyond what the parser handles

`session.ts:62` includes `--verbose`. The `--verbose` flag may cause Claude CLI to emit additional event types (e.g., `model_usage_metrics`, which Bug 3 already identifies, but also potentially `hook_started`, `hook_response`, `config`, etc.). The default case in the stream parser (line 322) stringifies these to the terminal, which is the noise Bug 3 describes. The fix in Step 3 should handle not just `model_usage_metrics` but establish a pattern for silently ignoring all diagnostic event types.

---

## Plan Completeness

The plan covers the critical path but has gaps in the data flow from server to frontend:

1. **Missing: Terminal buffer replay on subscribe** (Finding 4) — without this, the terminal appears empty for any session that produced output before the user opened the peek panel.

2. **Missing: Input mode limitations** (Finding 2) — the plan says the input pipeline is wired up but does not acknowledge that only `text_input` is implemented in the UI. The `question_answer` and `permission` paths are dead code.

3. **Missing: One-shot input behavior** (Finding 6) — the plan does not clarify whether or how input works for non-interactive sessions.

These three gaps together mean that the "End-to-End Smoke Test" (Step 4) is likely to surface issues not anticipated by the plan. The test steps are well-designed but the plan should prepare for the specific failure modes identified above.

---

## Verdict

The plan is directionally sound but Bug 1 is already fixed (stale), and the three medium-severity findings (4, 5, 6) represent real architectural gaps that would cause confusion or broken behavior during the smoke test. Addressing the buffer replay (Finding 4) and the `clearHumanNeeded` race (Finding 5) before implementation would prevent wasted debugging time during Step 4.
