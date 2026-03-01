import { broadcastTerminal } from './state.ts';
import { updateNode, getNode, broadcast } from './state.ts';
import { trackFileEdit } from './overlap-tracker.ts';
import type { DisplayStage } from '../shared/types.ts';
import { extractPRUrls, trackPR } from './pr-tracker.ts';
import { autoMoveIfComplete } from './completion.ts';

// ── Types ────────────────────────────────────────────────────────────

export interface StreamCallbacks {
  onText?: (text: string) => void;
  onToolUse?: (name: string, input: unknown) => void;
  onToolResult?: (name: string, output: string) => void;
  onResult?: (text: string, costUsd: number, usage: { input: number; output: number }) => void;
  onError?: (error: string) => void;
}

interface StreamEvent {
  type: string;
  [key: string]: unknown;
}

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

// ── Parse a single stream-json line ──────────────────────────────────

export function parseStreamLine(line: string): StreamEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed) as StreamEvent;
  } catch {
    return null;
  }
}

// ── Create a stream parser that processes stdout from Claude CLI ─────

export function createStreamParser(nodeId: string, callbacks: StreamCallbacks = {}) {
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

  function clearHumanNeeded(): void {
    const node = getNode(nodeId);
    if (node?.needsHuman) {
      const updated = updateNode(nodeId, {
        needsHuman: false,
        nodeState: 'running',
        humanNeededType: null,
        humanNeededPayload: null,
      });
      if (updated) {
        broadcast({ type: 'node_updated', node: updated });
      }
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

  // ── Process a single event ─────────────────────────────────────────

  function processEvent(event: StreamEvent): void {
    const lines: string[] = [];

    // Reset idle timer on any event
    resetIdleTimer();

    // Clear human-needed on activity (unless this is the event that sets it)
    if (event.type !== 'error') {
      clearHumanNeeded();
    }

    switch (event.type) {
      case 'assistant': {
        // Assistant text message
        const message = event.message as { content?: Array<{ type: string; text?: string }> } | undefined;
        if (message?.content) {
          for (const block of message.content) {
            if (block.type === 'text' && block.text) {
              lines.push(block.text);
              callbacks.onText?.(block.text);
              tryExtractTitle(block.text);
            }
          }
        }
        break;
      }

      case 'content_block_delta': {
        // Streaming text delta
        const delta = event.delta as { type?: string; text?: string } | undefined;
        if (delta?.type === 'text_delta' && delta.text) {
          lines.push(delta.text);
          callbacks.onText?.(delta.text);
          tryExtractTitle(delta.text);
        }
        break;
      }

      case 'tool_use': {
        // Tool invocation
        const name = (event.name as string) ?? 'unknown_tool';
        const input = event.input;
        lines.push(`[Tool: ${name}]`);
        callbacks.onToolUse?.(name, input);

        // Track file edits for overlap detection
        if ((name === 'Edit' || name === 'Write') && input && typeof input === 'object') {
          const filePath = (input as Record<string, unknown>).file_path ?? (input as Record<string, unknown>).path;
          if (typeof filePath === 'string') {
            trackFileEdit(nodeId, filePath);
          }
        }

        // ── Stage detection ──────────────────────────────────────────
        if (name === 'Edit' || name === 'Write') {
          transitionStage('executing');
        } else if (name === 'Bash') {
          const command = typeof input === 'object' && input !== null
            ? String((input as Record<string, unknown>).command ?? '')
            : String(input ?? '');
          if (isTestCommand(command)) {
            transitionStage('testing');
          }
        }

        // ── Human-needed: AskUserQuestion ────────────────────────────
        if (name === 'AskUserQuestion') {
          setHumanNeeded('question', input);
        }

        break;
      }

      case 'tool_result': {
        // Tool result
        const name = (event.name as string) ?? 'unknown_tool';
        const output = String(event.output ?? '');
        const truncated = output.length > 200 ? output.slice(0, 200) + '...' : output;
        lines.push(`[Result: ${name}] ${truncated}`);
        callbacks.onToolResult?.(name, output);
        break;
      }

      case 'result': {
        // Final result — session complete
        const text = String(event.result ?? '');
        const costUsd = Number(event.cost_usd ?? 0);
        const usage = {
          input: Number((event.usage as Record<string, unknown>)?.input_tokens ?? 0),
          output: Number((event.usage as Record<string, unknown>)?.output_tokens ?? 0),
        };

        lines.push(`[Completed] Cost: $${costUsd.toFixed(4)}`);
        callbacks.onResult?.(text, costUsd, usage);

        // Clear idle timer on completion
        clearIdleTimer();

        // Update node state
        const node = getNode(nodeId);
        if (node) {
          const updated = updateNode(nodeId, {
            nodeState: 'completed',
            costUsd: node.costUsd + costUsd,
            tokenUsage: {
              input: node.tokenUsage.input + usage.input,
              output: node.tokenUsage.output + usage.output,
            },
          });
          if (updated) {
            broadcast({ type: 'node_updated', node: updated });
            // Check if this node (and possibly its parent) can auto-complete
            autoMoveIfComplete(nodeId);
          }
        }
        break;
      }

      case 'error': {
        // Error from Claude CLI
        const errorMsg = String(event.error ?? event.message ?? 'Unknown error');
        lines.push(`[Error] ${errorMsg}`);
        callbacks.onError?.(errorMsg);

        // Set human-needed for errors
        setHumanNeeded('error', errorMsg);

        // Update node state
        const updated = updateNode(nodeId, {
          nodeState: 'crashed',
          errorInfo: { type: 'stream_error', message: errorMsg },
        });
        if (updated) {
          broadcast({ type: 'node_updated', node: updated });
        }
        break;
      }

      case 'system': {
        // Internal CLI events (hook_started, hook_response, etc.) — ignore silently
        break;
      }

      default: {
        // Unknown event — log it for debugging
        lines.push(`[${event.type}] ${JSON.stringify(event).slice(0, 150)}`);
        break;
      }
    }

    // Scan all output lines for PR URLs
    for (const line of lines) {
      const prUrls = extractPRUrls(line);
      for (const prUrl of prUrls) {
        trackPR(nodeId, prUrl);
      }
    }

    if (lines.length > 0) {
      broadcastTerminal(nodeId, lines);
    }
  }

  // Returns a writable handler for piping stdout text
  async function pipeFrom(stream: ReadableStream<Uint8Array>): Promise<void> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    // Start idle timer when stream begins
    resetIdleTimer();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Split by newlines and process complete lines
        const lines = buffer.split('\n');
        // Keep the last incomplete line in the buffer
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const event = parseStreamLine(line);
          if (event) {
            processEvent(event);
          }
        }
      }

      // Process any remaining buffer
      if (buffer.trim()) {
        const event = parseStreamLine(buffer);
        if (event) {
          processEvent(event);
        }
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      broadcastTerminal(nodeId, [`[Stream Error] ${errorMsg}`]);
      callbacks.onError?.(errorMsg);
    } finally {
      clearIdleTimer();
      reader.releaseLock();
    }
  }

  return { processEvent, pipeFrom };
}
