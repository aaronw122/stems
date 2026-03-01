# Repo Delete Cascade Plan Review — Product/UX (R2, Agent 3)

Reviewer focus: user-facing behavior, error states, interaction design, visual consistency, and DAG integrity during cascade deletion.

---

## Round 1 Fix Assessment

### R1 Must-fix #1: Visual "popping" from per-node broadcasts — FIXED

The plan now introduces a `tree_removed` server message with `{ type: 'tree_removed'; nodeIds: string[] }` and the client handles it in a single `set()` call filtering all IDs at once (Section 7). The server broadcasts once after the loop (Section 3, step 4). This is exactly the right approach. No issues.

### R1 Must-fix #2: Terminal subscription leak — FIXED

The plan adds `clearTerminalSubscriptions(nodeId)` as a new helper in `state.ts` (Section 1) and calls it in the per-node cleanup loop (Section 3, step 3). The helper deletes the entire subscription Set for the nodeId, which is correct. No issues.

### R1 Must-fix #3: Missing blast radius info in confirmation — FIXED

The plan now includes a client-side BFS in FlowCanvas (Section 6) that counts descendants by type and builds a details string: `"This will permanently delete [name] and N child nodes (X features, Y subtasks). Active sessions will be terminated."` The details are passed to the `ConfirmDialog` via a new `details` prop. This is the right pattern. No issues.

### R1 Medium: Selected node cleanup — FIXED

The `tree_removed` handler in `useGraph.ts` (Section 7) now checks if `selectedNodeId` is in the `removedSet` and clears it in the same `set()` call. This ensures the terminal panel closes in the same render frame the nodes disappear. Correct fix.

### R1 Medium: `getDescendants` fragile coupling — FIXED (partially)

The plan now takes a snapshot of edges at the top of `getDescendants`: `const snapshot = [...edges]`. This prevents iteration-during-mutation bugs. However, the function still implicitly reaches into the module-level `edges` array rather than taking it as a parameter. The snapshot approach is sufficient for correctness; the testability concern remains but is an impl-note level issue, not plan-level.

**Verdict: All 5 must-fix issues from R1 were addressed correctly.** The fixes are well-integrated and don't contradict other parts of the plan.

---

## New Issues Introduced by Fixes

### [Low] Duplicated BFS logic — client and server have identical traversal functions

**Section:** 1. `server/state.ts` and 6. `src/components/FlowCanvas.tsx`

**Issue:** The plan defines `getDescendants()` on the server (Section 1) and `getDescendantIds()` on the client (Section 6) with identical BFS logic. The data shapes differ slightly (server uses `WeftEdge[]`, client uses React Flow `Edge[]`), but both have `source` and `target` fields. This is a minor duplication concern. Because the two operate on different data stores (server-side state vs. Zustand), the duplication is justified — a shared utility would create an awkward cross-boundary import. Logging this for awareness, not as something to fix.

**Suggested action:** No change needed at plan level. During implementation, consider placing the client-side version in a utility file rather than inline in FlowCanvas, since other features (e.g., subtree collapse, subtree cost rollup) might need the same traversal.

---

## Remaining Issues

### [Medium] No error handling for partial cascade failure on the server

**Section:** 3. `server/index.ts` — Handle `delete_tree`

**Issue:** This was flagged as Medium in R1 and was not addressed in R2 of the plan. The cleanup loop calls `killSession(id)` for each descendant. `killSession` is async (it calls `proc.kill()` and awaits exit). If any call throws, the `.catch()` on line 410 of `server/index.ts` catches it and sends a generic "Internal server error" to the client. But by that point, some nodes may have already been removed via `removeNode()` and the `tree_removed` broadcast hasn't been sent yet. The user sees nothing happen (no nodes removed on the client) but some nodes are actually gone from server state. On reconnect or refresh, the client would get a `full_state` with the partially-deleted tree, which is confusing.

**Why this is plan-level:** The failure mode produces an inconsistent client/server state that can't be recovered without a page refresh, and even then the user sees a half-deleted tree with no explanation. This affects the core user experience of the feature.

**Suggested fix:** Wrap each per-node cleanup in a try/catch so one node's failure doesn't abort the loop. After the loop, always broadcast `tree_removed` with the nodes that were successfully cleaned up. If any nodes failed, log the error server-side. The user sees a clean removal of the nodes that succeeded, and the failed nodes remain visible (so the user can retry or investigate). Example:

```typescript
const cleanedIds: string[] = [];
for (const id of allIds) {
  try {
    await killSession(id);
    clearOverlapNode(id);
    stopPRTracking(id);
    clearTerminalBuffer(id);
    clearTerminalSubscriptions(id);
    removeFromDoneList(id);
    removeNode(id);
    cleanedIds.push(id);
  } catch (err) {
    console.error(`[delete_tree] failed to clean node ${id}:`, err);
  }
}
if (cleanedIds.length > 0) {
  broadcast({ type: 'tree_removed', nodeIds: cleanedIds });
}
```

---

### [Medium] Delete button placement and accidental click risk

**Section:** 5. `src/components/nodes/RepoNode.tsx`

**Issue:** Also flagged in R1 and not addressed. The plan says "Add a small delete button" but doesn't specify placement relative to the existing "+ Feature" button. Looking at the current RepoNode layout (line 21-33 of `RepoNode.tsx`), the bottom row has the branch name on the left and "+ Feature" on the right. If the delete button is placed adjacent to "+ Feature", misclicks between "spawn feature" and "delete entire repo tree" are a real risk with high-consequence outcomes.

**Why this is plan-level:** Button placement in a destructive-action context is an interaction design decision, not an implementation detail. Getting it wrong means rebuilding the component layout.

**Suggested fix:** Specify placement explicitly: add the delete button to the top-right corner of the node as a small icon (e.g., a trash icon or X), visually separated from the "+ Feature" button at the bottom-right. Use `opacity-0 group-hover:opacity-100` to hide it until the user hovers the node, reducing visual noise and accidental activation. Add `e.stopPropagation()` to prevent the click from also selecting the node.

---

### [Medium] No undo or grace period — still unaddressed

**Section:** 3. `server/index.ts` and 6. `src/components/FlowCanvas.tsx`

**Issue:** Flagged as Medium in R1. The plan still has no undo mechanism. Once confirmed, deletion is instant and irreversible. For a product managing Claude CLI sessions that cost real money and time, this is a significant UX gap. The confirmation dialog helps, but confirmation fatigue is well-documented — users develop muscle memory and click through without reading.

**Why this is still plan-level (but deferrable):** This is a product decision, not a bug. Logging it again for completeness. If deferred, it should be noted as known UX debt in the plan. The blast-radius info in the confirmation dialog (now added) mitigates this somewhat.

**Suggested action:** Add a brief note to the plan acknowledging this as a v2 enhancement: "Future: consider a 5-second undo toast pattern (optimistic UI removal with delayed server-side deletion)." This prevents future implementers from thinking the omission was accidental.

---

### [Low] Keyboard accessibility for ConfirmDialog — still unaddressed

**Section:** 4. `src/components/ConfirmDialog.tsx`

**Issue:** Flagged as Low in R1. The plan still doesn't mention Escape-to-cancel, focus trapping, or which button receives initial focus. Looking at the existing global Escape handler in `App.tsx` (line 82-91), Escape already closes the PromptEditor and deselects nodes. If the ConfirmDialog doesn't capture Escape itself, the global handler might close the terminal selection instead of the dialog, depending on render order.

**Why this matters slightly more than R1 suggested:** The existing Escape handler in App.tsx checks `promptEditor.isOpen` first, then `selectedNodeId`, then `doneListOpen`. The ConfirmDialog is not in this chain. If the dialog is open and the user presses Escape, the global handler will trigger — potentially deselecting the terminal or toggling the done list rather than closing the dialog. The dialog needs to either (a) handle Escape itself via `e.stopPropagation()` on a keydown listener, or (b) be integrated into the App.tsx Escape chain.

**Suggested fix:** Specify that the ConfirmDialog should: (1) listen for Escape keydown and call `onCancel`, with `e.stopPropagation()` to prevent the global handler from also firing; (2) auto-focus the Cancel button on mount (safe default for destructive actions).

---

### [Low] `close_node` handler also doesn't clean terminal subscriptions

**Section:** 3. `server/index.ts` — existing `close_node` handler (not part of this plan, but adjacent)

**Issue:** The plan correctly adds `clearTerminalSubscriptions` to the `delete_tree` cleanup sequence. But the existing `close_node` handler (line 219-231 of `server/index.ts`) has the same omission — it calls `killSession`, `clearOverlapNode`, `stopPRTracking`, `clearTerminalBuffer`, and `removeNode`, but never clears terminal subscriptions. This means closing a single node also leaks subscription entries. Since this plan is already adding the `clearTerminalSubscriptions` helper, it would be trivial to also add the call to `close_node`.

**Suggested fix:** Add a line to the plan: "Also add `clearTerminalSubscriptions(msg.nodeId)` to the existing `close_node` handler for consistency." This is a one-line change that fixes a pre-existing bug adjacent to the work being done.

---

### [Impl-note] `delete_tree` should validate the target node exists

**Issue:** Carried from R1 (still not addressed, but correctly scoped as impl-note). If a `delete_tree` message arrives for a nonexistent nodeId, `getDescendants` would return an empty array (no edges match), and the loop would try to clean up just the root nodeId — calling `killSession`, `removeNode`, etc. on a node that doesn't exist. These would likely no-op, but it's cleaner to early-return with an error. Handle during implementation.

---

### [Impl-note] `delete_tree` node type restriction

**Issue:** Carried from R1. The plan scopes the feature as "repo delete" but the `delete_tree` message accepts any `nodeId`. A `delete_tree` on a feature node would cascade-delete that feature's subtasks, which could be useful functionality. The plan should clarify intent: is `delete_tree` repo-only (validate on server), or is it a general subtree delete (rename the feature to "subtree delete")? Either is fine, but the ambiguity should be resolved before implementation.

---

### [Impl-note] Spawn race condition

**Issue:** Carried from R1. If a child node is mid-spawn when the parent repo is deleted, `killSession` might no-op because the session isn't registered yet. Handle with defensive checks during implementation (e.g., check for the session map entry, and if missing, set a "pending kill" flag that `spawnSession` checks before registering).

---

### [Impl-note] `done_list_updated` broadcast payload

**Section:** 3. `server/index.ts` — step 5

**Issue:** The plan says to broadcast `done_list_updated` if any nodes were pruned from the done list. Looking at how `close_node` broadcasts this (line 228), it sends `{ type: 'done_list_updated', doneList: getDoneList() }` — the full done list. This is correct because the client replaces its entire `doneList` state on this message. The plan should ensure the `delete_tree` handler does the same (sends the full `getDoneList()` result, not just the removed IDs). The plan's step 5 says "broadcast `done_list_updated`" without specifying the payload shape. During implementation, match the existing pattern.

---

## Summary

| Severity | Count | Status |
|----------|-------|--------|
| R1 Must-fix | 3 | All correctly addressed |
| R1 Medium (selected node, fragile coupling) | 2 | Both correctly addressed |
| Medium (remaining) | 3 | Partial failure handling, delete button placement, undo pattern — carried from R1 |
| Low (remaining) | 2 | Keyboard accessibility (with new Escape conflict detail), close_node subscription leak |
| Impl-note | 4 | Node existence validation, node type restriction, spawn race, done_list payload |

**Overall verdict:** The plan is in good shape. The three must-fix issues from R1 were all addressed correctly, and the fixes are clean — no new architectural problems introduced. The remaining Medium issues (partial failure handling, button placement, undo) are the same ones from R1. Of these, partial failure handling is the most important to resolve at the plan level because it affects client/server state consistency. The other two are product decisions that can be deferred with explicit acknowledgment in the plan.
