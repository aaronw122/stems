# Stems — Agent Orchestration GUI

## About

A localhost GUI for visualizing and managing Claude Code agent sessions as a visual DAG: repos at the root, features branching off, subtasks at the leaves. Each node is a real Claude CLI session you can peek into, spawn children from, and track to completion.

**Stack:** Bun + Vite + React + TypeScript + React Flow + Tailwind + Zustand

## Architecture

```
src/              → Vite/React frontend (browser UI)
  components/     → React components (FlowCanvas, nodes, panels)
  hooks/          → Zustand stores and custom hooks
  styles/         → CSS
server/           → Bun WebSocket server (spawns/manages Claude CLI sessions)
shared/           → Types shared between client and server
```

### Key architectural patterns

- **Bidirectional JSON streaming** with Claude CLI via `Bun.spawn` + `--input-format stream-json --output-format stream-json`
- **WebSocket bridge** between browser and server — client sends commands, server relays Claude CLI events
- **React Flow** for the DAG canvas — controlled mode with Zustand store managing nodes/edges
- **Permission model:** v1 uses `--dangerously-skip-permissions` on all spawned sessions

## Package Manager

**This project uses Bun, not npm.** Use `bun` for all package management and script execution:

```bash
# Package management
bun install          # Install dependencies
bun add <package>    # Add a dependency
bun add -d <package> # Add a dev dependency
bun remove <package> # Remove a dependency

# Running scripts
bun run dev          # Start dev server (server + client)
bun run dev:server   # Start server only
bun run dev:client   # Start Vite client only
bun run build        # Build for production
bun run start        # Start production server

# Running files directly
bun run file.ts      # Execute a TypeScript file directly
```

**NEVER use npm, npx, yarn, or pnpm.** If you see a command in docs or Stack Overflow that uses npm, translate it to the bun equivalent before running.

Common translations:
```bash
npx tsc --noEmit    → bunx tsc --noEmit
npx vite            → bunx vite
npm test            → bun test
npm run build       → bun run build
```

## Context

Early-stage personal project. Prioritize simplicity — avoid over-engineering. Ship quality core software efficiently.

**Push back like a senior engineer.** If a request could cause bugs, side effects, technical debt, or architectural problems — say so directly. Don't just execute questionable instructions; flag concerns and propose better alternatives.

## Documentation

- **`plan.md`**: Main implementation plan with architecture and phasing
- **`notes/`**: Work-in-progress material, review outputs, session findings
- **`plans/`**: Specific implementation plans

**Reviews and session notes go in `notes/`.** Use descriptive filenames like `notes/2026-02-28-<topic>.md`.

### Plan → Worktree workflow

**Every new plan gets its own worktree.** When creating a plan document in `plans/`, immediately:

1. Create a worktree + branch: `git worktree add .claude/worktrees/<plan-name> -b feat/<plan-name>`
2. Write the plan file inside that worktree (e.g., `.claude/worktrees/<plan-name>/plans/<plan-name>.md`)
3. Commit the plan file on that branch

**Why:** Plans written on the current branch pollute it with unrelated changes, block branch switching, and create merge confusion. Isolating from the start means the plan and its implementation live together on a dedicated branch — clean history, no stashing, no accidents.

**When executing a plan**, the worktree already exists. Use `isolation: "worktree"` for subagents, or work directly in the plan's worktree.

**Naming:** Branch and worktree name should match the plan filename. `plans/delete-all-node-types.md` → branch `feat/delete-all-node-types`, worktree `.claude/worktrees/delete-all-node-types`.

## Safety Rules

**Branch check before any edits.** Before modifying any file, run `git branch --show-current` and confirm the current branch is the correct branch for this task. If it's `main`/`master`, or an unrelated feature branch, **stop — do not edit.** Instead, create a worktree for the new work: `git worktree add .claude/worktrees/<task-name> -b feat/<task-name>` and work there. The only time you should edit in-place is when the current branch already belongs to the task at hand. When in doubt, ask.

**Worktree isolation for subagents.** Any Agent tool call that creates branches, switches branches, or does work intended for a different branch **must** use `isolation: "worktree"`. This gives the agent its own copy of the repo, preventing branch collisions where edits land on the wrong branch. If unsure whether an agent needs isolation, default to using it — the cost is negligible, the cost of a branch collision is not.

**NEVER execute these commands without explicit user approval:**

```bash
rm -rf, rm -f, find . -delete
git push --force, git reset --hard
git push origin main, git push origin HEAD:main
```

## Testing

**Unit test fixes:** When asked to fix failing unit tests, first understand why they failed. Treat failures as strong signals of incorrect logic, not just brittle tests.

**Test runs:** Whenever you run tests, always report the number of failing tests in your final output.

No test suite configured yet.

## `gh` CLI and Claude Code Sandbox

**`gh` commands MUST use `dangerouslyDisableSandbox: true`.** Claude Code's network sandbox breaks Go TLS verification (`x509: OSStatus -26276`). There is no workaround.

## Self-Improvement

If you notice a pattern, convention, or piece of knowledge that would help future sessions, suggest adding it to this file.

## Lessons Learned

- **Kill background agents before dev servers.** "Clear" agents can outlive tasks and trigger reload loops.
  - **Diagnose:** `pgrep -lf 'claude -p|codex exec|gemini -m'`
  - **Kill:** `pkill -f 'claude -p'; pkill -f 'codex exec'; pkill -f 'gemini -m'`
  - **Verify ports free:** `lsof -i :3000` and `lsof -i :5173`
