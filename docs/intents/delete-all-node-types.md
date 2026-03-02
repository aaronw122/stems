---
title: "Delete All Node Types"
author: "human:aaron"
version: 1
created: 2026-03-02
---

# Delete All Node Types

## WANT
- Pressing Delete/Backspace when **any** node type is selected (feature or subtask) triggers the ConfirmDialog — not just repo nodes
- Cascading delete: deleting a feature removes it and all its subtasks; deleting a subtask removes just that leaf node
- Confirmation dialog title and message adapt to the node type being deleted ("Remove Feature", "Remove Subtask")
- Blast radius summary in the dialog adapts accordingly (e.g. feature with 3 subtasks shows the count)

## DON'T
- Don't add new UI affordances (no delete buttons on feature/subtask nodes, no right-click context menus)
- Don't change existing repo node delete behavior or its delete button
- Don't touch server-side logic — `delete_tree` already handles any node type
- Don't change `tree_removed` handler in the store — it's already generic
- Don't add multi-select delete (first selected node only, same as current)

## LIKE
- The existing repo select + delete flow — same UX, just extended to all node types

## FOR
- Stems GUI users who want to clean up feature branches or subtasks from the canvas

## ENSURE
- Selecting a feature node → pressing Delete → ConfirmDialog appears with "Remove Feature"
- Selecting a subtask node → pressing Delete → ConfirmDialog appears with "Remove Subtask"
- Selecting a repo node → pressing Delete → still works exactly as before ("Remove Repo")
- Confirming a feature delete removes the feature and all its subtasks simultaneously
- Confirming a subtask delete removes just that subtask
- Cancel/Escape in dialog cancels deletion for all node types
- Delete key with no selection does nothing (unchanged)
- Dialog details string correctly reflects descendant counts per type
- Fallback name in dialog says "this node" instead of "this repo" for non-repo nodes

## TRUST
- [autonomous] Implementation approach — the existing `plans/delete-all-node-types.md` already specifies the exact changes
- [autonomous] Commit messages and PR creation
