# Plan Review: weft-flow Agent Orchestration GUI

**Reviewer:** Cynical Senior Engineer (Agent 2)
**Date:** 2026-02-28
**Plan reviewed:** `/Users/aaron/weft-flow/plan.md`

---

## Issues

### [Critical] `--print` flag is required for stream-json but plan omits it
**Section:** Architecture — Core insight
**Issue:** The example command in the plan is:
```
claude --input-format stream-json \
       --output-format stream-json \
       --include-partial-messages \
       --add-dir /path/to/repo
```
The Claude CLI help is explicit: `--input-format`, `--output-format`, `--include-partial-messages`, and `--max-budget-usd` all state "only works with `--print`". The plan's example command will not work as written — it will launch an interactive terminal session and ignore the streaming flags. The correct invocation must include `-p` / `--print`.

**Why this matters now:** This is the literal foundation of the architecture. Every `Bun.spawn` call will use this command. Getting it wrong means debugging a silent failure where Claude starts an interactive PTY instead of a JSON pipe — which is exactly the thing the plan says it's avoiding.

**Suggested fix:** Update the architecture example to include `--print`:
```
claude -p --input-format stream-json \
       --output-format stream-json \
       --include-partial-messages \
       --add-dir /path/to/repo
```
Also update `server/session.ts` description in Phase 1 to explicitly reference the `-p` flag.

---

### [Critical] Multi-turn conversation model is unverified and the plan asserts it as settled
**Section:** Architecture — Core insight
**Issue:** The plan states: "Multi-turn conversations through pipes — not one-shot `claude -p`." But `claude -p` is documented as "Print response and exit (useful for pipes)." The plan's entire architecture depends on `--input-format stream-json` keeping the process alive across multiple user turns when combined with `-p`, but this behavior is not documented in `--help` and the plan treats it as a known fact.

The `--input-format stream-json` flag description says "realtime streaming input," which *suggests* the process stays alive and reads from stdin continuously. The `--replay-user-messages` flag (which only works with both stream-json flags) further suggests multi-turn is intended. But "suggests" is not "verified."

If `claude -p --input-format stream-json` actually processes one user message and exits, the entire architecture collapses. You'd need to fall back to session resumption (`--resume` with session IDs) or something else entirely — a fundamentally different approach.

**Suggested fix:** Before any code is written, the very first task in Phase 1 should be a spike: manually test `claude -p --input-format stream-json --output-format stream-json` with piped stdin, send a user message, get a response, then send a second user message. Confirm the process stays alive. Document the exact JSON format for user messages. This is a 15-minute test that validates or invalidates the entire plan.

---

### [Critical] Permission model for spawned sessions is undefined
**Section:** Architecture, Human-needed detection
**Issue:** The plan mentions `--dangerously-skip-permissions` only in the human-needed detection table ("If not using `--dangerously-skip-permissions`, permission prompts in stream"). But it never actually specifies what permission mode spawned sessions should use. This is a fundamental architectural decision that affects:

1. **Whether agents can actually do anything.** Without `--dangerously-skip-permissions` or `--permission-mode bypassPermissions`, Claude will emit permission prompts that the GUI needs to intercept, display, and respond to. The `send_input` WS message is mentioned in the protocol but there's no UI for permission approval (no component, no mock, no design).

2. **The human-needed detection logic.** If sessions run with default permissions, *every single tool use* will trigger a permission prompt, which means *every session* will immediately need human input. The "needs-human" flash becomes the default state, not the exception.

3. **Security implications.** If sessions run with `--dangerously-skip-permissions`, agents can delete files, run arbitrary commands, push to repos, etc. The plan has no discussion of blast radius or guardrails.

**Suggested fix:** Add an explicit "Permission Model" section to the architecture. Decide on one of:
- `--dangerously-skip-permissions` (fast, scary, probably what you want for a power-user tool)
- `--permission-mode acceptEdits` (auto-approve edits, prompt for bash — probably the sweet spot)
- Default permissions with a permission-approval UI component

Whatever the choice, it changes the implementation significantly. Pick it now.

---

### [Must-fix] `send_input` WS message has no corresponding UI or flow
**Section:** WS protocol, all frontend phases
**Issue:** The WS protocol defines `send_input` as a client→server message "for responding to agent questions," but:
- No component exists for this. `TerminalPeek.tsx` is described as a read-only `<pre>` with ANSI rendering.
- No phase includes building an input mechanism.
- No description of how user input gets routed to the correct Claude process's stdin.
- The `AskUserQuestion` detection triggers "needs-human" but then... what? The user sees a red flash and a read-only terminal. There's no way to actually respond.

This is the entire point of the "human in the loop" design and it's missing from the implementation plan.

**Suggested fix:** Add an input mechanism to `TerminalPeek.tsx` (or a separate component) — at minimum a text input at the bottom of the peek panel. Add a task to Phase 3 or Phase 4 that wires `send_input` messages through the WS to the correct Claude process's stdin, formatted as a stream-json user message. Define the JSON format for that stdin write.

---

### [Must-fix] No `--print` flag means `--add-dir` may not be sufficient for working directory
**Section:** Architecture — Core insight
**Issue:** The plan uses `--add-dir /path/to/repo` to give Claude access to the repo, but `--add-dir` is described as "Additional directories to allow tool access to." It does not set the *working directory*. When Claude runs, its tools (Bash, Edit, Read) operate relative to the working directory. If the process spawns in the weft-flow directory (which it will, since that's where the server runs), Claude will be working in the wrong directory.

The plan needs to either:
1. Set `cwd` on the `Bun.spawn` call to the repo path, OR
2. Use a combination of `--add-dir` and explicit instructions in the prompt to `cd` first

Option 1 is correct. Option 2 is fragile (agents forget instructions).

**Suggested fix:** In `server/session.ts`, the `Bun.spawn` call must set `cwd` to the repo path. Add this to the Phase 1 description. `--add-dir` is still useful if the agent needs access to *additional* directories beyond the repo root.

---

### [Must-fix] Stage detection heuristics are too naive and will misclassify constantly
**Section:** Stage detection heuristics
**Issue:** The stage detection is based on tool use patterns:
- `planning → executing`: "First Edit or Write tool use"
- `executing → testing`: "Bash tool use with test command"

Problems:
1. Claude frequently uses `Read` and `Bash` (for `ls`, `git status`, etc.) during planning. The plan doesn't account for these — they'd leave the node stuck in "planning" even while Claude is actively investigating.
2. Claude often edits files *before* it has a plan — e.g., creating a scratch file, editing a config. First Edit doesn't mean "executing."
3. "Bash with test command" is a regex heuristic. What about `npm run test`? `make test`? `cargo test`? `go test ./...`? `jest`? `node test.js`? Custom test scripts? The set of "test commands" is unbounded.
4. The `testing → executing` transition (tests fail → edits more code) creates a ping-pong between states that would be visually chaotic on the graph. A node would flash yellow→green→yellow→green on every test-fix cycle.

**Suggested fix:** This is an Impl-note-level problem for the exact heuristics, but the *architecture* should acknowledge that stages will be approximate and design the UI accordingly. Consider:
- Making stages manually overridable (already good — editable title is in the plan, extend to stages)
- Using a simpler model: `active` / `needs-human` / `done` with a "last activity" description instead of trying to infer intent
- At minimum, add a note that these heuristics are v1 and will need iteration

---

### [Must-fix] Conflict detection based on file edits is reactive, not preventive
**Section:** Parallelization / conflict flags, Phase 5
**Issue:** The plan says agents' file edits are detected from the stream and compared for overlaps. But by the time you detect the overlap, *both agents have already edited the same file*. The conflict has already happened. Showing a red badge after two agents have made conflicting edits to the same file is a post-mortem, not a prevention mechanism.

The plan also says: "Agents spawned from the GUI get this context injected: 'These features are currently active: [list with areas]. Avoid modifying: [conflict zones].'" This is the preventive measure, but it's a natural-language instruction to an LLM — it's a suggestion, not enforcement. Agents will ignore it when they decide they need to edit that file.

**Suggested fix:** Acknowledge this limitation explicitly in the plan. The conflict system is a *visibility* tool, not a *prevention* tool. Consider:
- Adding a "lock file" mechanism where an active node can claim exclusive write access to specific files (server-side enforcement by rejecting spawns that would conflict)
- Or just be honest that this is advisory-only and name it "overlap visibility" instead of "conflict detection"
- Either way, what happens when a conflict IS detected? The plan shows badges but defines no resolution workflow (merge? abort one agent? manual intervention?)

---

### [Must-fix] Context summarization (Phase 7) is too late — it's needed for Phase 3
**Section:** Phase 7, Phase 3
**Issue:** Phase 7 introduces context summarization for child nodes, but Phase 3 already implements spawning subtasks. This means for Phases 3–6, subtasks spawn with no parent context at all. The plan says subtasks are "context-summarized from parent" in the data model, but the implementation doesn't deliver this until Phase 7.

More importantly, the summarization approach — "spawn a quick `claude -p` call to summarize parent's terminal buffer" — means every subtask spawn triggers an additional Claude API call. With a 500-line terminal buffer, that's a non-trivial context window. The plan doesn't account for the latency this adds to the spawn flow (user clicks "spawn subtask" → waits 5-15 seconds for summary → sees pre-filled prompt editor). It also doesn't account for the cost.

**Suggested fix:** Move context summarization to Phase 3, or at least acknowledge that Phase 3-6 subtasks will have no parent context. Also note the latency and cost implications of summarization-per-spawn. Consider caching summaries and invalidating when the parent's terminal buffer grows by N lines.

---

### [Must-fix] Plan viewer (Phase 8) is a feature island with no integration story
**Section:** Phase 8
**Issue:** Phase 8 adds a markdown plan viewer, but it's disconnected from everything else:
- "Triggered from a 'View Plan' button or by associating a plan file with a repo/feature node" — what does "associating" mean? Where is this stored? Who sets it? The data model has no `planFile` field.
- "Split view option: plan on the left, graph on the right" — this is a layout redesign, not a small feature. React Flow canvases don't trivially shrink to half-width without layout recalculation. The plan treats this as a bullet point.
- How does the plan viewer relate to the actual work being done? Can you check off items in the plan as agents complete them? Or is this literally just a markdown renderer?

This feels like scope creep. A standalone markdown viewer is a browser tab with a `.md` file in it. If there's no integration with the graph (e.g., linking plan items to nodes, tracking progress), it's not worth a phase.

**Suggested fix:** Either define a real integration story (plan items map to graph nodes, checkboxes update when features complete) and accept the complexity, or cut it entirely. "View your plan file in a panel" is not worth the implementation cost when you can just open it in VS Code / Typora / a browser.

---

### [Medium] No persistence means any server restart loses all state
**Section:** Data model, Done list
**Issue:** The plan explicitly says "session-scoped, clears on server restart" for the done list, and the data model is "in-memory Map." This means:
- Every `bun dev` restart (which happens constantly during development, and on crashes) loses all active sessions, all state, all history.
- The server process dying kills all spawned Claude processes (they're children of the server process via `Bun.spawn`).
- No way to recover from a server crash. If you have 5 active agent sessions and the server OOMs, everything is gone.

For an MVP this is arguably fine, but the plan should acknowledge this is a significant limitation and note where persistence would slot in. At minimum, the server should attempt graceful shutdown that kills child processes cleanly rather than orphaning them.

**Suggested fix:** Add a note in Phase 1 or the architecture section: "All state is in-memory and ephemeral. Server restart kills all active sessions. Persistence (SQLite or JSON file) is a post-MVP concern." Also add SIGTERM/SIGINT handling to `server/index.ts` that kills child Claude processes.

---

### [Medium] Terminal buffer at 500 lines will lose critical context for long sessions
**Section:** Data model
**Issue:** "terminalBuffer: rolling last ~500 lines of output." Claude sessions for real features can produce thousands of lines of output. 500 lines of rolling buffer means:
- Early planning context is gone by the time execution starts
- If the user peeks at a terminal mid-session, they have no way to see what happened earlier
- Context summarization (Phase 7) operates on the terminal buffer — if the important context rolled off, the summary will be garbage

**Suggested fix:** Either increase the buffer significantly (5000+ lines — memory is cheap for text), add a "full log" option that writes to disk and can be scrolled through in the UI, or both. The rolling buffer is fine for the live-streaming view, but there needs to be a full history somewhere.

---

### [Medium] `gh` polling for PR status every 30s will hit rate limits with multiple nodes
**Section:** Phase 6 — PR tracking
**Issue:** "Poll `gh` CLI for PR status every 30s." If you have 10 features, each with a PR, that's 10 `gh` calls every 30 seconds, or 20/minute. GitHub's API rate limit for authenticated users is 5000/hour (~83/minute), so this alone consumes 25% of your rate limit. Add in the agents themselves using `gh` and you're going to get throttled.

Also, `gh` CLI spawns a new process for every call. 10 processes every 30 seconds is not nothing.

**Suggested fix:** Use a single batched GraphQL query to fetch all PR statuses at once (via `gh api graphql`), or at minimum increase the polling interval to 60-120s for non-focused nodes and only poll at 30s for the node currently being viewed. Also add rate-limit detection and backoff.

---

### [Medium] No error recovery for crashed Claude sessions
**Section:** Phase 9 (buried in "Error handling")
**Issue:** "Error handling (session crashes, WS reconnect with state sync)" is a single bullet in the polish phase. But Claude sessions will crash. They'll OOM, they'll hit API rate limits, they'll encounter network issues, they'll hit max context length. This isn't polish — it's core functionality.

When a Claude process exits unexpectedly:
- What state does the node move to? (needs-human? a new "crashed" state?)
- Is the exit code / error message captured and shown?
- Can the user retry / resume the session?
- Are child nodes affected?

**Suggested fix:** Move basic error handling to Phase 3 (it's when sessions are first spawned). At minimum: detect process exit, capture exit code and last N lines of stderr, set node to a "crashed" or "needs-human" state with the error info. Leave retry/resume for later phases.

---

### [Medium] Dagre layout in Phase 9 should be Phase 2
**Section:** Phase 9, Phase 2
**Issue:** Dagre auto-layout is listed as polish (Phase 9), but React Flow without auto-layout means nodes stack on top of each other or the user has to manually position everything. Phase 2 builds the entire canvas and node system — without Dagre, the canvas will be unusable for testing Phases 3-8. You'll be manually dragging nodes around to even see what's going on.

`useGraph.ts` in Phase 2 already says "server state → React Flow nodes/edges with dagre layout" — so the hook description assumes Dagre, but the build phase doesn't include it.

**Suggested fix:** Move Dagre layout to Phase 2. It's a dependency of a usable canvas, not polish.

---

### [Medium] No budget controls on spawned Claude sessions
**Section:** Architecture
**Issue:** Each Claude session is an API call that can burn through significant money. The plan has no mention of `--max-budget-usd` on spawned sessions. A runaway agent (infinite loop, hallucinating work, etc.) could rack up a large bill. With multiple parallel agents, this multiplies.

**Suggested fix:** Add `--max-budget-usd` as a configurable parameter per session spawn, with a sensible default. Surface the current spend in the node UI (the stream-json output likely includes token counts). Add a "kill session" button on each node that's prominently placed, not buried.

---

### [Low] "Bun native pub/sub" for WebSocket is Bun-version-dependent
**Section:** Architecture — Server
**Issue:** Bun's WebSocket pub/sub API has changed between versions. The plan doesn't pin a Bun version. If someone installs Bun 1.0 vs 1.2 vs canary, the WS API may differ.

**Suggested fix:** Pin Bun version in package.json `engines` field or document the minimum required version.

---

### [Low] No mention of how to kill / cancel a running agent
**Section:** WS protocol, Frontend
**Issue:** The WS protocol has `close_node` but it's unclear whether this kills the underlying Claude process (SIGTERM? SIGKILL?) or just removes it from the graph. There's no "stop" or "cancel" button described in any of the node components. The only way to stop a runaway agent would be to find and kill the process manually.

**Suggested fix:** Add a "Stop" button to FeatureNode and SubtaskNode. Define `close_node` behavior: SIGTERM the Claude process, wait 5s, SIGKILL if still alive, then remove from graph. Add a `cancel_node` message if `close_node` should only remove from view without killing.

---

### [Impl-note] ANSI rendering in terminal peek
**Section:** Phase 3 — TerminalPeek
**Issue:** The plan says "ANSI-rendered `<pre>`" and lists `ansi-to-html` as a dependency. But stream-json output from Claude CLI is structured JSON, not raw terminal output with ANSI codes. The terminal buffer will contain parsed JSON events, not ANSI-escaped text. The plan needs to decide: are we rendering the raw JSON events as formatted text, or is there a separate raw terminal output stream?

**Suggested fix:** Clarify what the terminal buffer actually contains. If it's parsed stream-json events, the rendering is "format structured events into readable text," not "convert ANSI to HTML." The `ansi-to-html` dep may not be needed, or it may only be needed for content within `Bash` tool output events.

---

### [Impl-note] `--include-partial-messages` bandwidth and rendering implications
**Section:** Architecture
**Issue:** `--include-partial-messages` streams every token as it arrives. For a busy agent, this is hundreds of small JSON messages per second per session. With 5-10 active sessions, the server is parsing and (if the terminal is open) broadcasting thousands of small WS messages per second. This will likely be fine for a few sessions but could cause browser performance issues with many concurrent sessions.

**Suggested fix:** Consider only enabling `--include-partial-messages` for the currently-viewed terminal, or implementing server-side batching (accumulate partial messages for 100ms, send as one WS message).

---

### [Impl-note] Auto-reconnect WS without state sync is useless
**Section:** Phase 2 — useWebSocket.ts
**Issue:** "connect, auto-reconnect, message routing" — but on reconnect, the client's state is stale. The plan mentions `full_state` as a server→client message but doesn't specify when it's sent. It should be sent on every WS connection/reconnection, not just initial connection.

**Suggested fix:** Document that the server sends `full_state` on every new WS connection. The client should reset its state on reconnect and rebuild from `full_state`.

---

### [Impl-note] `react-markdown` + `remark-gfm` adds non-trivial bundle size
**Section:** Phase 8
**Issue:** These packages and their dependencies add ~100KB+ to the bundle. Not a problem for a localhost tool, but worth knowing.

**Suggested fix:** No plan change needed, just be aware during implementation.

---

## Summary

| Severity | Count |
|----------|-------|
| Critical | 3 |
| Must-fix | 6 |
| Medium | 5 |
| Low | 2 |
| Impl-note | 4 |
| **Total** | **20** |

## Overall Assessment

The plan reads well and the vision is clear, but it has a **load-bearing assumption that hasn't been validated** (multi-turn stream-json conversations via CLI), a **missing `-p` flag that will cause immediate failure**, and an **undefined permission model that changes everything downstream**.

The phasing is mostly logical but has some misorderings (Dagre should be Phase 2, context summarization should be Phase 3, error handling should be Phase 3). Phase 8 (plan viewer) feels like scope creep that should be cut or given a real integration story.

The conflict detection system is architecturally honest about what it can detect but dishonest about what it can prevent. The "human in the loop" story has a detection mechanism but no response mechanism — the user sees a red flash but can't actually respond to the agent.

Before writing any code: validate the stream-json multi-turn assumption. 15 minutes of manual testing either confirms the foundation or reveals you need a different architecture entirely.
