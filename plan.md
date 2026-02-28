---
revision: 3
---

# weft-flow: Agent Orchestration GUI

## Context

Scattered terminal tabs make it impossible to visualize what agents are doing across workstreams. weft-flow is a localhost GUI that replaces that chaos with a visual DAG: repos at the root, features branching off, subtasks at the leaves. Each node is a real Claude Code CLI session you can peek into, spawn children from, and track to completion. It's project management with zero overhead because it *is* the work.

**Location:** `/Users/aaron/weft-flow` (new standalone repo)
**Stack:** Bun + Vite + React + TypeScript + React Flow + Tailwind

---

## Architecture

### Core insight: Bidirectional JSON streaming with Claude CLI

```
claude -p --input-format stream-json \
          --output-format stream-json \
          --include-partial-messages \
          --add-dir /path/to/repo
```

This gives us:
- **stdin**: send JSON messages (user turns, permission responses) to Claude
- **stdout**: receive structured JSON events (assistant text, tool use, errors)
- Full Claude Code features (CLAUDE.md, skills, hooks) preserved automatically

No PTY, no terminal parsing. Just `Bun.spawn` with JSON pipes.

> **Agent SDK alternative:** `@anthropic-ai/claude-agent-sdk` should be evaluated during Phase 0 as a potential replacement for raw `Bun.spawn` + stream-json parsing. The SDK provides typed events, `canUseTool` callbacks, and session management. If viable, it eliminates `stream-parser.ts` entirely and simplifies the architecture significantly.

### Permission Model

v1 uses `--dangerously-skip-permissions` on all spawned sessions. This avoids every tool use triggering a `needs-human` state, which would make the GUI unusable for autonomous work.

- Every `Bun.spawn` invocation includes `--dangerously-skip-permissions`
- Without this flag, each tool call (Edit, Bash, Write, etc.) emits a permission prompt in the stream, requiring a `send_input` response before the agent can proceed
- **Future enhancement:** Add a granular permission UI — per-node toggle between "full auto" and "supervised" mode, where supervised surfaces each permission prompt in the TerminalPeek panel with approve/deny buttons

### Data model

```
Workspace
  └── Repo[] (root nodes — just a path + branch info)
       └── Feature[] (Claude CLI sessions)
            └── Subtask[] (Claude CLI sessions, context-summarized from parent)
```

Each node tracks:
- **nodeState**: `idle` | `running` | `needs-human` | `completed` | `crashed` (single authoritative lifecycle state)
- **displayStage**: `planning` | `executing` | `testing` (optional heuristic display layer, approximate — see Stage Detection; this is a rendering hint, NOT lifecycle state)
- **needsHuman**: boolean (red flash) + reason string
- **humanNeededType**: `"question"` | `"permission"` | `"error"` | `"idle"` | `null`
- **humanNeededPayload**: `unknown` (contextual data for the human-needed state — e.g., question text, error message)
- **sessionId**: `string | null` (Claude CLI session ID, null before spawn)
- **errorInfo**: `{ type: string; message: string } | null`
- **overlap**: what files/areas this node is touching (file overlap tracking)
- **prUrl / prState**: PR tracking via `gh` polling
- **title**: auto-generated from first assistant message, editable
- **costUsd**: `number` (accumulated cost for this session)
- **tokenUsage**: `{ input: number; output: number }`
- **x**: `number` (node position — dagre sets initial placement, user owns position after)
- **y**: `number`

### File overlap tracking

Each feature node declares what it's working on (auto-detected from file edits in the stream, or manually set). Other nodes see these declarations. The GUI shows:
- Green: no file overlap with active nodes
- Red: "overlaps with [Feature X]" (same files being edited)

v1 surfaces overlap visually but does **not** block or lock files. This is advisory only — the user decides whether to intervene. Future enhancement: advisory file locking to prevent concurrent edits.

Agents spawned from the GUI get this context injected: "These features are currently active: [list with areas]. Avoid modifying: [overlap zones]."

### Server (Bun)

Single `Bun.serve()` process:
- HTTP: serves Vite-built frontend + REST API (`/api/repos`, `/api/nodes`)
- WebSocket: Bun native pub/sub — `graph` topic for all state changes, `terminal:{nodeId}` for streaming output
- Process management: `Bun.spawn` for Claude CLI sessions, Map of live sessions
  - **Important:** `Bun.spawn` must set `cwd` to the repo path. `--add-dir` provides additional directory access but does NOT set the working directory

### Frontend (React + React Flow)

- React Flow canvas with custom node types (repo, feature, subtask)
- Stage badges, red flash animation, PR badges on nodes
- Click node → slide-out terminal peek panel (ANSI-rendered text in `<pre>`)
- Drag from node handle → prompt editor modal → spawn child
- Done list sidebar (session-scoped, clears on server restart)
- **Input mechanism in TerminalPeek:** text input at bottom of terminal panel. Shows contextual UI — free-text answer field for question prompts, approve/deny buttons for permission prompts

**Data flow separation (critical for performance):**

Terminal data (buffers, streaming output) must live in a **separate store** outside React Flow node data. React Flow nodes contain only graph-structural properties (nodeState, title, needsHuman, overlap, position). Terminal data flows through a parallel channel that `TerminalPeek` subscribes to directly. This prevents terminal streaming from causing React Flow re-renders.

**Terminal data store:** `Map<nodeId, string[]>` — rolling last ~500 lines per node, stored in a dedicated Zustand slice (or plain Map) completely outside React Flow node data. Server pushes `terminal_data` events over the `terminal:{nodeId}` WS topic; the frontend terminal store appends lines and trims to the buffer cap. `TerminalPeek` subscribes to this store by nodeId. No terminal data touches React Flow state at any point.

**Structural vs property graph updates:**

- Structural changes (node add/remove, edge changes) trigger dagre re-layout for newly added nodes only
- Property updates (stage, title, overlap status) patch individual node data in-place — no re-layout
- Batch property updates on a frame-aligned interval (`requestAnimationFrame` or 16ms throttle) to avoid render storms from rapid stream events
- Node positions: dagre applies only for initial placement. Once a node has been placed (or dragged by user), its position is owned by the user and persisted via `node_moved`

---

## Project structure

```
weft-flow/
├── package.json
├── tsconfig.json
├── vite.config.ts
├── index.html
├── server/
│   ├── index.ts              # Bun.serve — HTTP + WS + static
│   ├── state.ts              # In-memory state store + broadcast helpers
│   ├── session.ts            # Spawn/manage Claude CLI processes (Bun.spawn)
│   ├── stream-parser.ts      # Parse stream-json events, detect stages
│   ├── context-summary.ts    # Summarize parent context for child nodes
│   ├── pr-tracker.ts         # Poll gh CLI for PR status
│   └── overlap-tracker.ts    # Track file edits per node, detect file overlaps
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── hooks/
│   │   ├── useWebSocket.ts
│   │   ├── useGraph.ts       # WS messages → React Flow nodes/edges
│   │   └── useTerminal.ts    # Subscribe to terminal stream for a node
│   ├── components/
│   │   ├── FlowCanvas.tsx
│   │   ├── nodes/
│   │   │   ├── RepoNode.tsx
│   │   │   ├── FeatureNode.tsx
│   │   │   └── SubtaskNode.tsx
│   │   ├── panels/
│   │   │   ├── TerminalPeek.tsx
│   │   │   ├── PromptEditor.tsx
│   │   │   └── DoneList.tsx
│   │   └── ui/
│   │       ├── StageBadge.tsx
│   │       ├── HumanFlash.tsx
│   │       ├── PRBadge.tsx
│   │       └── OverlapBadge.tsx
│   └── styles/
│       └── flow.css
└── shared/
    └── types.ts              # WeftNode, WeftEdge, WS protocol, stages
```

---

## Build phases

### Phase 0: Architecture Validation Spike (~15 min)
- [ ] Manually test `claude -p --input-format stream-json --output-format stream-json` via piped stdin
- [ ] Confirm the process stays alive after one response and accepts subsequent user turns
- [ ] Document the exact JSON format for subsequent user turns (message shape, required fields)
- [ ] If the process exits after one message, identify a fallback: `--resume` with session IDs, or the Claude Agent SDK
- [ ] Evaluate `@anthropic-ai/claude-agent-sdk` as a potential replacement for raw `Bun.spawn` + stream-json parsing (see Architecture note). If viable, update Phase 1 plan accordingly
- [ ] **Gate:** Do not proceed to Phase 1 until the conversation model (multi-turn stream-json OR Agent SDK) is confirmed working

### Phase 1: Foundation — server + minimal graph
- [ ] `bun init`, install deps: `@xyflow/react`, `react`, `react-dom`, `vite`, `@vitejs/plugin-react`, `tailwindcss`, `ansi-to-html`
- [ ] `shared/types.ts` — WeftNode, WeftEdge, Stage, WS message protocol
- [ ] `server/state.ts` — in-memory Map, CRUD, broadcast helpers
- [ ] `server/index.ts` — Bun.serve with WS upgrade + static file serving
- [ ] `server/session.ts` — spawn `claude -p` via `Bun.spawn` with stream-json flags + `--dangerously-skip-permissions`, set `cwd` to repo path, pipe stdout to event parser
- [ ] `server/stream-parser.ts` — parse newline-delimited JSON from Claude, emit typed events
- [ ] **Orphaned process cleanup** (~20 lines): (1) maintain a PID file (`weft-flow.pids`) tracking all spawned child process IDs, (2) on server startup, read and kill stale PIDs from a previous run, (3) register `SIGTERM`/`SIGINT` handlers that kill all tracked child processes before exit. This prevents `--dangerously-skip-permissions` Claude processes from outliving the server
- [ ] Vite config with proxy to Bun server for dev
- [ ] **Test:** start server, connect with wscat, send `add_repo`, verify repo node broadcast

### Phase 2: React Flow canvas
- [ ] `src/App.tsx` — layout shell with React Flow canvas + sidebar area
- [ ] `src/hooks/useWebSocket.ts` — connect, auto-reconnect, message routing
- [ ] `src/hooks/useGraph.ts` — server state → React Flow nodes/edges with dagre layout
- [ ] `src/components/FlowCanvas.tsx` — React Flow with custom node types
- [ ] `src/components/nodes/RepoNode.tsx` — repo name + branch display
- [ ] `src/components/nodes/FeatureNode.tsx` — title + stage badge + spawn handle
- [ ] `src/components/nodes/SubtaskNode.tsx` — smaller variant of feature node
- [ ] "Add Repo" button + path input dialog
- [ ] **Test:** open browser, add a repo, see it render as a node

### Phase 3: Spawn sessions + terminal peek
- [ ] Spawn handle on nodes → opens PromptEditor modal
- [ ] `src/components/panels/PromptEditor.tsx` — textarea + launch button
- [ ] Wire `spawn_feature` / `spawn_subtask` messages to server → `Bun.spawn` Claude
- [ ] `src/hooks/useTerminal.ts` — subscribe to `terminal:{nodeId}`, buffer output
- [ ] `src/components/panels/TerminalPeek.tsx` — slide-out panel, ANSI-rendered `<pre>`, auto-scroll, text input at bottom for responding to agent questions/permissions (contextual: free-text for questions, approve/deny for permissions)
- [ ] **Test:** add repo, spawn feature with "list all files", click to peek, see live Claude output
- [ ] Minimal context passing for child nodes: inject parent's original prompt + first assistant message into child's system prompt via `--append-system-prompt`
- [ ] Note: this adds latency (parent must have produced at least one response) and cost (extra tokens in system prompt). Full summarization deferred to Phase 7

### Phase 4: Stage detection + auto-title + human-needed
- [ ] `server/stream-parser.ts` — detect stage from tool use patterns:
  - planning (default) → executing (first Edit/Write) → testing (Bash with test command) → done (session ends)
- [ ] Auto-title: extract from first meaningful assistant text
- [ ] Human-needed detection: parse for errors, AskUserQuestion in stream, idle timeout
- [ ] `src/components/ui/StageBadge.tsx` — colored pill (blue/yellow/green/gray)
- [ ] `src/components/ui/HumanFlash.tsx` — red pulse CSS animation on node border
- [ ] Editable title (click-to-edit on node)
- [ ] **Test:** spawn a real feature task, watch stage progress, see auto-title appear

### Phase 5: File overlap tracking
- [ ] `server/overlap-tracker.ts` — track file paths from Edit/Write tool use per node
- [ ] Compare active nodes' file sets for overlap detection
- [ ] Inject overlap context into spawned session prompts
- [ ] `src/components/ui/OverlapBadge.tsx` — green/red indicator (no yellow — directory-level overlap causes alert fatigue)
- [ ] **Test:** spawn two features touching different files (green), then same files (red)

### Phase 6: PR tracking + criteria gates + done list
- [ ] `server/pr-tracker.ts` — detect `gh pr create` in stream, extract URL, poll status every 30s
- [ ] `src/components/ui/PRBadge.tsx` — link + status chip (open/merged/closed)
- [ ] Criteria gate on node completion: PR merged + all children done
- [ ] `src/components/panels/DoneList.tsx` — collapsible sidebar, session-scoped
- [ ] Node removal from graph when moved to done list
- [ ] **Test:** run a session that creates a PR, see badge, merge it, see node move to done list

### Phase 7: Context summarization refinement
- [ ] `server/context-summary.ts` — upgrade from Phase 3's raw prompt+response injection to a proper summary: spawn a quick `claude -p` call to summarize parent's terminal buffer into a concise context block
- [ ] Pre-fill PromptEditor with editable summary when spawning children (replaces the raw injection from Phase 3)
- [ ] Measure latency and cost impact of summarization calls
- [ ] **Test:** spawn feature, let it run, spawn subtask from it, verify summary is concise and accurate in prompt editor

### Phase 8: Polish
- [ ] Dagre auto-layout (left-to-right tree matching the sketch)
- [ ] Dark mode (Tailwind + React Flow `colorMode="dark"`)
- [ ] Multi-repo view (multiple root nodes)
- [ ] Keyboard shortcuts (Esc to close panels, Cmd+N for new repo)
- [ ] Error handling (session crashes, WS reconnect with state sync)
- [ ] `bun install && bun start` one-liner startup

---

## Stage detection

### Node state (authoritative lifecycle)

| State | Meaning |
|-------|---------|
| `idle` | Node exists but no Claude process has been spawned yet |
| `running` | Session is running and producing output |
| `needs-human` | Session is blocked — waiting for human input (question, permission, error, idle timeout) |
| `completed` | Session has completed (result message received) |
| `crashed` | Process exited unexpectedly or with non-zero exit code |

### Display stage (heuristic, approximate)

The display stage is an optional visual hint layered on top of `running`. It is approximate and v1 heuristics will need iteration. Manual stage override is a future enhancement.

| From → To | Trigger |
|-----------|---------|
| (new) → planning | Default on creation |
| planning → executing | First `Edit` or `Write` tool use in stream |
| executing → testing | `Bash` tool use with test command (`bun test`, `pytest`, `vitest`, etc.) |
| testing → executing | Tests fail → Claude edits more code |

## Human-needed detection

| Signal | How detected |
|--------|-------------|
| Agent asks a question | `AskUserQuestion` tool use in stream-json |
| Agent errors | Error event in stream |
| Agent stuck | No events for 120+ seconds |
| Permission needed | If not using `--dangerously-skip-permissions`, permission prompts in stream |

## WS protocol (key messages)

**Client → Server:**
- `add_repo`, `spawn_feature`, `spawn_subtask`
- `subscribe_terminal`, `unsubscribe_terminal`
- `update_title`, `close_node`
- `node_moved` — `{ nodeId: string, x: number, y: number }` (user dragged a node; persists position so dagre doesn't override it)
- `send_input` — responds to agent questions/permissions. Payload is one of:
  - `{ type: "question_answer", questionText: string, answer: string }` — answer to an `AskUserQuestion`
  - `{ type: "permission", allow: boolean }` — approve/deny a permission prompt (if not using `--dangerously-skip-permissions`)
  - `{ type: "text_input", text: string }` — freeform text input to the agent

**Server → Client:** `full_state`, `node_added`, `node_updated`, `node_removed`, `terminal_data`, `done_list_updated`, `error`

---

## Future enhancements

- **Plan viewer:** Markdown file viewer panel — open any `.md` file with rendered formatting (react-markdown + remark-gfm). Triggered from a "View Plan" button or by associating a plan file with a repo/feature node. Split view option: plan on the left, graph on the right.
- **Granular permission UI:** Per-node toggle between "full auto" and "supervised" mode
- **Advisory file locking:** Prevent concurrent edits to overlapping files across nodes
- **Manual stage override:** Let users set the display stage explicitly

---

## Verification

1. `bun install && bun dev` — server starts on :4800, Vite on :5173
2. Open browser → see empty canvas with "Add Repo" button
3. Add a repo → node appears
4. Spawn a feature → see Claude output streaming in terminal peek
5. Watch stage badge change as Claude plans → edits → tests
6. Spawn a subtask from the feature → see context summary pre-filled
7. See red flash when agent needs input
8. See PR badge when agent creates a PR
9. Complete a feature → moves to done list
10. Kill server → done list clears (session-scoped)
