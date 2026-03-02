---
title: "Subagent Abstraction"
author: "human:aaron"
version: 4
created: 2026-03-02
supersedes: "auto-subtask-nodes (v2)"
---

# Subagent Abstraction

## WANT

When a Claude session spawns Agent subagents, the parent terminal should show a **compact, updating summary** matching the native Claude Code CLI format — not a flood of individual tool calls.

Two display surfaces:

### Parent Feature Terminal
- The compact summary is a **live widget** rendered as a separate section within the terminal panel (not a message in the terminal buffer), driven by a Zustand slice updated from `task_progress` events
- When all subagents complete, a static summary line is appended to the terminal buffer
- Summary header: `Running N [type] agents...`
- Per-agent line: `agent name · tool count · token count`
- Below each agent: a single updating status line showing what the agent is currently working on (cycles through current activity, like the native CLI's `└ Searching for 3 patterns, reading 14 files...`)
- Individual tool calls (Read, Bash, Grep, Explore, etc.) are **never listed** — they are counted as stats and the current one is shown on the cycling status line

### Phantom Subtask Nodes (DAG)
- Auto-appear when subagents spawn (requires new infrastructure — see Prerequisites)
- Display as **stat cards** — agent name, tool use count, token count, current status
- **No terminal view inside phantom nodes** — they are pure visualization cards
- Removed on completion (2s delay), kept on failure

### Token/Tool Use Tracking
- Track and display per-subagent: tool use count, token count
- Update in real-time as the subagent works
- Show on both the phantom node card and the parent terminal summary line

## Data Sources

All three are system-type messages handled in the `case 'system':` block of `processMessage` in `message-processor.ts`, where currently only `subtype === 'init'` is processed — the rest silently fall through. Implementation must add `else if` branches for `subtype === 'task_started'`, `subtype === 'task_progress'`, and `subtype === 'task_notification'` inside the existing `case 'system':` block.

| Behavior | SDK Message | Key Fields |
|---|---|---|
| Phantom node creation | `task_started` | `task_id`, `description`, `task_type` |
| Real-time stat updates | `task_progress` | `usage.total_tokens`, `usage.tool_uses`, `last_tool_name`, `description` |
| Completion / removal | `task_notification` | `task_id`, `status`, `summary` |

**Note:** Token count during execution is the combined `total_tokens` only (no input/output split). Live display uses the single total. The input/output breakdown is only available on final `result` messages.

## Message Sequence

The SDK emits messages in this order for each subagent:

1. **Agent `tool_use` block** — arrives in the parent's `assistant` message. Has `name: "Agent"`, `input.subagent_type`, and a `tool_use_id`. No `parent_tool_use_id` (it belongs to the parent). This triggers the compact summary widget to render.
2. **`task_started`** — system message keyed by `task_id`. Contains `description` and `task_type`. Implementation must correlate `task_started.tool_use_id` back to the Agent `tool_use` block to extract `subagent_type` (agent names are NOT present on task lifecycle messages). This creates the phantom node.
3. **`task_progress`** (repeated) — updates `usage.total_tokens`, `usage.tool_uses`, `last_tool_name`, `description`. Drives live stat updates on both the phantom node card and the compact summary widget.
4. **`task_notification`** — finalizes. `status: "completed"` or `status: "stopped"` triggers 2s delay then phantom node removal. `status: "failed"` keeps the phantom node visible with error state. (SDK type: `SDKTaskNotificationMessage.status` is `'completed' | 'failed' | 'stopped'`.)

## ServerMessage Contract

Phantom nodes integrate with the existing message pipeline — no new `ServerMessage` variants required:

- **Creation:** Reuses `node_added` with a `WeftNode` where `type: 'phantom'` and `isPhantomSubagent: true`. The `type: 'phantom'` value drives React Flow component selection (`PhantomNode`), dagre layout sizing, and MiniMap coloring — the `isPhantomSubagent` flag is a secondary guard for code paths that check data properties rather than node type
- **Updates:** Reuses `node_updated` — phantom-specific fields (`toolUseCount`, `totalTokens`, `currentActivity`) update via the standard path
- **Removal:** Reuses `node_removed` — phantom nodes use a distinct removal path (2s delay after `task_notification`, then `node_removed`; never enters `doneList`)

### WeftNode phantom fields (all optional, only present when `isPhantomSubagent: true`)
- `isPhantomSubagent: boolean`
- `toolUseCount: number`
- `totalTokens: number`
- `currentActivity: string`
- `subagentTaskId: string`

### useGraph.ts guards
- `node_added` auto-select logic must skip nodes where `node.type === 'phantom'` (the existing auto-select condition checks `msg.node.type === 'feature' || msg.node.type === 'subtask'` — phantom nodes naturally excluded if not added to this check)

### FlowCanvas.tsx click guard
- `FlowCanvas.onNodeClick` (the `NodeMouseHandler` passed to `ReactFlow`) must check `node.data.isPhantomSubagent` and skip `setSelectedNode` if true — phantom nodes are not selectable

## DON'T
- Don't render individual subagent tool calls in the parent terminal (no Read/Bash/Grep flood)
- Don't put a terminal/CLI inside phantom nodes — they're stat cards only
- Don't auto-select phantom nodes (guard required in `useGraph.ts` auto-select logic)
- Don't persist phantom nodes to disk — they live in a separate `Map` in `server/state.ts` with dedicated helpers that never call `scheduleSave`; the main `nodes` map and its CRUD helpers are untouched
- Don't break existing parent terminal output — the parent's own messages still render normally

### Message Suppression
- Message processor filters streaming messages (`assistant`, `stream_event`) where `parent_tool_use_id` is set — those are routed to the subagent tracker, not the parent terminal buffer
- Task lifecycle messages (`task_started` / `task_progress` / `task_notification`) are identified by `task_id` and routed to the subagent tracker
- The parent's own Agent `tool_use` block (which has no `parent_tool_use_id`) still renders normally and triggers the compact summary widget

## LIKE
- **Native Claude Code CLI subagent view** (right side of reference screenshot): compact tree-view with agent name, tool count, tokens, cycling status line. This is the target format.

## FOR
- Stems GUI users watching multi-agent orchestration
- The feature terminal and DAG canvas
- Requires new phantom node infrastructure (see Prerequisites)

## Prerequisites

No phantom node infrastructure exists in the codebase yet. The following must be built:

- **`shared/types.ts`**: Add `'phantom'` to the `NodeType` union (`'repo' | 'feature' | 'subtask' | 'phantom'`). Add `isPhantomSubagent` flag and optional phantom fields (`toolUseCount`, `totalTokens`, `currentActivity`, `subagentTaskId`) to `WeftNode`
- **`src/components/nodes/PhantomNode.tsx`**: Create a `PhantomNode` component that renders a stat card displaying: agent name, tool use count, token count, and current activity status line. No terminal view — pure visualization card
- **`src/components/FlowCanvas.tsx`**: Register the phantom component in `nodeTypes`: `{ repo: RepoNode, feature: FeatureNode, subtask: SubtaskNode, phantom: PhantomNode }`
- **`src/hooks/useGraph.ts`**: Add phantom node dimensions to dagre layout config (e.g., `PHANTOM_WIDTH` / `PHANTOM_HEIGHT` constants, and a `node.type === 'phantom'` branch in `getLayoutedElements` alongside the existing `isSubtask` branch). Guard `node_added` auto-select logic to skip nodes where `node.type === 'phantom'`
- **`server/message-processor.ts`**: Add `else if` branches for `task_started`, `task_progress`, and `task_notification` subtypes inside the existing `case 'system':` block (currently only `subtype === 'init'` is handled; the rest silently fall through)
- **`server/state.ts`**: Phantom nodes live in a separate `Map<string, WeftNode>` (not the main `nodes` map) with dedicated `addPhantomNode`/`updatePhantomNode`/`removePhantomNode` helpers that call `broadcast` but never `scheduleSave`. This ensures zero persistence leak. The existing `addNode`/`updateNode`/`removeNode` helpers remain unchanged

## ENSURE
1. When a feature spawns 3 subagents, parent terminal shows compact summary with 3 agent lines — not individual tool calls
2. Each agent line updates in real-time: tool count increments, token count grows, status line cycles
3. 3 phantom nodes appear in the DAG as stat cards with matching info
4. Individual tool calls (Read, Bash, Grep) never appear as separate lines in the parent terminal
5. Parent terminal's own output (non-subagent messages) still renders normally
6. Phantom nodes disappear after subagent completion (2s delay)
7. Failed subagents stay visible with error state
8. Phantom nodes are not persisted across server restart
9. Clicking a phantom node does not steal focus from parent terminal

## TRUST
- [autonomous] Visual layout of the compact summary in the terminal (match CLI as close as possible)
- [autonomous] Phantom node card design and stat placement
- [autonomous] Status line cycling logic and update frequency
- [autonomous] How to extract tool use count and token count from SDK messages
- [ask] Any changes to the message processing pipeline that would affect non-subagent message rendering
- [ask] Any changes to the phantom node lifecycle (creation/removal timing)
