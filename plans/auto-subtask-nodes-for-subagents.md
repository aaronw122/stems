# Plan: Auto-Create Subtask Nodes for Agent Subagents

**Revision:** 3

## Context

When a Claude session spawns Agent subagents (e.g., "spawn a few clear claudes to investigate bugs"), those subagents currently show as tool_use messages in the parent terminal. The user wants them to automatically appear as subtask nodes in the DAG — each with its own terminal you can peek into. When the subagent completes, the subtask node is removed (ephemeral visualization); failed subagents remain visible.

The SDK provides task lifecycle messages for subagent tracking: `SDKTaskStartedMessage` (subtype `task_started`), `SDKTaskProgressMessage` (subtype `task_progress`), and `SDKTaskNotificationMessage` (subtype `task_notification` with `status: 'completed' | 'failed' | 'stopped'`). These arrive as `system`-type messages in the parent's stream and use `task_id` as the consistent identifier. Agent `tool_use` blocks also appear in assistant messages but are for display only (showing the user that an Agent was invoked) — not for lifecycle tracking.

The SDK also provides `parent_tool_use_id` on `SDKAssistantMessage` and `SDKPartialAssistantMessage`, which could let us route subagent output to the phantom node's terminal. However, this routing is **unverified** — the SDK may only surface `task_progress` summaries rather than full message streams with `parent_tool_use_id` set. V1 uses task lifecycle messages only; `parent_tool_use_id` routing is aspirational/v2.

## Prerequisite: Verify SDK Message Flow

**Before implementing**, log raw SDK messages during an Agent tool invocation to confirm:
1. The exact sequence of `task_started` → `task_progress` → `task_notification` messages
2. The field contents of each (especially `task_id`, `description`, `summary`, `status`)
3. Whether `parent_tool_use_id` appears on any messages in the parent stream
4. Whether `task_progress` messages contain useful intermediate text for terminal display

This step is essential — no one has verified the exact message flow yet, and the implementation depends on it.

## Approach

Detect `task_started` system messages → create phantom subtask nodes → show `task_progress` updates in phantom terminal → on `task_notification`, complete/fail/remove the node based on status.

**V1 (reliable minimal):** Task lifecycle messages only. Phantom terminals show `task_progress` intermediate updates and `task_notification` summaries.

**V2 (enhanced, if verified):** If `parent_tool_use_id` routing works, route full subagent message streams to phantom node terminals for rich output.

## Files Modified (6)

### 1. `shared/types.ts` — Add phantom node fields

Add to `WeftNode`:
```ts
isPhantomSubagent?: boolean;    // marks auto-created visualization nodes
subagentTaskId?: string;        // correlates back to the SDK task_id
```

### 2. `server/message-processor.ts` — Core routing (~80 lines)

**New state**: `activeSubagents: Map<string, string>` mapping `taskId → phantomNodeId`

**New helpers**:
- `createSubagentNode(taskId, taskName)` — creates WeftNode + edge via `addPhantomNode` (see §5), broadcasts `node_added`, registers in map
- `removeSubagentNode(taskId)` — marks completed, removes after 2s delay, broadcasts `node_removed`
- `failSubagentNode(taskId)` — marks as crashed/errored, does NOT auto-remove (stays visible)

**Modified `processMessage` — `system` case** (primary detection mechanism):
- On `subtype === 'task_started'`: call `createSubagentNode(msg.task_id, msg.description)` to spawn the phantom node
- On `subtype === 'task_progress'`: if `msg.task_id` matches an active subagent, route the progress text to the phantom node's terminal via `broadcastTerminal`
- On `subtype === 'task_notification'`:
  - `status === 'completed'` → show `msg.summary` in phantom terminal, mark completed, remove after 2s delay
  - `status === 'failed'` → show error in phantom terminal, mark crashed/errored, **keep visible** (do NOT auto-remove)
  - `status === 'stopped'` → treat as completed, remove after 2s delay

**`handleAssistant` — display only** (no changes needed for lifecycle):
- Agent `tool_use` blocks in assistant messages still appear in the parent terminal as `tool_use` entries (existing behavior). These show the user that an Agent was invoked but are NOT used for phantom node creation or lifecycle tracking.

**V2 enhancement (if `parent_tool_use_id` routing verified)**:
- Before the switch statement, check `parent_tool_use_id` on the incoming message
- If it matches an active subagent, set `targetNodeId` to the phantom node
- Use `targetNodeId` instead of `nodeId` in the `broadcastTerminal` call at the end
- This would give phantom nodes full rich terminal output instead of just `task_progress` summaries

**Cleanup**: On processor cleanup, remove any remaining phantom nodes (completed ones immediately, failed ones too since the session is ending).

### 3. `server/completion.ts` — Skip phantom nodes

- `autoMoveIfComplete`: early return if `node.isPhantomSubagent`
- `getChildNodes` / `checkCompletionCriteria`: skip phantom children so they don't block parent completion

### 4. `server/index.ts` — Guards and startup cleanup

- `close_node` handler: don't add phantom nodes to done list
- Startup: sweep persisted nodes and remove any with `isPhantomSubagent === true` (catches nodes that leaked via `updateNode` persistence — see §5)

### 5. `server/state.ts` — `addPhantomNode` helper

Phantom nodes are transient by design and must NOT be persisted to disk. The existing `addNode` calls `scheduleSave`, which would write them to the workspace file.

Add an `addPhantomNode(node, edge)` variant that:
- Registers the node and edge in the in-memory maps (same as `addNode`)
- Broadcasts `node_added` (same as `addNode`)
- Does **NOT** call `scheduleSave`

This is cleaner than filtering in serialization because it makes the transient intent explicit at the call site.

**Persistence leak note:** While `addPhantomNode` skips persistence on creation, subsequent lifecycle updates via `updateNode` (e.g., marking a phantom node as completed or crashed) unconditionally call `scheduleSave`, which will persist the phantom node as a side effect. Rather than threading a `skipSave` flag through every `updateNode` call path, the pragmatic v1 approach is to let this happen and rely on the startup sweep (§4) as the real safety net. To support this, add `isPhantomSubagent` to the `PersistedNode` type so the startup sweep can identify and clean up any phantom nodes that leaked into the workspace file.

### 6. `src/hooks/useGraph.ts` — Frontend guards for phantom nodes

Two required changes:

**`node_added` handler — skip auto-select for phantom nodes:**
The existing auto-select logic (`const autoSelect = msg.node.type === 'feature' || msg.node.type === 'subtask'`) would steal focus to phantom nodes. Add a phantom check:
```ts
const autoSelect = (msg.node.type === 'feature' || msg.node.type === 'subtask')
  && !msg.node.isPhantomSubagent;
```

**`node_removed` handler — clear `selectedNodeId` if removed:**
Phantom nodes are the first auto-removing nodes. The current `node_removed` handler does not clear `selectedNodeId` (unlike `tree_removed` which does). Add:
```ts
case 'node_removed': {
  set((state) => ({
    nodes: state.nodes.filter((n) => n.id !== msg.nodeId),
    edges: state.edges.filter(
      (e) => e.source !== msg.nodeId && e.target !== msg.nodeId,
    ),
    ...(state.selectedNodeId === msg.nodeId ? { selectedNodeId: null } : {}),
  }));
  break;
}
```

## What We're NOT Doing

- No nested subagent tracking (v1 — inner subagents fall through to parent terminal)
- No separate SDK sessions for phantom nodes — they're pure visualization
- No `parent_tool_use_id` message routing in v1 — task lifecycle messages only (see Approach for v2 path)
- No auto-select of phantom nodes (they'd steal focus from the parent terminal)

## Verification

**Prerequisite verification (do this first):**
1. Add temporary logging in `processMessage` to dump raw SDK messages (`console.log(JSON.stringify(msg))`)
2. Spawn a feature node, send: "Search for all TODO comments — use an Explore agent"
3. Inspect logged messages — confirm `task_started`, `task_progress`, `task_notification` sequence and field contents
4. Check whether any messages have `parent_tool_use_id` set — document findings for v2 decision

**Functional verification:**
1. `bun run dev`
2. Spawn a feature node, send: "Search for all TODO comments — use an Explore agent"
3. Verify: a subtask node appears in the DAG with title from `description` and state "running"
4. Click the subtask node — verify its terminal shows `task_progress` updates (and completion summary)
5. Verify clicking a phantom node does NOT auto-select it (focus stays on parent)
6. When the agent finishes, verify the subtask node disappears after ~2s
7. Verify parent terminal still shows its own output correctly
8. Test with multiple concurrent agents (ask Claude to spawn 2-3 in parallel)
9. Test failed subagent: verify it stays visible with crashed/errored state (does NOT auto-remove)
10. Verify phantom nodes are NOT persisted — restart the server and confirm they don't reappear
11. Verify that removing a selected phantom node clears selection (no stale `selectedNodeId`)
