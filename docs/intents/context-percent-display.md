---
title: "Context Percent Display"
author: "human:aaron"
version: 1
created: 2026-03-04
---

# Context Percent Display

## WANT
Display the context % remaining above feature nodes (and subtask nodes) as a color-coded text label that updates live from the CLI stream data. The label sits outside the node card, positioned above-right near the top connection handle area.

## DON'T
- No extra UI chrome — no progress bars, icons, or settings panels
- No raw token counts — just the percentage
- No configuration options — hardcoded thresholds
- Don't show the label when `contextPercent` is null (session hasn't started or no data yet)

## LIKE
- Plain text label: `X% context`
- Color gradient by remaining context:
  - Green (healthy, ~75%+)
  - Yellow/olive (moderate, ~40-74%)
  - Orange (warning, ~20-39%)
  - Red (critical, <20%)
- Positioned above the node, upper-right — outside the card, near the source handle area
- Reference: mockup images showing handwritten colored labels

## FOR
- Aaron, the operator — visual awareness of when agent sessions are running low on context
- Displayed on feature and subtask nodes (any node running a Claude session)

## ENSURE
- [ ] Context % updates live as the session progresses (on each turn completion)
- [ ] Color transitions at thresholds: green → yellow → orange → red
- [ ] Label hidden when contextPercent is null
- [ ] Label visible on both feature and subtask nodes

## TRUST
- [autonomous] Exact color hex values and threshold breakpoints
- [autonomous] Font size, weight, positioning details
- [autonomous] Whether to round the percentage or show decimals
- [ask] Nothing — ship it
