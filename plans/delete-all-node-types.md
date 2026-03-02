# Plan: Enable Delete Key for All Node Types

## Context

Currently, pressing Delete/Backspace only removes **repo** nodes. The keyboard handler in `FlowCanvas.tsx` explicitly filters for `n.type === 'repo'`, ignoring selected feature and subtask nodes. The server, store, and message types already support deleting any node type — this is purely a client-side restriction.

## Changes

### 1. Remove repo-only filter in Delete handler
**File:** `src/components/FlowCanvas.tsx` (line 101)

Change:
```typescript
const firstSelectedRepo = nodes.find((n) => n.selected && n.type === 'repo');
```
To:
```typescript
const firstSelected = nodes.find((n) => n.selected);
```

### 2. Make confirmation dialog title dynamic
**File:** `src/components/FlowCanvas.tsx` (line 180)

Currently hardcoded to `"Remove Repo"`. Change to derive from node type:
- repo → "Remove Repo"
- feature → "Remove Feature"
- subtask → "Remove Subtask"

### 3. Fix dialog message for non-repo nodes
**File:** `src/components/FlowCanvas.tsx` (line 66-67)

The `nodeName` fallback is `'this repo'`. Change to a generic fallback like `'this node'`, or derive from node type.

**That's it.** No server changes, no store changes, no new message types.

## Verification

1. Select a feature node → press Delete → confirmation dialog appears with "Remove Feature"
2. Select a subtask node → press Delete → confirmation dialog appears with "Remove Subtask"
3. Select a repo node → press Delete → still works as before
4. Marquee-select multiple nodes → press Delete → first selected node triggers confirmation
5. Confirm removal → node and descendants are removed from canvas
