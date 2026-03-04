---
title: "Provider-Agnostic Model Support"
author: "human:Aaron"
version: 3
created: 2026-03-04
---

# Provider-Agnostic Model Support

## WANT
Build a plan for this product to support multiple model providers instead of being Anthropic-only, while keeping the app as a local tool that mimics CLI workflows.

Primary target providers mentioned:
- Claude
- Codex

Question to resolve in planning:
- Whether a Codex/ChatGPT subscription can be used programmatically for the same orchestration use case.

Planning refinements:
- Add a thin provider adapter boundary with Claude and Codex adapters.
- Keep a provider-neutral session core for queueing, turn lifecycle, and node state.
- Keep websocket + terminal UX contracts mostly stable while decoupling backend provider runtime.

## DON'T
- Do not treat this as a multi-user website/SaaS architecture problem.
- Do not expand scope to OS/device portability work; "cross-platform" here means provider-agnostic model support only.
- Do not rewrite DAG/frontend architecture beyond compatibility updates needed for provider neutrality.
- Do not expand into a general plugin marketplace; this scope is Claude + Codex only.

## LIKE
Not specified.

## FOR
- Primary user: Aaron (local usage)
- Product form: local website UI over a local server process
- Target behavior: mimic CLI-style agent sessions
- "Cross-platform" here means multi-provider model support (Claude, Codex), not OS/device portability

## ENSURE
- ENSURE-1: Same core node lifecycle works on Claude and Codex.
- ENSURE-2: Turn queueing and resume behavior remain correct under rapid inputs.
- ENSURE-3: Deferred spawn behavior remains intact.
- ENSURE-4: Terminal replay/reconnect remains stable across providers.
- ENSURE-5: Human-needed question/permission flow works end-to-end.
- ENSURE-6: Commands endpoint returns stable shape across providers.
- ENSURE-7: Usage/cost/context fields degrade safely when missing.
- ENSURE-8: Stop/abort + restart input flow remains resilient.
- ENSURE-9: Existing persisted workspaces remain loadable.
- ENSURE-10: Context summary route has a safe non-Claude path.

## TRUST
- [autonomous] Internal adapter API design, event normalization details, and migration sequencing.
- [autonomous] Compatibility shims needed to preserve current behavior.
- [ask] Final provider selection UX policy (global default vs per-node override).
- [ask] Context-summary policy (Claude-only fallback first vs provider-aware implementation now).
- [ask] Codex resume-token assumptions if behavior is ambiguous in live testing.
