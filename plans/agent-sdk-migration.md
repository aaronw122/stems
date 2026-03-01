# Plan: Migrate from CLI Wrapping to Agent SDK

## Context

The Stems server currently spawns Claude CLI via `Bun.spawn` with `--input-format stream-json` for bidirectional communication. This flag is undocumented and buggy — it hangs during initialization, making the terminal completely non-functional. The official approach for programmatic Claude Code integration is the Agent SDK (`@anthropic-ai/claude-agent-sdk`), which handles all subprocess/protocol details internally and provides typed TypeScript messages.

## Approach

Replace `Bun.spawn` + stdin/stdout parsing with the SDK's `query()` async generator. Multi-turn conversations use a **MessageChannel** pattern — a producer-consumer queue where WebSocket `send_input` pushes messages and the SDK's async generator pulls them.

```
[Browser] --WS--> [index.ts] --push--> [MessageChannel] <--pull-- [SDK query()]
                                                                        |
                                                                   [SDKMessage stream]
                                                                        |
                                                                   [message-processor.ts]
                                                                        |
                                                               [state.ts / terminal / overlap / PR]
```

The WebSocket protocol and all client code stay unchanged.

## Steps

### Step 0: Install SDK
```bash
bun add @anthropic-ai/claude-agent-sdk
```

### Step 1: Rewrite `server/session.ts`
**Full rewrite.** Replace Bun.spawn with SDK `query()`.

- **MessageChannel class** — `AsyncIterable<SDKUserMessage>` with push/close. When empty, `next()` returns a Promise that resolves when a message is pushed.
- **spawnSession(nodeId, repoPath, prompt, appendSystemPrompt)** — creates MessageChannel, pushes initial prompt, calls `query({ prompt: channel, options: { cwd, permissionMode: 'bypassPermissions', includePartialMessages: true, systemPrompt: { type: 'preset', preset: 'claude_code', append }, settingSources: ['user', 'project', 'local'] } })`. Starts `consumeQuery()` in background.
- **consumeQuery(nodeId, query)** — `for await (const msg of query)` loop calling `processMessage()`. On error: set node crashed. On completion: delete session.
- **sendInput(nodeId, text)** — pushes `{ type: 'user', message: { role: 'user', content: text } }` to the session's channel.
- **killSession(nodeId)** — calls `abortController.abort()`, `channel.close()`, `query.close()`.
- **Remove:** PID file management, `cleanupStaleProcesses()`, `drainStderr()`, `getCleanEnv()`.

### Step 2: Rewrite `server/stream-parser.ts` → `server/message-processor.ts`
**Full rewrite.** Replace CLI JSON event parsing with typed SDK message handling.

- **createMessageProcessor(nodeId)** → returns `{ processMessage(msg: SDKMessage), cleanup() }`
- **Message type mapping:**

| SDK Message | Action |
|-------------|--------|
| `system` (init) | Capture session_id |
| `assistant` | Extract text + tool_use blocks from `message.content[]`. Auto-title, stage detection, file tracking, AskUserQuestion detection |
| `stream_event` (content_block_delta) | Extract streaming text delta, broadcast to terminal |
| `result` (success) | Set completed, accumulate cost/tokens from `total_cost_usd` + `usage` |
| `result` (error) | Set crashed, set human-needed error |
| Others (rate_limit, tool_progress, etc.) | Ignore |

- **Preserve:** idle timeout (2 min), PR URL extraction, file overlap tracking, stage transitions, auto-title. Reuse logic from current stream-parser.

### Step 3: Update `server/index.ts`
**Targeted changes only.**

- Update imports (new session.ts API is the same function signatures)
- Remove `cleanupStaleProcesses()` import and startup call
- Everything else stays the same — spawn/send_input/kill handlers already work with the same `spawnSession`/`sendInput`/`killSession` signatures

### Step 4: Clean up
- Delete old `server/stream-parser.ts` (replaced by message-processor.ts)
- Keep `server/cli-paths.ts` (still used by context-summary.ts and pr-tracker.ts)
- Remove debug logging added during investigation

## Files Changed

| File | Change |
|------|--------|
| `server/session.ts` | Full rewrite: SDK query() + MessageChannel |
| `server/stream-parser.ts` | Delete (replaced by message-processor.ts) |
| `server/message-processor.ts` | New: SDK message → state/terminal mapping |
| `server/index.ts` | Remove cleanupStaleProcesses import/call |
| `package.json` | Add `@anthropic-ai/claude-agent-sdk` |

## Files Unchanged
- `server/state.ts`, `server/overlap-tracker.ts`, `server/pr-tracker.ts`, `server/completion.ts`
- `shared/types.ts` — WeftNode and all message types stay the same
- All client code — WebSocket protocol unchanged
- `server/context-summary.ts` — still uses CLI directly (out of scope)

## Execution Strategy

**Bucket 1 (2 parallel agents):**
- **Agent A:** Rewrite `server/session.ts` — MessageChannel, spawnSession, sendInput, killSession, consumeQuery
- **Agent B:** Create `server/message-processor.ts` — processMessage with all SDK message type handling, idle timeout, stage detection, file tracking, PR extraction

**Bucket 2 (1 agent, after bucket 1):**
- **Agent C:** Wire up: update index.ts imports, delete old stream-parser.ts, integration testing

## Risks

1. **SDK message shapes** — exact content block structure needs validation at runtime. Add logging initially.
2. **Bun compatibility** — SDK targets Node 18+, need to verify it works under Bun runtime.
3. **Cost tracking** — SDK's `total_cost_usd` might be cumulative across turns (not per-turn). May need delta tracking to avoid double-counting.
4. **Clean env** — current code strips CLAUDECODE env var. SDK may handle this internally, or we may need `env` option.

## Verification

1. `bunx tsc --noEmit` — zero new TS errors
2. `bun run dev` — server starts without crashes
3. Spawn a feature → type a message → see streaming output in terminal
4. Send a follow-up message → verify context maintained
5. Close node → verify process terminates
6. Spawn subtask with prompt → runs autonomously to completion
