import { broadcastTerminal } from './state.ts';
import { updateNode, getNode, broadcast } from './state.ts';
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
  function processEvent(event: StreamEvent): void {
    const lines: string[] = [];

    switch (event.type) {
      case 'assistant': {
        // Assistant text message
        const message = event.message as { content?: Array<{ type: string; text?: string }> } | undefined;
        if (message?.content) {
          for (const block of message.content) {
            if (block.type === 'text' && block.text) {
              lines.push(block.text);
              callbacks.onText?.(block.text);
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
        }
        break;
      }

      case 'tool_use': {
        // Tool invocation
        const name = (event.name as string) ?? 'unknown_tool';
        const input = event.input;
        lines.push(`[Tool: ${name}]`);
        callbacks.onToolUse?.(name, input);
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
      reader.releaseLock();
    }
  }

  return { processEvent, pipeFrom };
}
