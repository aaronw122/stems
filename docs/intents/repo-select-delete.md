---
title: "Repo Select & Delete"
author: "human:aaron"
version: 1
created: 2026-03-02
---

# Repo Select & Delete

## WANT
- Clicking a repo card **selects** it (border highlight) but does NOT open the terminal
- Pressing Delete key when a repo is selected triggers the existing ConfirmDialog
- Accepting the confirmation deletes the repo (via existing `delete_tree` flow)

## DON'T
- Don't change feature or subtask node click behavior (those keep current behavior)
- Don't add multi-select
- Don't change the delete_tree server logic

## LIKE
- Standard desktop app pattern: click to select, Delete to remove

## FOR
- Stems GUI users managing repos on the canvas

## ENSURE
- Clicking a repo card shows border highlight, no terminal opens
- Pressing Delete with selected repo shows ConfirmDialog
- Confirming delete removes the repo and its tree
- Pressing Escape or Cancel in dialog cancels deletion
- Delete key with no selection or non-repo selection does nothing
- Feature/subtask node clicks still open terminal as before

## TRUST
- [autonomous] Implementation approach, component structure, styling choices
- [autonomous] Commit messages and PR creation
