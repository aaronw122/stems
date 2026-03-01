import { broadcastTerminal, updateNode, getNode, broadcast, clearHumanNeeded } from './state.ts';
import { trackFileEdit } from './overlap-tracker.ts';
import type { DisplayStage, TerminalMessage } from '../shared/types.ts';
import { extractPRUrls, trackPR } from './pr-tracker.ts';
// Note: autoMoveIfComplete is called by session.ts, not here.
// The message processor accumulates cost but doesn't manage node lifecycle.
import type {
  SDKMessage,
  SDKAssistantMessage,
  SDKPartialAssistantMessage,
  SDKResultSuccess,
  SDKResultError,
  SDKSystemMessage,
} from '@anthropic-ai/claude-agent-sdk';

// ── Test command patterns ───────────────────────────────────────────

const TEST_PATTERNS = [
  'bun test',
  'vitest',
  'pytest',
  'jest',
  'npm test',
  'npm run test',
  'yarn test',
  'cargo test',
  'go test',
];

function isTestCommand(command: string): boolean {
  const lower = command.toLowerCase();
  return TEST_PATTERNS.some((pattern) => lower.includes(pattern));
}

// ── Auto-title extraction ───────────────────────────────────────────

function extractTitle(text: string): string | null {
  // Strip leading whitespace/newlines
  const cleaned = text.replace(/^\s+/, '');
  if (cleaned.length < 5) return null;

  // Take first sentence or first ~60 chars
  const sentenceEnd = cleaned.search(/[.!?\n]/);
  let title: string;

  if (sentenceEnd > 0 && sentenceEnd <= 60) {
    title = cleaned.slice(0, sentenceEnd).trim();
  } else if (cleaned.length <= 60) {
    title = cleaned.trim();
  } else {
    // Truncate at word boundary near 60 chars
    const truncated = cleaned.slice(0, 60);
    const lastSpace = truncated.lastIndexOf(' ');
    title = (lastSpace > 20 ? truncated.slice(0, lastSpace) : truncated).trim() + '...';
  }

  // Remove markdown formatting
  title = title.replace(/^#+\s*/, '').replace(/\*+/g, '').trim();

  return title.length >= 3 ? title : null;
}

// ── Create message processor ────────────────────────────────────────

export function createMessageProcessor(nodeId: string) {
  let currentStage: DisplayStage = 'planning';
  let titleExtracted = false;
  let accumulatedText = '';
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  const IDLE_TIMEOUT_MS = 120_000; // 2 minutes

  // ── Stage transition helper ────────────────────────────────────────

  function transitionStage(newStage: DisplayStage): void {
    if (newStage === currentStage) return;
    currentStage = newStage;
    const updated = updateNode(nodeId, { displayStage: newStage });
    if (updated) {
      broadcast({ type: 'node_updated', node: updated });
    }
  }

  // ── Human-needed helpers ───────────────────────────────────────────

  function setHumanNeeded(
    humanNeededType: 'question' | 'permission' | 'error' | 'idle',
    humanNeededPayload: unknown,
  ): void {
    const updated = updateNode(nodeId, {
      needsHuman: true,
      nodeState: 'needs-human',
      humanNeededType,
      humanNeededPayload,
    });
    if (updated) {
      broadcast({ type: 'node_updated', node: updated });
    }
  }

  // ── Idle timeout management ────────────────────────────────────────

  function resetIdleTimer(): void {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      setHumanNeeded('idle', 'No activity for 2 minutes');
    }, IDLE_TIMEOUT_MS);
  }

  function clearIdleTimer(): void {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  }

  // ── Auto-title check ──────────────────────────────────────────────

  function tryExtractTitle(text: string): void {
    if (titleExtracted) return;

    accumulatedText += text;

    // Wait until we have enough text to extract a meaningful title
    if (accumulatedText.length < 10) return;

    const title = extractTitle(accumulatedText);
    if (title) {
      titleExtracted = true;
      const node = getNode(nodeId);
      // Only auto-title if the current title looks like a default (prompt truncation)
      if (node && (node.title.endsWith('...') || node.title.length > 35)) {
        const updated = updateNode(nodeId, { title });
        if (updated) {
          broadcast({ type: 'node_updated', node: updated });
        }
      }
    }
  }

  // ── Handle system init message ────────────────────────────────────

  function handleSystemInit(msg: SDKSystemMessage): void {
    const updated = updateNode(nodeId, { sessionId: msg.session_id });
    if (updated) {
      broadcast({ type: 'node_updated', node: updated });
    }
  }

  // ── Handle assistant message (complete turn) ──────────────────────

  function handleAssistant(msg: SDKAssistantMessage): TerminalMessage[] {
    const messages: TerminalMessage[] = [];
    const content = msg.message?.content;

    if (content && Array.isArray(content)) {
      for (const block of content) {
        if (block.type === 'text' && 'text' in block) {
          const text = block.text as string;
          messages.push({ type: 'assistant_text', text });
          tryExtractTitle(text);
        } else if (block.type === 'tool_result' && 'content' in block) {
          // Tool result — extract text content for PR URL scanning
          const toolName = 'tool_use_id' in block ? String(block.tool_use_id) : undefined;
          const resultContent = block.content;
          if (typeof resultContent === 'string') {
            const truncated = resultContent.length > 200 ? resultContent.slice(0, 200) + '...' : resultContent;
            messages.push({ type: 'tool_result', text: truncated, toolName });
          } else if (Array.isArray(resultContent)) {
            for (const part of resultContent) {
              if (typeof part === 'object' && part !== null && 'type' in part && part.type === 'text' && 'text' in part) {
                const text = String(part.text);
                const truncated = text.length > 200 ? text.slice(0, 200) + '...' : text;
                messages.push({ type: 'tool_result', text: truncated, toolName });
              }
            }
          }
        } else if (block.type === 'tool_use' && 'name' in block) {
          const name = String(block.name ?? 'unknown_tool');
          const input = 'input' in block ? block.input : undefined;

          // Precedence rule: AskUserQuestion emits human_needed, not tool_use
          if (name === 'AskUserQuestion') {
            const questionText = input && typeof input === 'object' && 'question' in (input as Record<string, unknown>)
              ? String((input as Record<string, unknown>).question)
              : name;
            messages.push({ type: 'human_needed', text: questionText });
            setHumanNeeded('question', input);
          } else {
            messages.push({ type: 'tool_use', text: name, toolName: name });
          }

          // Track file edits for overlap detection
          if ((name === 'Edit' || name === 'Write') && input && typeof input === 'object') {
            const filePath =
              (input as Record<string, unknown>).file_path ??
              (input as Record<string, unknown>).path;
            if (typeof filePath === 'string') {
              trackFileEdit(nodeId, filePath);
            }
          }

          // Stage detection
          if (name === 'Edit' || name === 'Write') {
            transitionStage('executing');
          } else if (name === 'Bash') {
            const command =
              typeof input === 'object' && input !== null
                ? String((input as Record<string, unknown>).command ?? '')
                : String(input ?? '');
            if (isTestCommand(command)) {
              transitionStage('testing');
            }
          }
        }
      }
    }

    // Check for API-level errors (auth, billing, rate_limit, etc.)
    if (msg.error) {
      setHumanNeeded('error', msg.error);
      messages.push({ type: 'error', text: `[API Error] ${msg.error}` });
    }

    return messages;
  }

  // ── Handle streaming partial message ──────────────────────────────

  function handleStreamEvent(msg: SDKPartialAssistantMessage): TerminalMessage[] {
    const messages: TerminalMessage[] = [];
    const event = msg.event;

    // Check for content_block_delta with text_delta
    if (
      event &&
      'type' in event &&
      event.type === 'content_block_delta' &&
      'delta' in event
    ) {
      const delta = event.delta as { type?: string; text?: string };
      if (delta?.type === 'text_delta' && delta.text) {
        messages.push({ type: 'assistant_text', text: delta.text });
        tryExtractTitle(delta.text);
      }
    }

    return messages;
  }

  // ── Handle successful result ──────────────────────────────────────
  // Accumulates cost/tokens but does NOT set nodeState — session.ts
  // decides whether the node is 'completed' (subtask) or stays 'running'
  // (interactive feature) after a turn finishes.

  function handleResultSuccess(msg: SDKResultSuccess): TerminalMessage[] {
    const messages: TerminalMessage[] = [];

    clearIdleTimer();

    const node = getNode(nodeId);
    if (node) {
      const updated = updateNode(nodeId, {
        costUsd: node.costUsd + msg.total_cost_usd,
        tokenUsage: {
          input: node.tokenUsage.input + msg.usage.input_tokens,
          output: node.tokenUsage.output + msg.usage.output_tokens,
        },
      });
      if (updated) {
        broadcast({ type: 'node_updated', node: updated });
      }
    }

    messages.push({ type: 'system', text: 'Completed', costUsd: msg.total_cost_usd });
    return messages;
  }

  // ── Handle error result ───────────────────────────────────────────

  function handleResultError(msg: SDKResultError): TerminalMessage[] {
    const messages: TerminalMessage[] = [];

    clearIdleTimer();

    const errorMsg = msg.errors.join('; ') || 'Unknown error';

    setHumanNeeded('error', errorMsg);

    const updated = updateNode(nodeId, {
      nodeState: 'crashed',
      errorInfo: { type: msg.subtype, message: errorMsg },
    });
    if (updated) {
      broadcast({ type: 'node_updated', node: updated });
    }

    messages.push({ type: 'error', text: errorMsg });
    return messages;
  }

  // ── Main message processor ────────────────────────────────────────

  function processMessage(msg: SDKMessage): void {
    const messages: TerminalMessage[] = [];

    // Log non-streaming messages; stream_event is too frequent for default logging
    if (msg.type !== 'stream_event') {
      console.log(`[msg-processor:${nodeId}] message: ${msg.type}`);
    }

    // Reset idle timer on any message
    resetIdleTimer();

    // Clear idle human-needed on activity (session is no longer idle)
    const currentNode = getNode(nodeId);
    if (currentNode?.humanNeededType === 'idle') {
      clearHumanNeeded(nodeId);
    }

    switch (msg.type) {
      case 'system': {
        // Only handle init subtype — ignore status and compact_boundary
        if ('subtype' in msg && msg.subtype === 'init') {
          handleSystemInit(msg as SDKSystemMessage);
        }
        break;
      }

      case 'assistant': {
        messages.push(...handleAssistant(msg as SDKAssistantMessage));
        break;
      }

      case 'stream_event': {
        messages.push(...handleStreamEvent(msg as SDKPartialAssistantMessage));
        break;
      }

      case 'result': {
        if ('subtype' in msg && msg.subtype === 'success') {
          messages.push(...handleResultSuccess(msg as SDKResultSuccess));
        } else {
          // Any result with subtype starting with 'error_' is an error
          messages.push(...handleResultError(msg as SDKResultError));
        }
        break;
      }

      default: {
        // Ignore all other message types (rate_limit_event, tool_progress,
        // auth_status, compact_boundary, local_command_output, hook_started,
        // hook_progress, hook_response, etc.)
        if (process.env.DEBUG) {
          console.debug(
            `[msg-processor:${nodeId}] Ignored message type: ${msg.type}`,
            JSON.stringify(msg).slice(0, 200),
          );
        }
        break;
      }
    }

    // Scan all output messages for PR URLs
    for (const m of messages) {
      const prUrls = extractPRUrls(m.text);
      for (const prUrl of prUrls) {
        trackPR(nodeId, prUrl);
      }
    }

    if (messages.length > 0) {
      broadcastTerminal(nodeId, messages);
    }
  }

  // ── Cleanup ───────────────────────────────────────────────────────

  function cleanup(): void {
    clearIdleTimer();
  }

  return { processMessage, cleanup };
}
