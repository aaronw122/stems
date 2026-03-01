# Review: Get Terminal Connected to Claude CLI

**Reviewer:** Systems/IPC Architect
**Plan file:** `notes/2026-02-28-terminal-claude-connection.md`
**Round:** R1 Agent 1
**Date:** 2026-02-28

---

## Summary

The plan identifies three bugs preventing end-to-end terminal-to-Claude connectivity and proposes incremental fixes with a smoke test. After reviewing the plan against the actual codebase, I found that **Bug 1 (containerRef) has already been fixed** in the implementation. The plan is otherwise structurally sound but has several gaps in the input protocol, session lifecycle, and error handling that would cause rework if discovered during implementation.

---

## Findings

### 1. [Must-fix] Plan Bug 1 Is Already Resolved -- Plan Is Stale

**Section:** Bug 1: `containerRef` Not Passed to TerminalPeek

**Issue:** The plan claims `containerRef` is not passed to `TerminalPeek` and proposes a fix. However, the current `src/App.tsx` (lines 18, 164, 206) already:
- Creates `canvasContainerRef` via `useRef<HTMLDivElement>(null)` (line 18)
- Attaches it to the wrapper div (line 164)
- Passes it as `containerRef={canvasContainerRef}` to `<TerminalPeek>` (line 206)

This bug is already fixed. Step 1 of the implementation plan is a no-op.

**Impact:** Without correcting this, an implementer wastes time verifying and re-applying a fix that already exists, or worse, introduces a duplicate ref. The plan should be updated to reflect current state and re-sequence remaining steps.

**Fix:** Remove Bug 1 and Step 1 from the plan. Re-number steps. Add a note that this was resolved in the floating terminal window PR.

---

### 2. [Critical] `send_input` Payload Mismatch Between Client and Server

**Section:** Not covered in plan (gap)

**Issue:** There is a contract mismatch in the `send_input` message between client and server that the plan does not identify.

**Client side** (`src/App.tsx`, line 148-149):
```ts
payload: { kind: 'text_input', text }
```

**Server side** (`server/index.ts`, lines 226-239) expects payloads with field `kind`, matching:
- `kind: 'question_answer'` -- reads `payload.answer`
- `kind: 'permission'` -- reads `payload.granted`
- `kind: 'text_input'` -- reads `payload.text`

**Type definition** (`shared/types.ts`, lines 56-59) uses `SendInputPayload` with `kind` field.

This part actually matches correctly. However, there is a deeper issue: **for interactive sessions, the server's `sendInput()` wraps the text in `{ type: 'user_message', content: text }` JSON** (session.ts line 190). But for one-shot sessions (line 193), it writes `text + '\n'` raw to stdin. This means **if a user sends input to a one-shot session** (e.g., answering a question from Claude during a subtask), the raw text will be written to stdin of a process that was started *without* `--input-format stream-json`. Claude CLI in one-shot mode with `--output-format stream-json` but without `--input-format stream-json` may not accept any stdin at all, or may interpret raw text unpredictably.

**Impact:** Any human interaction with a one-shot subtask (answering questions, responding to errors) would silently fail or produce garbled input to Claude. Since the plan specifically lists "Test input during a `needs-human` state (when Claude asks a question)" in Step 4, this is an architectural gap that would be discovered during testing but requires understanding the two-mode stdin protocol.

**Fix:** Add this as a Bug 4 in the plan. Either:
1. Always use `--input-format stream-json` for all sessions (simplest -- unify the protocol), or
2. Document that one-shot sessions cannot receive user input and disable the input field in the terminal UI for non-interactive sessions, or
3. Detect when a one-shot session needs human input, kill it, and re-spawn as interactive with the conversation so far.

---

### 3. [Must-fix] No `--include-partial-messages` Flag in Spawn Args

**Section:** Current State / Bug 2 (relates to spawn args in `server/session.ts`)

**Issue:** The `plan.md` architecture section (line 21-25) explicitly specifies `--include-partial-messages` as part of the Claude CLI invocation:
```
claude -p --input-format stream-json \
          --output-format stream-json \
          --include-partial-messages \
          --add-dir /path/to/repo
```

However, the actual `session.ts` spawn args (line 62) do NOT include `--include-partial-messages`:
```ts
const args = [CLAUDE_BIN, '-p', '--verbose', '--output-format', 'stream-json', '--dangerously-skip-permissions'];
```

Without `--include-partial-messages`, streaming text deltas (`content_block_delta` events) may not be emitted by the CLI. The stream parser has a dedicated handler for `content_block_delta` (stream-parser.ts line 205-213), which means it was designed to process these events. If they never arrive, the terminal will only show complete `assistant` messages after they finish generating -- no streaming output.

**Impact:** The core UX promise of "see live Claude output streaming in real-time" (plan Step 4, point 5) would fail silently. Text would appear all at once when the assistant turn completes rather than streaming character-by-character.

**Fix:** Add `--include-partial-messages` to the args array in `session.ts`, and note this in the plan as a missing flag. This should be part of Step 2 or added as its own step.

---

### 4. [Medium] `--verbose` Flag May Produce Non-JSON Noise on stdout

**Section:** Current State / `server/session.ts` line 62

**Issue:** The spawn args include `--verbose` alongside `--output-format stream-json`. The `--verbose` flag is documented to increase logging verbosity. If verbose output is written to stdout (rather than stderr), it would intersperse non-JSON lines with the stream-json output. The stream parser's `parseStreamLine` (stream-parser.ts line 72-81) would silently drop these non-JSON lines (returns `null`), but this could cause issues:
1. Verbose log lines could split a JSON line mid-buffer, corrupting the newline-delimited JSON parsing
2. Useful verbose output would be silently swallowed

The plan doesn't mention `--verbose` at all, even though it's present in the current spawn args.

**Fix:** Verify whether `--verbose` output goes to stderr or stdout. If stdout, remove it from the args or redirect. If stderr, it's fine -- stderr is already drained separately. Add a note in the plan.

---

### 5. [Medium] Plan Missing: Terminal Buffer Replay on Subscribe

**Section:** Implementation Steps (gap)

**Issue:** When a user clicks on a node to open the terminal, `App.tsx` sends `subscribe_terminal`. The server adds the WebSocket to the subscription set (`state.ts` line 116-123). However, the server does NOT replay the existing terminal buffer to the newly subscribed client. The server maintains a terminal buffer (`terminalBuffers` in state.ts, up to 200 lines), but `subscribeTerminal()` only adds the client to the subscriber set -- it doesn't send buffered history.

This means if you:
1. Spawn a feature (terminal starts streaming)
2. Click away (deselect node, triggering unsubscribe)
3. Click back on the node (resubscribe)

The terminal would appear empty. Only new events arriving after resubscription would appear. The client-side `useTerminal` store retains its buffer (line 54 in TerminalPeek.tsx reads from `buffers.get(nodeId)`), so data persists in the client store even across unsubscribes. But this only works for the current browser session -- a page reload would lose all terminal history since the server doesn't replay on subscribe.

**Impact:** After any page reload or new browser tab connection, all running sessions would show empty terminals until new output arrives. This is particularly bad for long-running sessions.

**Fix:** Add to the plan: modify `subscribeTerminal` in `server/index.ts` to immediately send the buffered terminal lines to the subscribing client. Something like:
```ts
case 'subscribe_terminal': {
  subscribeTerminal(msg.nodeId, ws);
  // Replay buffer to new subscriber
  const buffered = getTerminalLines(msg.nodeId);
  if (buffered.length > 0) {
    ws.send(JSON.stringify({ type: 'terminal_data', nodeId: msg.nodeId, lines: buffered }));
  }
  break;
}
```

---

### 6. [Medium] Process Exit Without `result` Event Leaves Node in `running` State

**Section:** Implementation Steps / Step 4 (relates to `server/session.ts` exit handler)

**Issue:** The `proc.exited` handler in session.ts (lines 112-125) only updates node state if `code !== 0` (sets to `crashed`). If the process exits with code 0 but the `result` event was never received (e.g., stdout pipe closed before the final JSON line was flushed, or the process was killed gracefully), the node stays in `running` state forever.

The stream parser's `result` event handler (stream-parser.ts line 261-293) is the only path that sets `nodeState: 'completed'`. But if the process exits cleanly without emitting `result` (possible if Claude CLI is killed mid-stream, or if there's a buffering issue), there's no fallback.

**Impact:** Orphaned `running` nodes with no live process. The idle timeout (2 minutes) would eventually set `needs-human: idle`, which is misleading since the process is already dead.

**Fix:** Add to the plan: the `proc.exited` handler should check whether the node is still in `running` state after exit code 0, and if the `result` event wasn't received, transition to `completed` (or `crashed` with a note). The stream parser's `pipeFrom` already has a `finally` block (line 381) that clears the idle timer -- this could also set a "stream ended" flag that the exit handler checks.

---

### 7. [Medium] Plan Doesn't Address `clearHumanNeeded` on Every Non-Error Event

**Section:** Not covered (existing behavior in `stream-parser.ts`)

**Issue:** The stream parser calls `clearHumanNeeded()` on EVERY non-error event (line 185-187). This means if Claude asks a question via `AskUserQuestion` (which sets `needs-human: question`), the very next streaming event -- which could be a `content_block_delta` arriving milliseconds later in the same turn -- would immediately clear the `needs-human` state before the user has a chance to respond.

The sequence would be:
1. `tool_use` event with `AskUserQuestion` -- sets `needs-human: question` + red flash
2. Next `content_block_delta` or any other event -- clears `needs-human`, removes red flash
3. User never sees the red flash, or sees it for a fraction of a second

**Impact:** The human-needed detection feature would be functionally broken for questions. The plan's Step 4 test "Test input during a `needs-human` state" would fail.

**Fix:** Add this as a bug in the plan. The fix is to NOT clear `needs-human` automatically on stream events. Instead, clear it only when the user actually responds (i.e., when a `send_input` message is received for the node). The `clearHumanNeeded` call should be moved from `processEvent` to the `send_input` handler in `server/index.ts`.

---

### 8. [Low] Plan Doesn't Mention `--add-dir` Flag From `plan.md` Architecture

**Section:** Current State / Two spawn modes

**Issue:** The `plan.md` architecture section shows `--add-dir /path/to/repo` in the CLI invocation pattern, and explicitly notes "Bun.spawn must set `cwd` to the repo path. `--add-dir` provides additional directory access but does NOT set the working directory." The current `session.ts` sets `cwd` correctly but doesn't use `--add-dir`. This may be intentional (since `cwd` is set), but the plan should acknowledge the deviation from the architecture spec.

**Fix:** Note in the plan whether `--add-dir` is needed in addition to `cwd`, or explicitly state it was deemed unnecessary.

---

### 9. [Impl-note] Idle Timer Fires During Normal Tool Execution Gaps

**Section:** Stream parser idle timeout (referenced in Bug 3 area)

**Issue:** The 120-second idle timer resets on every stream event. But during complex tool executions (e.g., running a long test suite, a slow build), Claude CLI may not emit events for over 2 minutes while waiting for the tool result. This would trigger a false `needs-human: idle` state.

**Fix:** During implementation, consider pausing the idle timer between `tool_use` and `tool_result` events, or increasing the timeout, or making it configurable.

---

### 10. [Impl-note] `useTerminal` Store Creates New Map on Every `appendLines` Call

**Section:** Related to performance of terminal streaming

**Issue:** In `useTerminal.ts` (lines 16-27), every `appendLines` call creates a new `Map` via `new Map(state.buffers)`. During rapid streaming (content_block_delta events arrive at high frequency), this generates significant GC pressure. The plan mentions "Batch property updates on a frame-aligned interval" in the architecture (plan.md line 106) but neither the plan nor the current implementation uses batching for terminal data.

**Fix:** During implementation, consider debouncing/batching terminal appends on a requestAnimationFrame boundary, or using a mutable map outside React state with a version counter to trigger re-renders.

---

### 11. [Impl-note] `dangerouslySetInnerHTML` with `ansi-to-html` Output

**Section:** TerminalPeek rendering

**Issue:** `TerminalPeek.tsx` line 221-224 uses `dangerouslySetInnerHTML` to render ANSI-converted HTML. The `ansi-to-html` library converts ANSI escape codes to `<span>` tags with inline styles, but if Claude's output contains HTML-like text (e.g., discussing `<script>` tags), it could be interpreted as HTML. This is an XSS vector since the terminal displays arbitrary Claude output.

**Fix:** During implementation, ensure `ansi-to-html` is configured to escape HTML entities in the input text (it does by default, but verify), or use a sanitizer.

---

### 12. [Low] Plan Step 2 Verification Doesn't Test the Actual JSON Format

**Section:** Step 2: Verify Claude CLI Interactive Mode

**Issue:** Step 2 says to "Send a JSON message on stdin and confirm output flows back" but doesn't specify the exact JSON format to test. The `sendInput` function in `session.ts` (line 190) sends `{ type: 'user_message', content: text }`. If the actual Claude CLI stream-json input format uses a different schema (e.g., `{ type: 'user_turn', message: { role: 'user', content: [...] } }`), the interactive mode would silently fail.

**Fix:** Update Step 2 to explicitly document the verified JSON input format and update `sendInput()` if it differs. Include the exact command and JSON payload to test.

---

## Overall Assessment

The plan correctly identifies that the core pipeline is structurally complete and that targeted fixes should unblock end-to-end connectivity. However, it underestimates the gap: Bug 1 is already fixed, Bug 2 needs to be tested with the actual JSON input format, Bug 3 is correctly identified but low priority, and there are at least three additional issues (findings 2, 3, 7) that would block the end-to-end smoke test.

**Recommended priority ordering for implementation:**
1. Add `--include-partial-messages` flag (Finding 3) -- without this, streaming UX is broken
2. Fix `clearHumanNeeded` race (Finding 7) -- without this, human-needed detection is broken
3. Address one-shot stdin protocol (Finding 2) -- without this, subtask interaction is broken
4. Handle `model_usage_metrics` noise (plan Bug 3) -- cosmetic
5. Add terminal buffer replay (Finding 5) -- improves reliability across reloads
6. Fix exit-without-result lifecycle gap (Finding 6) -- prevents orphaned nodes
