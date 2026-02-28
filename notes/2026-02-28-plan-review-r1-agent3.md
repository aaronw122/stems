# Plan Review: weft-flow — Senior Systems Architect Perspective

**Reviewer:** Agent 3 (Senior Systems Architect — state management, data layers, event systems)
**Date:** 2026-02-28
**Plan version reviewed:** `/Users/aaron/weft-flow/plan.md`

---

## Overall Assessment

The plan describes a well-scoped orchestration GUI with a clear data model and sensible phasing. The core architectural insight — bidirectional JSON streaming with the Claude CLI — is sound in principle. However, there are several structural issues that would force rework if discovered during implementation: a critical gap around the Agent SDK vs raw CLI piping, missing state for session lifecycle management, an incomplete WS protocol for the most important user interaction (responding to agent questions), and a data model that conflates node type with session ownership in ways that will cause trouble at the subtask level.

---

### [Critical] Agent SDK exists and should replace raw CLI stream-json piping

**Section:** Architecture — Core insight

**Issue:** The plan proposes spawning `claude` with `--input-format stream-json --output-format stream-json` and parsing newline-delimited JSON from stdout. As of the current Claude Code version (2.1.59), there is now a full **Agent SDK** available as both a TypeScript and Python package (`@anthropic-ai/claude-agent-sdk`). The SDK provides:

- A `query()` async generator that yields typed message objects (`AssistantMessage`, `StreamEvent`, `ResultMessage`, `SystemMessage`)
- Native `canUseTool` callbacks for handling permission prompts and `AskUserQuestion` — the exact interaction the plan needs for "human-needed" detection and `send_input`
- Streaming input mode via async generators, which is exactly the multi-turn conversation model the plan requires
- Session management with `session_id` capture and `resume` support
- Proper TypeScript types for all message and event schemas

The plan's approach of raw `Bun.spawn` + JSON line parsing would require reimplementing what the SDK already provides: message type discrimination, tool use event parsing, permission prompt handling, session lifecycle management. More critically, the raw CLI stream-json protocol is underdocumented — the official docs point users to the SDK for programmatic usage. The plan's `stream-parser.ts` would be building against an unstable, internal-facing protocol surface.

**Suggested fix:** Replace `Bun.spawn` with the Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) as the session management layer in `server/session.ts`. Use `query()` with `includePartialMessages: true` for streaming, the `canUseTool` callback for permission/question handling, and the SDK's session management for resume/continue. This eliminates `server/stream-parser.ts` entirely and gives typed events instead of raw JSON line parsing. The SDK runs in the same Bun process — no subprocess management needed for the Claude interaction itself.

**Caveat:** If the plan specifically requires running Claude CLI as a subprocess (e.g., to inherit the user's full Claude Code configuration, CLAUDE.md files, hooks, and skills — which the SDK also supports via `settingSources`), the SDK still supports this via the CLI's `-p` mode with `--output-format stream-json`. But even in that case, the SDK's TypeScript types and message parsing should be used rather than hand-rolling a stream parser.

---

### [Critical] No mechanism for sending user input back to the agent

**Section:** WS protocol, Data model, Architecture

**Issue:** The WS protocol lists `send_input` as a client-to-server message for "responding to agent questions." But there is no specification of:

1. What the `send_input` payload looks like (free text? structured answer to `AskUserQuestion`?)
2. How the server routes input back to the correct Claude session's stdin
3. How `AskUserQuestion` responses must be formatted (the SDK requires returning `{ questions: [...], answers: { "question text": "selected label" } }` — this is not free text)
4. How permission prompt responses are handled (allow/deny with optional modified input)

This is the most important user interaction in the entire system — the red flash "needs human" state is the primary reason this GUI exists over plain terminal tabs. Without a specified protocol for resolving human-needed states, the feature that makes weft-flow valuable cannot be implemented correctly.

**Suggested fix:** Specify the `send_input` protocol in detail:
- For `AskUserQuestion`: the server must surface the question text, options, and multiSelect flag to the client. The client sends back structured answers keyed by question text.
- For permission prompts: the server must surface the tool name, tool input, and description. The client sends back allow (with optional modified input) or deny (with message).
- For free-text input (agent stuck / general redirect): the client sends a new user message that gets yielded into the streaming input generator.
- Add a `human_needed_type` field to the node model: `"question" | "permission" | "error" | "idle"`, along with `humanNeededPayload` containing the structured data the client needs to render the appropriate response UI.

---

### [Must-fix] Node data model missing session lifecycle state

**Section:** Data model

**Issue:** Each node tracks `stage` (planning/executing/testing/done) and `needsHuman`, but is missing critical session lifecycle state:

1. **Session ID**: No field to store the Claude session ID, which is needed for resume/continue operations and is returned by both the SDK and CLI
2. **Process state**: No distinction between "session is actively running" vs "session completed" vs "session crashed" vs "session was never started" (a feature node could exist as a plan before any Claude session is spawned)
3. **Cost tracking**: No field for token usage / cost, which the SDK provides in `ResultMessage` and would be valuable in an orchestration tool
4. **Error state**: `needsHuman` is a boolean but errors need a richer model — was it a tool error, an API error, a rate limit, a context window overflow? These require different responses.

Without session ID tracking, the system cannot resume crashed sessions. Without process state, the frontend cannot distinguish "Claude is thinking" from "Claude finished" from "Claude crashed" — all of which should render differently.

**Suggested fix:** Extend the node model:
```typescript
interface WeftNode {
  // ... existing fields ...
  sessionId: string | null;        // Claude session UUID
  processState: 'idle' | 'running' | 'completed' | 'crashed';
  errorInfo: { type: string; message: string } | null;
  costUsd: number;                 // Accumulated cost for this session
  tokenUsage: { input: number; output: number };
}
```
The `stage` field (planning/executing/testing/done) remains as a semantic/heuristic layer on top of `processState`.

---

### [Must-fix] Subtask context model is underspecified and creates tight coupling

**Section:** Data model, Phase 7 (Context summarization)

**Issue:** The plan says subtasks are "Claude CLI sessions, context-summarized from parent." Phase 7 describes spawning `claude -p` to summarize the parent's terminal buffer. Several problems:

1. **Terminal buffer is lossy context**: The rolling 500-line terminal buffer will lose early context from long-running parent sessions. A parent that ran for 2000 lines of output will have its first 1500 lines (likely containing the most important architectural decisions) truncated before the summary is generated.
2. **Summarization is a one-shot snapshot**: If the parent continues working after the subtask is spawned, the subtask's context is stale. There is no mechanism for context refresh.
3. **No structured handoff**: The summarization model (a quick `claude -p` call) gets raw terminal output including ANSI codes, tool use JSON, error traces, etc. This is noisy input for summarization.
4. **Parent-child coordination is unspecified**: How does a subtask report its results back to the parent? The plan says nothing about this. In practice, subtasks will modify files that the parent is also working on — the conflict tracker addresses file-level conflicts but not semantic coordination.

**Suggested fix:**
- Track the full conversation history via the session ID rather than relying on terminal buffer. The SDK/CLI persists conversations that can be referenced.
- Define a structured handoff format: when spawning a subtask, extract the parent's current plan/goals from the conversation (not raw terminal output) and inject them as system prompt context.
- Specify the subtask completion flow: does the subtask's result get injected back into the parent's conversation? Or does the user manually coordinate? This is an architectural decision that affects the data model (subtask nodes need a `result` or `summary` field that can be pushed to the parent).

---

### [Must-fix] Conflict tracker based on file edits is reactive, not preventive

**Section:** Phase 5 (Conflict tracking), Parallelization / conflict flags

**Issue:** The conflict tracker detects overlaps by watching `Edit`/`Write` tool use events in the stream. This means:

1. **Conflicts are detected after they happen**, not before. By the time two agents have both edited the same file, the damage is done — one agent's changes will be overwritten or merged incorrectly.
2. **Read-then-write patterns are invisible**: An agent that `Read`s a file and is about to `Write` it won't show up as a conflict until the write actually occurs. The conflict window between read and write is unprotected.
3. **No file locking or advisory mechanism**: The plan says "Agents spawned from the GUI get this context injected" about active areas, but this is advisory text in a prompt — agents can and will ignore it under pressure (e.g., when a test failure requires editing a shared config file).
4. **Directory-level overlap (yellow) is too coarse**: Two agents working in `src/components/` on completely unrelated components would show yellow, creating alert fatigue.

**Suggested fix:**
- Track `Read` events as well as `Edit`/`Write` to provide earlier warning of potential conflicts.
- Consider a simple advisory lock: when an agent starts editing a file, mark it as "claimed" and inject a stronger directive (not just context, but a `--disallowedTools` pattern or pre-tool-use hook) into other sessions to prevent concurrent edits to the same file.
- Use file-level granularity only (not directory-level) for conflict detection. The yellow "partial overlap" state adds complexity without actionable signal.

---

### [Medium] Stage detection heuristics have gaps and no fallback

**Section:** Stage detection heuristics

**Issue:** The stage detection heuristics are based on tool use patterns, but several common patterns are not covered:

1. **planning -> executing via Bash**: An agent might run `mkdir`, `git checkout -b`, or scaffold commands via Bash before any Edit/Write. These are clearly "executing" but would remain in "planning."
2. **No "reviewing" stage**: After tests pass, agents commonly read test output, review their changes (`git diff`), and prepare commits. This is neither "testing" nor "done."
3. **testing -> done only on session completion**: If tests pass but the agent continues to do more work (e.g., adds documentation, creates PR), it stays in "testing" until session end.
4. **The testing -> executing loop**: The plan says "Tests fail -> Claude edits more code" triggers testing -> executing. But the stream parser would need to detect test failure, which requires parsing Bash output (not just detecting Bash tool use). The heuristic only says "Bash tool use with test command" for detecting the testing stage — not for detecting test outcomes.

**Suggested fix:**
- Acknowledge that stage detection is approximate and design the UI to allow manual override (already partially covered by editable title — extend to editable stage).
- Add heuristic for `Bash` tool use with common scaffold/git commands as executing triggers.
- Consider a simpler three-state model (working / blocked / done) that is more reliably detectable, with the detailed stage as an optional refinement.

---

### [Medium] In-memory state with no persistence creates a fragile system

**Section:** Architecture (Server), Done list, Verification step 10

**Issue:** The plan explicitly states "session-scoped, clears on server restart" for the done list, and the entire state store is in-memory. This means:

1. **Server crash = total loss**: All node state, terminal buffers, conflict tracking, and done list are lost. Active Claude sessions (subprocesses) would become orphaned — still running but with no parent tracking them.
2. **No recovery path**: If the Bun server crashes while 5 agents are running, the user loses visibility into all of them with no way to reconnect. The Claude sessions themselves may still be running (they're separate processes), but the orchestration layer is gone.
3. **Refresh = disconnect**: A browser refresh should not require full state reconstruction from scratch.

While avoiding persistence for an MVP is reasonable, the plan should at least address:
- Orphan process cleanup on server restart
- Periodic state snapshots (even just JSON to disk)
- Browser reconnection that recovers state from server (the `full_state` WS message partially addresses this but only if the server hasn't restarted)

**Suggested fix:** Add a lightweight persistence layer to Phase 1 or Phase 9:
- Write state to a JSON file on every mutation (debounced, ~500ms). On restart, reload and attempt to reconnect to still-running Claude processes via their session IDs.
- Track spawned process PIDs so orphaned processes can be detected and killed on restart.
- At minimum, document the recovery story: "If the server crashes, Claude sessions continue running independently. Restart the server and re-add repos to see them."

---

### [Medium] WS protocol missing reconnection and state sync semantics

**Section:** WS protocol

**Issue:** The WS protocol defines `full_state` as a server-to-client message, but doesn't specify:

1. **When `full_state` is sent**: On initial connection? On reconnection? On request?
2. **Reconnection protocol**: When a WS connection drops and reconnects, does the client request `full_state`? Or does the server push it automatically? Are terminal buffers included in `full_state` or are they separate?
3. **Message ordering guarantees**: If the client receives `node_updated` and `terminal_data` out of order, is the state consistent?
4. **Terminal subscription lifecycle**: `subscribe_terminal` / `unsubscribe_terminal` exist but there's no spec for what happens to the subscription on reconnect. The client would need to re-subscribe.

**Suggested fix:** Specify:
- `full_state` is sent on every new WS connection (including reconnections)
- `full_state` includes current node states but NOT terminal buffers (those are too large)
- After receiving `full_state`, the client re-subscribes to any terminal streams it was previously watching
- Terminal subscription sends the current buffer as an initial payload, then streams new data
- Add a client-to-server `request_state` message as an explicit sync mechanism

---

### [Medium] `ansi-to-html` for terminal rendering is insufficient

**Section:** Phase 3 (Terminal peek)

**Issue:** The plan specifies ANSI-rendered text in a `<pre>` tag using `ansi-to-html`. Claude Code's output includes:

1. **Cursor movement sequences** (move up, clear line, overwrite) used for progress indicators and spinners — `ansi-to-html` converts colors but does not implement a terminal state machine, so these will render as garbage characters
2. **Interactive elements** like permission prompts that use cursor positioning
3. **Wide characters, box drawing, and table formatting** that require monospace font and proper character width handling

With `--output-format stream-json`, most of these issues are avoided because the output is structured JSON, not raw terminal output. But the plan refers to "ANSI-rendered text" and "rolling last ~500 lines of output" which implies capturing raw process output somewhere.

**Suggested fix:** Clarify what `terminalBuffer` actually contains. If using the stream-json output format (or the Agent SDK), the buffer should contain parsed, structured events — not raw ANSI terminal output. The terminal peek panel should render these structured events as a clean log view (tool names, text responses, status indicators) rather than trying to emulate a terminal. This is both simpler and more useful than ANSI rendering. Reserve `ansi-to-html` only for rendering Bash tool output content, which does contain ANSI escape codes for colorized command output.

---

### [Medium] No specification for how repos are validated or tracked

**Section:** Data model, Phase 1, WS protocol

**Issue:** The `add_repo` message takes "a path + branch info" but there's no specification for:

1. **Validation**: Is the path checked to be a valid git repo? What if it's not? What if the directory doesn't exist?
2. **Branch tracking**: What "branch info" is tracked? Current branch? Default branch? Does it update as agents create new branches?
3. **Working directory**: When a Claude session is spawned for a feature under a repo, is the `--add-dir` flag used? Or is the working directory set to the repo path? This affects what files Claude can access.
4. **Multiple repos with overlapping paths**: Can a user add both `/Users/aaron/project` and `/Users/aaron/project/packages/core`? How are feature nodes associated with the correct repo?

**Suggested fix:** Define the repo node model explicitly:
```typescript
interface RepoNode {
  id: string;
  path: string;          // Absolute path, validated as existing directory
  isGitRepo: boolean;    // Whether it's a git repo
  defaultBranch: string; // e.g., "main"
  currentBranch: string; // Updated periodically
}
```
Specify that `spawn_feature` uses the repo's `path` as the working directory for the Claude session, and that `--add-dir` is not used (each session is scoped to its repo).

---

### [Low] Phase ordering creates late integration risk for the most important feature

**Section:** Build phases

**Issue:** Phase 7 (Context summarization for child nodes) is the feature that enables the hierarchical orchestration model — spawning subtasks from features with inherited context. But it's phase 7 of 9. The phases before it (1-6) build features assuming a flat model where each session is independent. If the context summarization architecture doesn't work well (e.g., summaries are too lossy, latency is too high for the extra `claude -p` call), the hierarchical model — which is the core value proposition described in the opening paragraph — would need to be rethought.

**Suggested fix:** Move a minimal version of context passing to Phase 3 (when sessions are first spawned). Even a simple "copy parent's prompt + first assistant message into child's system prompt" would validate the hierarchical model early. Phase 7 can then refine the summarization quality.

---

### [Low] PR tracking via stream sniffing is fragile

**Section:** Phase 6 (PR tracking)

**Issue:** The plan says PR tracking works by detecting `gh pr create` in the stream and extracting the URL. This requires:

1. Parsing the Bash tool input to detect `gh pr create` commands
2. Parsing the Bash tool output to extract the PR URL
3. Handling various `gh` output formats (the URL format varies by gh version and config)

This is fragile pattern matching against tool I/O. If the agent uses a different command (e.g., `hub pull-request`, or a git alias, or creates the PR via the GitHub API), the detection fails silently.

**Suggested fix:** Instead of stream sniffing, poll for PRs associated with the repo's branches. Use `gh pr list --head <branch-name>` periodically, which catches PRs regardless of how they were created. This also catches PRs created outside of weft-flow.

---

### [Low] No consideration for concurrent server instances

**Section:** Architecture (Server)

**Issue:** Nothing prevents a user from accidentally starting two instances of the Bun server on port 4800, or from running weft-flow in two terminals for different workspaces. Two instances would compete for the same port, and if PID-based process management is used, they could interfere with each other's Claude sessions.

**Suggested fix:** Add a lockfile (`/tmp/weft-flow.lock` or similar) on server start. If the lock exists, either error with a clear message or connect to the existing instance.

---

### [Impl-note] Dagre layout performance

**Section:** Phase 9 (Polish)

**Issue:** Dagre layout is listed in Phase 9 but is referenced in Phase 2 (`useGraph.ts` — "dagre layout"). Running dagre on every graph update could become expensive with many nodes. Implementation should debounce layout recalculation.

---

### [Impl-note] Terminal buffer memory management

**Section:** Data model

**Issue:** "Rolling last ~500 lines" per node. With 20 active nodes, that's 10,000 lines in memory. Implementation should use a ring buffer and consider line length limits to prevent memory bloat from agents that dump large file contents.

---

### [Impl-note] WebSocket topic design for Bun native pub/sub

**Section:** Architecture (Server)

**Issue:** Bun's native WebSocket pub/sub uses string-based topics. The plan uses `terminal:{nodeId}` format. Implementation should define a clear topic naming convention and handle the case where a client subscribes to a terminal topic for a node that doesn't exist or has been moved to the done list.

---

### [Impl-note] Race condition in conflict detection

**Section:** Phase 5 (Conflict tracking)

**Issue:** If two agents write to the same file within the same event processing tick, the conflict tracker might not detect it because both writes would be processed before the overlap check runs. Implementation should check conflicts before applying each edit event, not in batch.

---

## Summary

| Severity | Count |
|----------|-------|
| Critical | 2 |
| Must-fix | 3 |
| Medium | 4 |
| Low | 3 |
| Impl-note | 4 |
| **Total** | **16** |

The two critical issues — adopting the Agent SDK and specifying the human input protocol — should be resolved before implementation begins, as they affect the entire server-side architecture. The must-fix items (session lifecycle state, subtask context model, conflict tracker design) should be addressed in the plan to avoid mid-implementation rewrites. The medium and low items can be incorporated during implementation planning for their respective phases.
