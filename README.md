# Stems

A localhost GUI for visualizing and managing Claude Code agent sessions as a visual DAG. Repos at the root, features branching off, subtasks at the leaves. Each node is a real Claude CLI session you can peek into, spawn children from, and track to completion.

**Stack:** Bun + Vite + React + TypeScript + React Flow + Tailwind + Zustand

## Prerequisites

- [Bun](https://bun.sh) (v1.2+)
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) (v2.1+)
- A Claude account (Max, Pro, or API key)

## Setup

### 1. Install dependencies

```bash
bun install
```

### 2. Authenticate Claude Code

Stems uses the [Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) to spawn sessions. You need one of the following auth methods:

#### Option A: Max/Pro subscription (recommended)

By default, the Agent SDK bills against API credits — not your Max/Pro subscription. To use your subscription instead, export your OAuth token:

```bash
claude setup-token
```

This outputs your OAuth token. Set it as an environment variable:

```bash
export CLAUDE_CODE_OAUTH_TOKEN=<token from above>
```

Add it to your `~/.zshrc` or `~/.bashrc` to persist across sessions:

```bash
echo 'export CLAUDE_CODE_OAUTH_TOKEN=<token>' >> ~/.zshrc
```

#### Option B: API key

Set your Anthropic API key:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

This bills directly against your API credit balance. Opus 4.6 sessions can burn through credits quickly.

## Running

```bash
# Start both server and client
bun run dev

# Or run them separately
bun run dev:server   # Bun WebSocket server
bun run dev:client   # Vite dev server
```

The client opens at `http://localhost:5173` and the server runs on `http://localhost:3000`.

## Usage

1. Click the canvas to add a **repo node** — pick a local git repository
2. Click a repo to spawn a **feature node** — type a prompt to start a Claude session
3. Feature sessions can spawn **subtask nodes** automatically when Claude uses subagents
4. Click any node to peek into its terminal output, send follow-up messages, or stop the session

## Architecture

```
src/              → Vite/React frontend (browser UI)
  components/     → React components (FlowCanvas, nodes, panels)
  hooks/          → Zustand stores and custom hooks
  styles/         → CSS
server/           → Bun WebSocket server (spawns/manages Claude sessions)
shared/           → Types shared between client and server
```

## License

MIT
