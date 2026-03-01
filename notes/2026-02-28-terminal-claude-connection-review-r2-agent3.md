# Review (R2): Get Terminal Connected to Claude CLI
**Reviewer:** Frontend Integration (React + Zustand + React Flow + real-time data rendering)
**Date:** 2026-02-28
**Plan file:** `notes/2026-02-28-terminal-claude-connection.md` (rev 2)
**Prior review:** `notes/2026-02-28-terminal-claude-connection-review-r1-agent3.md`

---

## R1 Issue Resolution Status

### R1 Finding 1 (Must-fix): Bug 1 was stale / already fixed — RESOLVED

The stale Bug 1 about `containerRef` has been entirely removed from rev 2. The plan now opens with six newly identified bugs. No residue of the old Bug 1 remains.

### R1 Finding 2 (Must-fix): `send_input` payload shape mismatch / dead code for question_answer and permission — PARTIALLY RESOLVED

The rev 2 plan does not directly acknowledge this finding, but Bug 3 ("One-Shot Sessions Silently Discard stdin Input") and Bug 2 ("clearHumanNeeded Fires on Every Non-Error Event") together address parts of it. The plan still does not acknowledge that the `question_answer` and `permission` payload kinds in `SendInputPayload` are dead code — no UI path produces them. The `send_input` handler in `server/index.ts:228-238` switches on all three kinds, but TerminalPeek always sends `text_input`.

This is acceptable for v1 since text_input reaches Claude as a `user_message` which should work as a generic response. But the plan should acknowledge this is a known v1 limitation rather than leaving it ambiguous. Severity remains **Low** — not a blocker.

### R1 Finding 3 (Medium): Idle timer fires before user acts on interactive sessions — NOT ADDRESSED

The plan's Bug 5 covers the interactive mode question ("does `-p` without a prompt arg work?") but does not address the idle timer problem. In `stream-parser.ts:348`, `pipeFrom` calls `resetIdleTimer()` immediately when the stream begins. For interactive sessions (no prompt), Claude emits nothing because it's waiting for the first `user_message`. After 2 minutes of silence, the idle timer fires and transitions the node to `needs-human` with reason "No activity for 2 minutes" — before the user has done anything.

Step 8 ("UX Polish") mentions adding a "Type your first message to start" hint, which is the right direction but does not address the idle timeout race. The idle timer should not start until the first `user_message` has been sent for interactive sessions.

**Severity: Medium** — The user opens a feature, sees the terminal waiting, and within 2 minutes the node turns red with an idle warning. Misleading but not data-losing.

### R1 Finding 4 (Medium): Terminal buffer not replayed on subscribe — RESOLVED

This is now Bug 4 in the rev 2 plan, with a clear fix description and implementation step (Step 4). The plan correctly identifies the gap and proposes replaying the buffered terminal lines when a new subscriber connects. Well handled.

### R1 Finding 5 (Medium): `clearHumanNeeded` fires on every non-error event — RESOLVED

This is now Bug 2 in the rev 2 plan. The proposed fix (move `clearHumanNeeded()` from `processEvent` to the `send_input` handler in `server/index.ts`) is the correct approach. See Finding 1 below for a nuance in the implementation.

### R1 Finding 6 (Medium): One-shot sessions silently discard stdin input — RESOLVED

This is now Bug 3 in the rev 2 plan, with three fix options laid out clearly and a recommendation (Option 1: always use `--input-format stream-json`). Good.

### R1 Finding 7 (Low): `--include-partial-messages` missing — RESOLVED

This is now Bug 1 (Critical) in the rev 2 plan, elevated to the top priority. Correct.

### R1 Findings 8-10 (Impl-notes): — ACKNOWLEDGED

These were implementation notes, not plan-level issues. The rev 2 plan incorporates Bug 6 (handle `model_usage_metrics`) which covers Finding 10's concern about noisy events. The GC pressure note (Finding 9) and partial UTF-8 note (Finding 8) remain valid impl-notes and appropriately weren't folded into the plan.

---

## New Findings in Rev 2

### 1. [Must-fix] `clearHumanNeeded` moved to `send_input` handler won't clear for non-interactive human-needed states

**Section:** Bug 2 fix / Step 2

The plan proposes removing `clearHumanNeeded()` from `processEvent` and adding it to the `send_input` handler in `server/index.ts`. This correctly prevents premature clearing when Claude asks a question.

However, this creates a new gap: `clearHumanNeeded` is also called for `humanNeededType: 'idle'` (set by the idle timer at `stream-parser.ts:141`) and `humanNeededType: 'error'` (set at `stream-parser.ts:303`). When the idle timeout fires and sets `needs-human: 'idle'`, the node stays in `needs-human` state even after Claude resumes activity (e.g., after the user sends input and Claude starts responding). The `send_input` handler clears it when the user types, which handles the idle case. But for error-typed `needs-human` — where the stream parser sets it at line 303 and then also sets `nodeState: 'crashed'` — the `clearHumanNeeded` call in `send_input` would reset `nodeState` back to `'running'`, overwriting the `'crashed'` state.

The sequence:
1. `error` event -> `setHumanNeeded('error', ...)` + `updateNode({ nodeState: 'crashed' })`
2. User sends input -> `clearHumanNeeded()` -> `updateNode({ nodeState: 'running' })`
3. Node now shows as "running" when it actually crashed

**Fix:** In the `send_input` handler, only call `clearHumanNeeded()` if the node's `humanNeededType` is `'question'`, `'permission'`, or `'idle'` — not `'error'`. Alternatively, `clearHumanNeeded` itself should check whether `nodeState` is `'crashed'` and skip the state transition in that case.

---

### 2. [Must-fix] Step 4 (terminal buffer replay) has a client-side duplication risk

**Section:** Step 4 / Bug 4

The plan says: "replay the session's buffered terminal lines to the new subscriber" and "Ensure the client terminal store handles replayed content correctly (append, don't duplicate)."

The duplication concern is real but the plan doesn't specify how to prevent it. Here's the problem:

In `App.tsx:34-43`, the `subscribe_terminal` message is sent when `selectedNodeId` changes. But the WebSocket `onmessage` handler in `useWebSocket.ts:37-39` calls `appendLines` for every `terminal_data` message. If the server replays the buffer as `terminal_data` messages, and then live events continue arriving, the client will correctly append both — no duplication.

But there's a subtler scenario: if the user closes and reopens the terminal for the same node (clicks away and clicks back), `selectedNodeId` changes from `nodeId` -> `null` -> `nodeId`. The `useTerminal` store does **not** clear the buffer when a terminal is closed (and it shouldn't — that would lose data). So when the user reopens, the client already has the old lines in the Zustand store, and the server replays the buffer again, producing duplicate content.

**Fix:** The plan needs to specify one of:
(a) Use a distinct message type like `terminal_replay` (not `terminal_data`) and have the client replace (not append) the buffer when it receives a replay.
(b) Have the server track which lines have already been sent to each subscriber and only send new lines on re-subscribe.
(c) Have the client clear the terminal buffer for the node when sending `subscribe_terminal`, before the replay arrives.

Option (a) is cleanest. It requires adding `terminal_replay` to the `ServerMessage` union type in `shared/types.ts` and handling it in `useWebSocket.ts` with a `setLines` (replace) rather than `appendLines` (append) operation on the Zustand store. The Zustand store currently lacks a `setLines` method — it only has `appendLines` and `clear`.

---

### 3. [Medium] `--include-partial-messages` may not be a real Claude CLI flag

**Section:** Bug 1 (Critical) / Step 1

The entire plan hinges on `--include-partial-messages` as the fix for enabling streaming deltas. This flag is referenced from `plan.md` as part of the canonical spawn command. However, the actual Claude CLI help output should be verified. If this flag does not exist or has been renamed (e.g., `--stream` or `--partial`), Step 1 would fail immediately, and the critical fix would be blocked.

The plan's Step 5 ("Verify Claude CLI Interactive Mode") includes manual testing, but it tests the interactive mode flow, not specifically whether `--include-partial-messages` is a valid flag. If the flag is invalid, Claude CLI may emit an error on startup and exit immediately, which would be caught — but not until Step 5, after Steps 1-4 have already been implemented.

**Fix:** Move the CLI flag verification to before Step 1, or at minimum note that Step 1 should include a quick `claude --help | grep include-partial` check. If the flag doesn't exist, the plan needs a fallback strategy (e.g., perhaps `--verbose` already provides deltas, or a different flag is needed).

**Why Medium and not Critical:** If the flag doesn't exist, the error is immediately obvious (Claude CLI will reject the unknown flag) and the fix is to find the correct flag name. It won't cause silent wrong behavior or rework — just a blocked step that needs research.

---

### 4. [Medium] `--verbose` and `--include-partial-messages` may be redundant or conflicting

**Section:** Bug 1 / Step 1

The current spawn args in `session.ts:62` include `--verbose`. The plan proposes adding `--include-partial-messages`. If `--verbose` is what already enables `content_block_delta` events (or a superset that includes them), then adding `--include-partial-messages` is harmless but unnecessary. If the two flags interact (e.g., `--verbose` outputs to stderr while `--include-partial-messages` adds deltas to stdout stream-json), the plan should document the expected behavior.

The R1 review (Finding 10) noted this: "`--verbose` flag may produce additional event types beyond what the parser handles." The rev 2 plan incorporated Bug 6 (handle `model_usage_metrics`) but didn't reconcile whether `--verbose` already provides streaming deltas, making Bug 1's fix unnecessary.

**Fix:** Step 5 (manual verification) should test both with and without `--verbose` to determine what each flag contributes. Document the finding so future sessions don't re-investigate.

---

### 5. [Medium] No handling for WebSocket reconnection + terminal state

**Section:** Step 4 / Step 7

The plan addresses terminal buffer replay on subscribe but does not address what happens when the WebSocket disconnects and reconnects (which `useWebSocket.ts:48-57` handles automatically with exponential backoff).

On reconnect, the server sends a `full_state` message (`server/index.ts:342-348`), which syncs node states. But terminal subscriptions are per-connection — the old connection's subscriptions are lost. The client's `selectedNodeId` state persists across reconnects (it's in Zustand, not tied to the WebSocket), but the `useEffect` in `App.tsx:34-43` that sends `subscribe_terminal` only fires when `selectedNodeId` changes. If the user has a terminal open and the WebSocket drops and reconnects, the terminal subscription is not re-established, and live output stops flowing.

The client's Zustand terminal buffer retains the old lines, so the terminal doesn't go blank — but new output after reconnection is silently lost until the user closes and reopens the terminal.

**Fix:** Add a note in Step 4 or Step 8 that WebSocket reconnection should re-subscribe to the currently selected terminal. One approach: in `useWebSocket.ts`, after the `onopen` handler fires, send `subscribe_terminal` for any currently selected node. This requires `useWebSocket` to know about `selectedNodeId`, which it currently doesn't — so it would need to accept it as a parameter or access the graph store directly.

---

### 6. [Low] Step 3 Option 1 changes one-shot session behavior fundamentally

**Section:** Bug 3 / Step 3

If Option 1 is chosen (always use `--input-format stream-json`), one-shot sessions would no longer receive the prompt as a CLI positional arg. Instead, the prompt would be sent as a `user_message` JSON object on stdin after spawn. The plan notes this, but doesn't address a timing concern: there's a race between the process starting and the stdin write.

With `Bun.spawn`, the process starts immediately and stdin is writable immediately — so the race is unlikely to be a problem in practice. But if the initial `user_message` is sent before the CLI has finished initializing, it could be lost or cause unexpected behavior.

**Severity: Low / Impl-note** — Test during implementation. If the initial message gets lost, add a small delay or listen for a ready signal on stdout before sending.

---

### 7. [Impl-note] `content_block_delta` events arrive as individual text fragments — terminal rendering may look fragmented

The plan correctly identifies that `--include-partial-messages` (or equivalent) will enable `content_block_delta` events, and the stream parser pushes each delta's text as a separate terminal line (`lines.push(delta.text)` at `stream-parser.ts:209`). Each delta may be as small as a single token (a few characters).

In `TerminalPeek`, each line is rendered as a separate `<div>` element (line 219-224). If each delta is a single word, the terminal will show one word per line — visually very different from a normal terminal where text wraps naturally.

This is an implementation-time concern. The fix would be to accumulate delta text into the current line and only create a new line on `\n` characters, or to use CSS `display: inline` on the line divs. Noting for awareness during Step 1/Step 7 testing.

---

### 8. [Impl-note] `handleTerminalInput` trims whitespace, which may affect Claude CLI interaction

In `App.tsx:143`, `handleTerminalInput` trims the input: `const trimmed = input.trim()`. If the user intentionally needs to send whitespace-significant input (unlikely but possible), trimming would alter it. Additionally, empty-after-trim messages are silently dropped (`if (trimmed)`). This is fine for v1 but worth noting.

---

## Plan Completeness Assessment

The rev 2 plan is substantially improved over rev 1. It correctly identifies six real bugs, all verified against the actual source code. The bugs are ordered by severity and the implementation steps are well-sequenced.

**Gaps remaining:**
1. The `clearHumanNeeded` move to `send_input` has an edge case with error states (Finding 1 — must-fix)
2. Terminal buffer replay needs a deduplication strategy for close/reopen (Finding 2 — must-fix)
3. The `--include-partial-messages` flag should be verified before implementation begins (Finding 3 — medium)
4. WebSocket reconnection silently drops terminal subscriptions (Finding 5 — medium)
5. The idle timer race for interactive sessions (R1 Finding 3, still unaddressed — medium)

---

## Verdict

The plan has addressed the most critical R1 findings. Bug 1 (stale) was removed. The `clearHumanNeeded` race, terminal buffer replay, one-shot input handling, and `--include-partial-messages` flag are all now properly identified and planned for. The two must-fix items in this round are edge cases in the proposed fixes themselves — they represent refinements, not fundamental gaps. The plan is ready for implementation with the caveats above incorporated.
