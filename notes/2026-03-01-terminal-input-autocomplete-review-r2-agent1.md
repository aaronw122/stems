# Architect Review — Terminal Input Autocomplete Plan (Round 2)

## Prior Issue Resolution Status

### M1. Input is `<textarea>`, not `<input>` — FIXED
The plan now correctly identifies the input as a `<textarea>` in the Context section (line 9) and the trigger detection logic in Step 4 explicitly scans backward from `selectionStart` to the nearest `\n` or start-of-string to find the current line boundary. The `/` trigger checks `value[lineStart] === '/'` rather than "position 0." This is exactly what was needed.

### M2. `queryInstance` lifecycle and cache invalidation — FIXED
The plan no longer stores `queryInstance` on Session. Instead, it calls `queryInstance.initializationResult()` inline in `consumeTurn` after the init message and stores the resulting `commands` array as `slashCommands` on the Session. This avoids the concurrent-access concern entirely. The endpoint now returns a `source: 'session' | 'fallback'` field so the client knows whether to re-fetch. Both parts of the original issue are addressed.

### M3. Tab key event handling order — FIXED
The plan now specifies that `onKeyDown` in the hook calls both `e.preventDefault()` and `e.stopPropagation()` for consumed keys, and returns `true`/`false` to the caller. The Tab priority chain in Step 6 is explicit about `stopPropagation()` preventing the event from reaching `handleTabTrap`. The Escape key handling also uses `stopPropagation()`. This is well-specified.

### Med1. No abort/cleanup for in-flight fetches — NOT ADDRESSED
The plan still does not mention `AbortController` or request generation counters for debounced file fetches. The race condition where an earlier response arrives after a later one remains unmentioned.

### Med2. Non-git repo error handling — NOT ADDRESSED
Still no error handling specified for `git ls-files` failing on non-git directories.

### Med3. Dropdown clipping at top edge — NOT ADDRESSED
No mention of clamping dropdown height or flipping direction.

### Med4. `AutocompleteItem` in shared types — NOT ADDRESSED
The type is still proposed for `shared/types.ts` despite only being used client-side.

### L1. `git ls-files --max-count` doesn't exist — NOT ADDRESSED
The Risks section still references this non-existent flag.

### L2. Verification step 10 tests unspecified behavior — PARTIALLY ADDRESSED
The trigger detection now says "@` anywhere in input" and doesn't require preceding whitespace, which means verification step 10 ("Verify dropdown doesn't appear for `@` in middle of word without space before it") still contradicts the spec. However, the "dismiss if query text contains a space" rule partially limits false triggers. The verification step still tests a behavior not defined in the plan.

### L3. Step 5 parallel with Step 4 — NOT ADDRESSED
Still states they can run in parallel without noting the interface dependency.

---

## New Issues in Revision 2

### Must-Fix Issues

### M4. `handleTabTrap` selector doesn't include `<textarea>` — plan's Tab conflict analysis is based on wrong assumption
**Section:** Step 6, Risk 3

The plan's Tab priority chain and Risk 3 both describe a conflict between autocomplete Tab handling and `handleTabTrap`. But `handleTabTrap` (TerminalPeek.tsx line 173-175) queries for focusable elements using:

```
button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])
```

This selector does not match `<textarea>` elements. The textarea is not recognized as a focusable element by the tab trap, meaning `handleTabTrap` currently has no effect when focus is on the textarea — Tab events from the textarea bubble to the parent div, `handleTabTrap` runs, queries for focusable elements, finds only the close button (and maybe "scroll to bottom"), but the textarea itself is not in the `focusable` list. So `document.activeElement === last` or `first` checks may behave unexpectedly.

This is a pre-existing bug in `handleTabTrap`, not something the autocomplete plan introduces. But the plan's analysis of Tab conflicts is built on the assumption that `handleTabTrap` would interfere with autocomplete Tab — in practice, the interference pattern is different from what the plan describes. The `stopPropagation()` approach is still correct as a defensive measure, but the plan should acknowledge that `handleTabTrap`'s selector needs `textarea:not([disabled])` added to work correctly with focus cycling.

**Why plan-level:** The Tab priority chain in Step 6 is a core part of the keyboard handling design. If the plan is implemented as written, the `stopPropagation()` calls will work fine, but the *rationale* is wrong — the interaction it claims to prevent doesn't actually occur with the current selector. More importantly, if someone later fixes the selector (adds `textarea`), the Tab handling in the autocomplete hook would correctly prevent the conflict. So the defensive code is right, but the plan should note the selector gap.

**Suggested fix:** Add a note to Step 6 that `handleTabTrap`'s focusable selector should be updated to include `textarea:not([disabled])` as part of this work. This ensures the focus trap works correctly both with and without autocomplete.

### M5. `initializationResult()` is called inline but `queryInstance` goes out of scope after `consumeTurn` — slash commands unavailable for future endpoint calls
**Section:** Step 2

The plan says to call `queryInstance.initializationResult()` inline in `consumeTurn` after the init message and store the resulting `commands` on the Session. This is correct for capturing the data during the first turn. However, looking at the actual Session lifecycle:

- For **feature nodes**: `consumeTurn` completes, Session stays alive, `slashCommands` is available. Endpoint works.
- For **subtask nodes**: `consumeTurn` completes, Session is deleted (line 167 of session.ts: `sessions.delete(nodeId)`). The slash commands are gone.

This means `GET /api/commands/:nodeId` will always return fallback for subtask nodes after their session completes. This is probably acceptable since subtasks are autonomous and users are less likely to type commands in a completed subtask's terminal, but the plan doesn't acknowledge this limitation. If the terminal input is available for subtask nodes (which it appears to be), a user could try to autocomplete a command and get stale/fallback data.

**Why plan-level:** This is a data availability gap that affects the endpoint contract. The implementer would discover the endpoint silently returning fallback for completed subtasks and wonder if it's a bug.

**Suggested fix:** Add a note that slash commands are only available while a session is alive. For subtask nodes whose sessions have ended, the endpoint always returns fallback. This is acceptable behavior — document it.

---

### Medium Issues

### Med5. `onInputChange` called after `setInput` but before React re-render — stale `selectionStart`
**Section:** Step 6, item 2

The plan says: "read `e.target.selectionStart` _before_ the auto-resize DOM mutation (`el.style.height = ...`), then call `autocomplete.onInputChange(value, cursorPos)`."

The current `onChange` handler (TerminalPeek.tsx line 327-333):
```tsx
onChange={(e) => {
  setInput(e.target.value);
  const el = e.target;
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}}
```

The plan's instruction is to read `selectionStart` before the resize. But there's a subtler issue: `setInput(e.target.value)` triggers a React state update. In React 18+ with automatic batching, this state update is batched and the re-render happens later. The `e.target.selectionStart` read should happen before `setInput` is called, not just before the resize mutation — because React's controlled input behavior can reset `selectionStart` on the next render when the textarea re-renders with the new value.

The plan does identify cursor reset as Risk 4 and proposes `requestAnimationFrame` to restore cursor position. But the ordering instruction in Step 6 item 2 focuses on "before resize" rather than "before any state changes." The cursor position captured from the event object (`e.target.selectionStart`) is stable within the synchronous event handler regardless, so this is actually fine in practice — the value is read synchronously before any re-render. But the plan's emphasis on "before auto-resize" is misleading about what actually matters.

**Why plan-level:** An implementer following the instruction literally might restructure the handler to put `selectionStart` between `setInput` and the resize, thinking the resize is the critical boundary, when the real concern is reading it at all within the sync handler.

**Suggested fix:** Reword Step 6 item 2: "Read `e.target.selectionStart` at the top of the `onChange` handler (before any state updates or DOM mutations), then proceed with `setInput`, auto-resize, and `autocomplete.onInputChange(value, cursorPos)`."

### Med6. `source: 'fallback'` requires client-side re-fetch logic that isn't specified
**Section:** Step 2, Step 4

The endpoint returns `source: 'session' | 'fallback'` and the plan says "if `source === 'fallback'`, the client should re-fetch after session init completes." But Step 4's caching description says slash commands are "fetched once and cached for session lifetime." These two statements conflict: if cached for session lifetime after the first fetch, and the first fetch returns fallback, the client would never re-fetch.

The plan doesn't specify *how* the client detects session init to trigger a re-fetch. Options include: (a) the client watches for specific WebSocket messages indicating init completed, (b) the client polls with a short timeout, or (c) the client re-fetches on each dropdown open when source was fallback.

**Why plan-level:** Without specifying the re-fetch mechanism, the implementer has to design this themselves. The `source` field is dead weight unless the plan describes how and when the client uses it.

**Suggested fix:** Specify one of: (a) cache commands with `source` metadata — if source is `'fallback'`, re-fetch on next dropdown open; (b) invalidate the cache when the terminal stream receives an init-related message; or (c) just don't cache fallback results (only cache when `source === 'session'`). Option (c) is simplest.

---

### Low Issues

### L4. ARIA `role="combobox"` on "the input container" is ambiguous
**Section:** Step 5

The plan says "The input container gets `role='combobox'`." TerminalPeek's input area is structured as:

```tsx
<div className="flex items-start gap-2 px-4 py-2">  // outer wrapper
  <span>❯</span>                                      // chevron
  <textarea ... />                                     // actual input
</div>
```

WAI-ARIA combobox pattern requires `role="combobox"` on the element that *receives keyboard input* — which is the `<textarea>` itself, not the containing `<div>`. Putting it on the div would require the div to be the keyboard target, which it isn't.

Additionally, `aria-activedescendant` must be on the element with `role="combobox"` (the textarea), not a parent. The plan should clarify that these ARIA attributes go directly on the `<textarea>` element.

### L5. `onItemClick` calls `accept()` internally but `accept()` returns a value the caller needs to apply
**Section:** Step 4

The hook interface has both `onItemClick(index)` and `accept()`. The description says `onItemClick` "accepts the item at index." But `accept()` returns `{ newValue, newCursorPosition } | null` — the caller (TerminalPeek) needs to apply this to the textarea state. If `onItemClick` calls `accept()` internally, it needs a way to communicate the result back to the caller to update state.

Either `onItemClick` should return the same `{ newValue, newCursorPosition }` object, or the hook should manage the textarea value internally (which contradicts the controlled input pattern), or `onItemClick` should set `selectedIndex` and the caller should detect the acceptance and call `accept()` itself.

**Why plan-level (Low):** This is an API design inconsistency, not an architectural gap. The implementer will figure it out, but the interface as written has a hole.

**Suggested fix:** Either (a) have `onItemClick` return the same type as `accept()`, or (b) add a callback parameter to the hook (e.g., `onAccept: (result: { newValue, newCursorPosition }) => void`) that the hook calls internally when an item is accepted via click or keyboard.

---

## Impl-Notes

- **Med1 from Round 1 (abort controller for fetches):** Still worth implementing but won't cause rework if discovered during implementation. Downgraded from Medium to Impl-note given the debounce already limits concurrent requests. Standard pattern: create `AbortController` per fetch, abort previous on new request.
- **Med2 from Round 1 (non-git repo fallback):** Straightforward error handling — try/catch the `Bun.spawn` and return empty array on failure. No architectural impact.
- **Med3 from Round 1 (dropdown clipping):** CSS-solvable during implementation. Consider `max-height: min(240px, calc(var(--available-space)))` or a flip strategy.
- **`initializationResult()` error handling:** If the SDK call rejects (e.g., session dies mid-init), the `consumeTurn` catch block handles it, but `slashCommands` would remain `null`. The endpoint fallback handles this gracefully.
- **Concurrent calls to `initializationResult()`:** The SDK docs say "control requests are only supported when streaming input/output is used." Since `consumeTurn` is actively iterating the `queryInstance` generator when it calls `initializationResult()`, this is a concurrent control-plane call on an active stream. The SDK is designed for this — `initializationResult()` resolves from cached init data, not a new network request. Safe as written.

---

## Summary

The revision addressed the three must-fix issues from Round 1 cleanly. The multi-line trigger detection is now correct. The `queryInstance` lifecycle is simplified by calling `initializationResult()` inline rather than storing the reference. The Tab/Escape key handling with `stopPropagation()` is well-specified with a clear priority chain.

Two new must-fix issues: (1) the `handleTabTrap` focusable selector doesn't include `<textarea>`, making the plan's Tab conflict analysis technically wrong even though the defensive code is correct — the selector should be fixed as part of this work; (2) the slash commands endpoint behavior for subtask nodes after session deletion needs documentation so implementers know it's expected, not a bug.

Two new medium issues: the `onChange` ordering instruction emphasizes the wrong boundary, and the `source: 'fallback'` re-fetch mechanism is unspecified despite being central to the cache invalidation strategy.

The remaining Round 1 medium and low issues are minor and safely discoverable during implementation. The architecture is sound.
