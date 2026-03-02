---
title: "Persist Workspace"
author: "human:aaron"
version: 1
created: 2026-03-01
---

# Persist Workspace

## WANT
Repos, features, and subtasks survive server restarts. When the user stops the Stems server and re-runs it, all previously added repos and their tree structure (features, subtasks) are restored automatically.

## DON'T
- No external database (no Postgres, SQLite, Supabase)
- No heavy infrastructure — file-based persistence only
- Don't persist active Claude CLI sessions — only the static tree structure
- Don't persist canvas layout/positions — auto-layout is fine on reload

## LIKE
- JSON file on disk, like most local dev tools and Electron apps

## FOR
- Single user running locally on localhost
- Small scale — handful of repos, not hundreds
- Bun + TypeScript server environment

## ENSURE
- Add a repo, restart server → repo is still there
- Add features/subtasks under a repo, restart → tree structure intact
- Running sessions are NOT restored on restart (only static node data)
- Corrupted or missing persistence file → app starts fresh without crashing

## TRUST
- [autonomous] File format, location, and schema design
- [autonomous] Save trigger strategy (on change, debounced, etc.)
- [autonomous] Implementation details after plan approval
- [ask] The overall plan/approach before implementation begins
