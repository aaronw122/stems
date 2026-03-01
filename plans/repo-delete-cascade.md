---
revision: 2
---

# Plan: Repo Delete with Cascading Subtree Removal

## Context

There's no way to remove a repo node from the canvas. The existing `close_node` handler removes a single node but doesn't cascade to children — deleting a repo would orphan all its features and subtasks. We need a delete button on repo nodes with a confirmation dialog that removes the entire subtree (repo + all features + all subtasks), killing all active sessions along the way.

## Changes

### 1. `server/state.ts` — Add `getDescendants()` helper

BFS walk from a node through edges to collect all descendant IDs:

```typescript
export function getDescendants(nodeId: string): string[] {
  const snapshot = [...edges]; // snapshot — removeNode mutates edges in place
  const descendants: string[] = [];
  const queue = [nodeId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const edge of snapshot) {
      if (edge.source === current) {
        descendants.push(edge.target);
        queue.push(edge.target);
      }
    }
  }
  return descendants;
}
```

Also add two cleanup helpers:

```typescript
export function clearTerminalSubscriptions(nodeId: string): void {
  terminalSubscriptions.delete(nodeId);
}

export function removeFromDoneList(nodeId: string): boolean {
  const idx = doneList.findIndex((n) => n.id === nodeId);
  if (idx === -1) return false;
  doneList.splice(idx, 1);
  return true; // caller should broadcast done_list_updated when any return true
}
```

`clearTerminalSubscriptions` prevents leaked map entries and stale `broadcastTerminal` sends after a node is deleted. `removeFromDoneList` prunes already-completed descendants that were auto-moved to done before the tree was deleted, preventing ghost entries in the client sidebar.

### 2. `shared/types.ts` — Add `delete_tree` client message and `tree_removed` server message

Client message:

```typescript
| { type: 'delete_tree'; nodeId: string }
```

Server message (new — replaces per-node `node_removed` broadcasts for tree deletes):

```typescript
| { type: 'tree_removed'; nodeIds: string[] }
```

Using distinct message types keeps semantics clear: `close_node` moves to done list, `delete_tree` is permanent removal, and `tree_removed` lets the client batch-remove all nodes in a single store update (avoiding N re-renders and visible node-by-node "popping" on the canvas).

### 3. `server/index.ts` — Handle `delete_tree`

New case in `handleWsMessage`:

1. Call `getDescendants(nodeId)` to get all child IDs
2. Build full list: `[...descendantIds, nodeId]` (children first, root last)
3. For each node in the list:
   - `killSession(id)`
   - `clearOverlapNode(id)`
   - `stopPRTracking(id)`
   - `clearTerminalBuffer(id)`
   - `clearTerminalSubscriptions(id)`
   - `removeFromDoneList(id)` (track if any returned `true`)
   - `removeNode(id)`
4. After the loop, broadcast once: `broadcast({ type: 'tree_removed', nodeIds: allIds })`
5. If any nodes were pruned from the done list, also broadcast `done_list_updated`
6. Do NOT add to done list (this is a delete, not a close)

### 4. `src/components/ConfirmDialog.tsx` — New reusable confirmation modal

Follow the PromptEditor modal pattern (`bg-black/60 backdrop-blur-sm` overlay, `bg-zinc-800` card). Props:

```typescript
interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  details?: string;        // secondary line, e.g. blast radius summary
  confirmLabel: string;    // e.g. "Delete"
  onConfirm: () => void;
  onCancel: () => void;
  destructive?: boolean;   // red confirm button
}
```

Render `details` as a secondary `<p>` below the message (e.g. `text-sm text-zinc-400`). Reusable for future confirmations (not repo-delete-specific).

### 5. `src/components/nodes/RepoNode.tsx` — Add delete button

Add a small delete button (× or trash icon) to the repo node. On click, calls `onDelete(nodeId)` prop (passed down from FlowCanvas).

### 6. `src/components/FlowCanvas.tsx` — Wire delete flow

- Pass `onDelete` handler to RepoNode via `nodeTypes` data
- When called, run a client-side BFS over Zustand store edges to find all descendants:
  ```typescript
  function getDescendantIds(nodeId: string, edges: Edge[]): string[] {
    const descendants: string[] = [];
    const queue = [nodeId];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const edge of edges) {
        if (edge.source === current) {
          descendants.push(edge.target);
          queue.push(edge.target);
        }
      }
    }
    return descendants;
  }
  ```
- Count descendants by type from the Zustand nodes array. Build a details string:
  `"This will permanently delete [name] and N child nodes (X features, Y subtasks). Active sessions will be terminated."`
  If no children, omit the count portion.
- Show `ConfirmDialog` with title, message, and the `details` prop
- On confirm: `send({ type: 'delete_tree', nodeId })`
- On cancel: close dialog

### 7. `src/hooks/useGraph.ts` — Handle `tree_removed` and selected node cleanup

Add a `tree_removed` case to `processMessage`. This handles the batch removal in a single `set()` call — no per-node re-renders:

```typescript
case 'tree_removed': {
  const removedSet = new Set(msg.nodeIds);
  set((state) => ({
    nodes: state.nodes.filter((n) => !removedSet.has(n.id)),
    edges: state.edges.filter(
      (e) => !removedSet.has(e.source) && !removedSet.has(e.target),
    ),
    ...(state.selectedNodeId && removedSet.has(state.selectedNodeId)
      ? { selectedNodeId: null }
      : {}),
  }));
  break;
}
```

This eliminates the N-render "popping" problem and clears selection in the same frame if the user was viewing a terminal for any deleted node. The existing `node_removed` handler remains unchanged for single-node removals (e.g. `close_node` in `completion.ts`).

## Files

| File | Change |
|------|--------|
| `server/state.ts` | Add `getDescendants()`, `clearTerminalSubscriptions()`, `removeFromDoneList()` |
| `shared/types.ts` | Add `delete_tree` to `ClientMessage`, `tree_removed` to `ServerMessage` |
| `server/index.ts` | Add `delete_tree` handler with cascade cleanup + single `tree_removed` broadcast |
| `src/components/ConfirmDialog.tsx` | New reusable confirmation modal with optional `details` prop |
| `src/components/nodes/RepoNode.tsx` | Add delete button |
| `src/components/FlowCanvas.tsx` | Wire delete → client-side BFS blast radius → confirm → send |
| `src/hooks/useGraph.ts` | Add `tree_removed` handler (batch removal + selection clearing in single `set()`) |

## Verification

1. `bun run dev`
2. Add a repo → spawn a feature → spawn a subtask
3. Click delete on the repo node → confirmation dialog appears with blast radius ("1 feature, 1 subtask")
4. Click cancel → nothing happens
5. Click confirm → repo, feature, and subtask all disappear simultaneously (no popping)
6. Check server logs: all sessions killed, no orphans
7. If terminal was open for a child node, it should close (selection cleared)
8. If any child was in the done list, verify it's gone from the sidebar after deletion
9. No console errors about stale terminal subscriptions
