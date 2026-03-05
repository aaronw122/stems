# Provider Rollout and Rollback Controls

This document defines the runtime rollback mechanism for provider-agnostic rollout phases.

## Startup-loaded flags

These flags are loaded once at server startup:

1. `STEMS_PROVIDER_BRIDGE_ENABLED` (default: `false`)
2. `STEMS_PROVIDER_CLAUDE_ADAPTER_ENABLED` (default: `true`)
3. `STEMS_PROVIDER_CODEX_ENABLED` (default: `false`)

Accepted values: `1/0`, `true/false`, `yes/no`, `on/off` (case-insensitive).

Invalid values are ignored and the default is used with a startup warning.

## Runtime verification (smoke check)

`/api/health` returns the startup snapshot of rollout flags:

```bash
curl -s http://localhost:7482/api/health
```

Expected shape:

```json
{
  "status": "ok",
  "configLoadedAt": "2026-03-04T18:00:00.000Z",
  "rolloutFlags": {
    "STEMS_PROVIDER_BRIDGE_ENABLED": false,
    "STEMS_PROVIDER_CLAUDE_ADAPTER_ENABLED": true,
    "STEMS_PROVIDER_CODEX_ENABLED": false
  }
}
```

## Rollback drill commands

Set flags, restart server, then re-check `/api/health`.

```bash
STEMS_PROVIDER_BRIDGE_ENABLED=false \
STEMS_PROVIDER_CLAUDE_ADAPTER_ENABLED=true \
STEMS_PROVIDER_CODEX_ENABLED=false \
bun run dev:server
```

This is the baseline rollback command. Recovery expectation is one server restart.

## Per-phase rollback matrix

| Phase | Forward rollout flags | Required smoke checks | Rollback action |
| --- | --- | --- | --- |
| `M0` / `M0.5` | `bridge=false`, `claudeAdapter=true`, `codex=false` | `/api/health` snapshot + baseline Claude spawn/send/stop flow | Restart with baseline rollback command |
| `M1` | `claudeAdapter=true` | `/api/health` snapshot + Claude adapter path parity smoke (spawn, stream, abort, reconnect) | Set `STEMS_PROVIDER_CLAUDE_ADAPTER_ENABLED=false` and restart |
| `M2a` / `M2b` | `bridge=true`, `claudeAdapter=true` | `/api/health` snapshot + normalized bridge smoke (replay ordering, unknown-event fallback, human-needed flow) | Set `STEMS_PROVIDER_BRIDGE_ENABLED=false` and restart |
| `M3` | `bridge=true`, `claudeAdapter=true` | `/api/health` snapshot + UI/protocol-neutral rendering smoke + context-summary non-Claude-safe fallback smoke | Set `STEMS_PROVIDER_BRIDGE_ENABLED=false` and restart |
| `M4` | `bridge=true`, `claudeAdapter=true`, `codex=true` | `/api/health` snapshot + Codex rollout smoke (start/resume/abort + provider selection behavior) | Set `STEMS_PROVIDER_CODEX_ENABLED=false` and restart |
| `M5` | `bridge=true`, `claudeAdapter=true`, `codex=true` | `/api/health` snapshot + ENSURE matrix on Claude and Codex | Set `STEMS_PROVIDER_CODEX_ENABLED=false` and restart |
| `M6` | Same as active `M5` state during cleanup | `/api/health` snapshot + regression smoke after cleanup/deprecation | Restart with prior stable flag set for the cleaned phase |

## Notes

1. Flag changes are intentionally not hot-reloaded.
2. Rollback always prefers disabling the newest behavior gate first.
3. If multiple gates were enabled in a phase, rollback in reverse order of activation.
