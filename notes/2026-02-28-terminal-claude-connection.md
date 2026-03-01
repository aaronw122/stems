# Plan: Get Terminal Connected to Claude CLI (rev 4)

## Context

The Stems server-side and client-side code for Claude CLI integration is structurally complete — session spawning, stream-json parsing, WebSocket broadcasting, terminal rendering, and input handling are all implemented. But the terminal isn't actually connected to Claude. This plan identifies the bugs preventing it from working and outlines the fixes needed to get the end-to-end flow operational.

## Current State

**What exists:**
- Server spawns Claude CLI via `Bun.spawn` with `--output-format stream-json` (`server/session.ts`)
- Stream parser handles all event types: `assistant`, `content_block_delta`, `tool_use`, `tool_result`, `result`, `error` (`server/stream-parser.ts`)
- WebSocket server routes messages between client and server (`server/index.ts`)
- Terminal store buffers output per node (`src/hooks/useTerminal.ts`)
- TerminalPeek renders output with ANSI colors and provides input (`src/components/panels/TerminalPeek.tsx`)
- Input pipeline: user types → `send_input` WebSocket msg → `sendInput()` writes JSON to Claude stdin

**Two spawn modes:**
- **Interactive** (features, empty prompt): `claude -p --input-format stream-json --output-format stream-json --dangerously-skip-permissions` — waits for user's first message on stdin
- **One-shot** (subtasks, has prompt): `claude -p --output-format stream-json --dangerously-skip-permissions "the prompt"` — runs immediately

## Bugs Found

### Bug 1: `--include-partial-messages` Missing from Spawn Args (Critical)

**File:** `server/session.ts`

The `plan.md` architecture specifies `--include-partial-messages` in the Claude CLI invocation, but `session.ts` does not include this flag in the spawn args. Without it, `content_block_delta` events are never emitted by the CLI. The stream parser has a dedicated handler for `content_block_delta` (stream-parser.ts), but these events never arrive — so the terminal only shows complete `assistant` messages after the entire turn finishes. **Real-time streaming will not work without this flag.**

**Fix:** Add `'--include-partial-messages'` to the args array in `session.ts` for both interactive and one-shot spawn modes.

### Bug 2: `clearHumanNeeded` Fires on Every Non-Error Event (Must-fix)

**File:** `server/stream-parser.ts:185-187`

In `processEvent`, every non-error event calls `clearHumanNeeded()`. This means if Claude emits an `AskUserQuestion` (tool_use event, which calls `setHumanNeeded`), and then immediately emits any subsequent event (e.g., `content_block_delta`), the `needs-human` state gets cleared in the very next event processing cycle — before the user has a chance to respond.

**Sequence:**
1. `tool_use` (AskUserQuestion) → `setHumanNeeded('question', ...)` → `needsHuman: true`
2. Next event (any type) → `clearHumanNeeded()` → `needsHuman: false`
3. User never sees the question state in the UI

**Fix:** Remove the blanket `clearHumanNeeded()` from `processEvent` and replace with differentiated clearing logic:

- **Idle recovery:** Clear `idle`-type needs-human on any incoming stream activity (in `processEvent`). This handles the case where a session resumes output after being idle — no user action needed.
- **Question/permission:** Clear `question` or `permission`-type needs-human only in the `send_input` handler in `server/index.ts`, so it clears only when the user actually responds.
- **Session complete:** Clear all needs-human unconditionally on `result` event (session is done, no further human action possible).
- **Never clear `error`-type:** The `send_input` handler must check `humanNeededType !== 'error'` before clearing. Clearing an error state would resurrect a crashed node back to `running`, which is incorrect — error/crashed states require a restart, not input.

### Bug 3: One-Shot Sessions Silently Discard stdin Input (Must-fix)

**File:** `server/session.ts`

One-shot sessions (subtasks with a prompt) receive their prompt as a positional CLI arg and do not use `--input-format stream-json`. When the CLI finishes processing, it exits. If the user types input into TerminalPeek for a one-shot session, `sendInput()` writes raw text to a stdin pipe nobody reads — the input is silently discarded.

**Fix options (pick one):**
1. **Always use `--input-format stream-json`** on all sessions (including one-shot), so they can receive follow-up messages after the initial prompt
2. **Disable the input field** in TerminalPeek for non-interactive sessions (check if the node was spawned with a prompt)
3. **Document the limitation** clearly in the terminal UI (e.g., "This session is read-only — it was started with a prompt and will exit when done")

Option 1 is the most flexible; option 2 is the simplest.

### Bug 4: Terminal Buffer Not Replayed on Subscribe (Must-fix)

**File:** `server/index.ts`, `server/session.ts`

New WebSocket subscribers (or the same client after a page reload) only see events from the time they subscribe. All prior terminal output is lost. If a session has been running for 30 seconds before the user opens TerminalPeek, they see an empty terminal.

**Fix:** When a client subscribes to a node's terminal (or when the `subscribe` WS message is handled), replay the buffered terminal lines from the session's history. The server already buffers output in `terminalBuffer` — send the buffer contents as an initial batch when a new subscriber connects.

**Protocol details:**
- Use a distinct `terminal_replay` message type (add to the `ServerMessage` union in `shared/types.ts`) rather than reusing `terminal_output`. This lets the client distinguish replayed history from live output.
- Send the replay only to the subscribing WebSocket (unicast via `ws.send`), not broadcast to all clients.
- The client terminal store must handle `terminal_replay` with a `setLines` method (replace entire buffer) rather than `appendLines` (which would duplicate content if the client already has partial state). Add `setLines` to the Zustand terminal store alongside the existing `appendLines`.

### Bug 5: Interactive `-p` Mode May Not Work Without Initial Message

**File:** `server/session.ts:59-76`

When spawning a feature (interactive mode), Claude CLI is launched with `-p` but no prompt argument. The `-p` flag puts Claude in pipe/print mode. With `--input-format stream-json`, it should accept `{ type: 'user_message', content: '...' }` on stdin.

**Concern:** This needs real-world testing. If `claude -p` requires at least one positional arg and exits immediately when none is provided, interactive sessions would silently die.

**Verification:** Run manually:
```bash
claude -p --verbose --output-format stream-json --input-format stream-json --dangerously-skip-permissions
# Then type: {"type":"user_message","content":"hello"}
```

If this fails, the fix is to either:
- Remove `-p` for interactive mode (use `claude --output-format stream-json --input-format stream-json` instead)
- Or send an initial prompt and switch to interactive after

### Bug 6: `model_usage_metrics` Events Not Handled

**File:** `server/stream-parser.ts:321-324`

Claude CLI emits `model_usage_metrics` events during streaming. The parser's `default` case stringifies the entire event and broadcasts it as terminal output:

```
[model_usage_metrics] {"type":"model_usage_metrics","input_tokens":1234,...}
```

This creates noise in the terminal. Not a blocker, but affects readability.

**Fix:** Add a case for `model_usage_metrics` that silently ignores it (like `system`) or extracts token counts for the node's `tokenUsage`.

## Implementation Steps

### Step 1: Add `--include-partial-messages` to Spawn Args (Critical)

1. In `server/session.ts`, add `'--include-partial-messages'` to the args array for both interactive and one-shot spawn modes
2. Without this flag, `content_block_delta` events are never emitted and streaming is broken
3. Verify TypeScript compiles cleanly: `bunx tsc --noEmit`

### Step 2: Fix `clearHumanNeeded` Race Condition

**Mechanism note:** `clearHumanNeeded` is currently a closure inside `createStreamParser` — it's not callable from `server/index.ts`. Extract the clearing logic into a shared helper.

1. Export a `clearHumanNeeded(nodeId: string)` helper from `server/state.ts` (or wherever node state is managed) that calls `updateNode(nodeId, { needsHuman: false, humanNeededType: null, humanNeededPayload: null })`. **The helper must NOT set `nodeState`** — leave state transitions to the caller. This avoids an ordering hazard where calling `clearHumanNeeded` after a `completed` transition would overwrite it back to `running`
2. In `server/stream-parser.ts`, remove the blanket `clearHumanNeeded()` call from the top of `processEvent` (around line 186). Replace it with a targeted check: if the current node's `humanNeededType === 'idle'`, call `clearHumanNeeded(nodeId)` — incoming stream activity means the session is no longer idle
3. In `server/stream-parser.ts`, in the `result` event handler, merge the human-needed clearing fields (`needsHuman: false`, `humanNeededType: null`, `humanNeededPayload: null`) directly into the existing `updateNode` call that sets `nodeState: 'completed'`. Do NOT call the separate `clearHumanNeeded` helper here — that would cause two broadcasts and a transient incorrect state. A single `updateNode` call handles both the state transition and the human-needed cleanup atomically
4. In `server/index.ts`, in the `send_input` handler, call the exported `clearHumanNeeded(nodeId)` — but **only if** the node's current `humanNeededType` is `'question'` or `'permission'` (NOT `'error'`). Clearing an error state from `send_input` would resurrect a crashed node back to `running`
5. **`proc.exited` state guard:** In `server/session.ts`, the `proc.exited` handler must check `node.nodeState !== 'completed'` before setting `nodeState: 'crashed'`. Without this guard, a race exists where the `result` event sets `completed`, but a subsequent non-zero exit code (e.g., SIGTERM during cleanup) overwrites it back to `crashed`. The guard is a single conditional check that prevents completed sessions from being incorrectly marked as crashed
6. Verify that `needs-human` state persists in the UI until the user acts, and that idle recovery, session completion, and error states all behave correctly

### Step 3: Handle One-Shot Session Input

1. Decide on approach: always use `--input-format stream-json` (recommended), or disable input in TerminalPeek for one-shot sessions
2. If using `--input-format stream-json` everywhere: update `session.ts` to include it in one-shot spawn args and pass the initial prompt as a `user_message` JSON object on stdin instead of a positional arg
3. If disabling input: add a `mode` field to the node state (`interactive` vs `one-shot`) and conditionally hide the input bar in TerminalPeek

### Step 4: Replay Terminal Buffer on Subscribe

1. Add `terminal_replay` to the `ServerMessage` union in `shared/types.ts` (payload: `{ nodeId: string, lines: string[] }`)
2. In the `subscribe` WebSocket message handler (`server/index.ts`), send the session's buffered terminal lines as a single `terminal_replay` message to the subscribing WebSocket only (unicast `ws.send`, not broadcast)
3. Add a `setLines(nodeId, lines)` method to the Zustand terminal store (`src/hooks/useTerminal.ts`) that replaces the entire buffer for a node
4. In the client WebSocket message handler, handle `terminal_replay` by calling `setLines` (not `appendLines`) to avoid duplicating content on reconnect or re-subscribe
5. **Reconnect resilience:** After WebSocket `onopen` (reconnect), the client must re-send `subscribe_terminal` for the currently selected node. This requires `useWebSocket.ts` to access `selectedNodeId` from the graph store so it can re-subscribe automatically when the connection is re-established

### Step 5: Verify Claude CLI Interactive Mode

1. Manually test `claude -p --input-format stream-json --output-format stream-json --include-partial-messages --dangerously-skip-permissions` in a terminal
2. Send a JSON message on stdin and confirm output flows back with streaming deltas
3. If it doesn't work, adjust `session.ts` spawn args accordingly

### Step 6: Suppress Noisy Events in Stream Parser

1. In `server/stream-parser.ts`, add cases for `model_usage_metrics` and any other noisy event types
2. Either silently ignore them or extract useful data (token counts → node state)

### Step 7: End-to-End Smoke Test

1. Start dev server: `bun run dev`
2. Open browser, add a repo
3. Click "+ Feature" → terminal should open, showing "Waiting for output..."
4. Type a prompt in the terminal input → Claude should respond
5. Verify streaming output appears **in real-time** (not just after turn completes — confirms `--include-partial-messages` works)
6. Verify stage transitions work (planning → executing → testing)
7. Test subtask spawning with a prompt (one-shot mode)
8. Test input during a `needs-human` state (when Claude asks a question) — confirm the question state persists until user responds
9. Close and reopen TerminalPeek — confirm prior output is replayed from buffer

### Step 8: UX Polish (If Needed)

Depending on smoke test findings:
- Add a "Type your first message to start" hint for interactive sessions
- Show node state transitions in the terminal (e.g., "[Session started]", "[Session completed]")
- Handle the case where Claude CLI binary isn't found (show clear error in terminal)

## Files to Modify

| File | Change |
|------|--------|
| `server/session.ts` | Add `--include-partial-messages` to spawn args; potentially add `--input-format stream-json` for one-shot mode; add `nodeState !== 'completed'` guard in `proc.exited` handler before setting `crashed` |
| `server/state.ts` | Export `clearHumanNeeded(nodeId)` helper that resets `needsHuman`, `humanNeededType`, `humanNeededPayload` (does NOT touch `nodeState` — callers manage state transitions) |
| `server/stream-parser.ts` | Replace blanket `clearHumanNeeded()` in `processEvent` with idle-only clearing; merge human-needed clearing fields into the `result` handler's `updateNode` call (not a separate helper call); handle `model_usage_metrics` events |
| `server/index.ts` | Call `clearHumanNeeded(nodeId)` in `send_input` handler (guarded: only for `question`/`permission`, not `error`); replay terminal buffer on `subscribe` via unicast `terminal_replay` |
| `shared/types.ts` | Add `terminal_replay` to `ServerMessage` union |
| `src/hooks/useTerminal.ts` | Add `setLines(nodeId, lines)` method to terminal store |
| `src/hooks/useWebSocket.ts` | Re-send `subscribe_terminal` on WebSocket reconnect using `selectedNodeId` from graph store |
| `src/components/panels/TerminalPeek.tsx` | Possibly disable input for one-shot sessions (if that approach is chosen) |

## Verification

1. `bunx tsc --noEmit` — zero TypeScript errors
2. `bun run dev` — server and client start without crashes
3. Manual end-to-end test: add repo → spawn feature → type prompt → see Claude response → see **streaming** output (token-by-token, not all-at-once)
4. Manual test: spawn subtask with prompt → see Claude run autonomously → see completion
5. Manual test: trigger `needs-human` state → confirm it persists in UI until user responds (not cleared by subsequent events)
6. Manual test: trigger `needs-human` with `error` type → confirm `send_input` does NOT clear it (node stays crashed)
7. Manual test: close and reopen TerminalPeek for an active session → confirm prior output is replayed (via `terminal_replay` / `setLines`, no duplication)
8. Manual test: kill and restart the WebSocket server while a terminal is open → confirm the client re-subscribes on reconnect and replays the buffer
