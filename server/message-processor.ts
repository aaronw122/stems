import { broadcastTerminal, updateNode, getNode, broadcast, clearHumanNeeded, addPhantomNode, updatePhantomNode, removePhantomNode } from './state.ts';
import { trackFileEdit } from './overlap-tracker.ts';
import type { DisplayStage, TerminalMessage, WeftNode, WeftEdge } from '../shared/types.ts';
import { extractPRUrls, trackPR } from './pr-tracker.ts';
// Note: autoMoveIfComplete is called by session.ts, not here.
// The message processor accumulates cost but doesn't manage node lifecycle.
import type {
  SDKMessage,
  SDKAssistantMessage,
  SDKPartialAssistantMessage,
  SDKResultSuccess,
  SDKResultError,
  ModelUsage,
  SDKSystemMessage,
  SDKTaskStartedMessage,
  SDKTaskProgressMessage,
  SDKTaskNotificationMessage,
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

export function extractTitle(text: string): string | null {
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

// ── Diff formatting for Edit tool ───────────────────────────────────

const DIFF_MAX_LINES = 20;
const DIFF_MAX_CHARS = 2000;

function formatDiffSide(content: string, prefix: string): string {
  const allLines = content.split('\n');
  const display = allLines.length > DIFF_MAX_LINES ? allLines.slice(0, DIFF_MAX_LINES) : allLines;
  let result = display.map(l => `${prefix} ${l}`).join('\n');
  let charTrimmed = false;
  if (result.length > DIFF_MAX_CHARS) {
    charTrimmed = true;
    result = result.slice(0, DIFF_MAX_CHARS);
    // Trim to last complete line to avoid garbled partial lines
    const lastNewline = result.lastIndexOf('\n');
    if (lastNewline > 0) result = result.slice(0, lastNewline);
  }
  const displayedCount = result.split('\n').length;
  if (allLines.length > displayedCount) {
    result += `\n${prefix} ... +${allLines.length - displayedCount} more lines`;
  } else if (charTrimmed) {
    result += `\n${prefix} ... (truncated)`;
  }
  return result;
}

// ── Tool summary helpers ────────────────────────────────────────────

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '…' : s;
}

function shortenPath(p: string): string {
  const segments = p.split('/');
  return segments.length > 3 ? segments.slice(-3).join('/') : p;
}

function extractToolSummary(name: string, inp: Record<string, unknown>): string {
  switch (name) {
    case 'Read':
    case 'Edit':
    case 'Write':
      return shortenPath(String(inp.file_path ?? ''));
    case 'Bash':
      return truncate(String(inp.command ?? ''), 80);
    case 'Glob':
      return String(inp.pattern ?? '');
    case 'Grep':
      return String(inp.pattern ?? '');
    case 'Agent':
      return truncate(String(inp.description ?? inp.prompt ?? ''), 60);
    case 'WebFetch':
      return truncate(String(inp.url ?? ''), 80);
    case 'WebSearch':
      return truncate(String(inp.query ?? ''), 60);
    case 'NotebookEdit':
      return shortenPath(String(inp.notebook_path ?? ''));
    case 'TaskCreate':
      return truncate(String(inp.subject ?? ''), 60);
    case 'TaskUpdate':
      return inp.status ? `${inp.taskId} → ${inp.status}` : String(inp.taskId ?? '');
    default:
      return '';
  }
}

// ── Create message processor ────────────────────────────────────────

export function createMessageProcessor(nodeId: string) {
  let currentStage: DisplayStage = 'planning';
  let titleExtracted = false;
  let accumulatedText = '';
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  const IDLE_TIMEOUT_MS = 120_000; // 2 minutes

  // ── Subagent (phantom node) tracking ────────────────────────────────

  // Maps SDK task_id → phantom node id for active subagents
  const activeSubagents = new Map<string, string>();
  // Maps tool_use_id → subagent_type from Agent tool_use blocks, so that
  // task_started (which carries tool_use_id but NOT the agent name) can
  // correlate back to the Agent block to get the display name.
  const agentToolUseTypes = new Map<string, string>();
  // Reverse map: Agent tool_use_id → task_id, so we can route subagent
  // assistant messages (which carry parent_tool_use_id) back to phantom nodes.
  const toolUseIdToTaskId = new Map<string, string>();
  // Accumulated stats per task_id (built from assistant messages since
  // the CLI never emits task_progress/task_notification via the SDK stream).
  const subagentAccumulatedStats = new Map<string, { toolUseCount: number; totalTokens: number }>();
  const PHANTOM_REMOVAL_DELAY_MS = 2_000;

  function createSubagentNode(taskId: string, toolUseId: string | undefined, description: string): void {
    const phantomId = crypto.randomUUID();
    activeSubagents.set(taskId, phantomId);
    if (toolUseId) toolUseIdToTaskId.set(toolUseId, taskId);
    subagentAccumulatedStats.set(taskId, { toolUseCount: 0, totalTokens: 0 });

    // Resolve agent name: correlate tool_use_id back to the Agent tool_use
    // block's subagent_type. Fall back to description or generic label.
    const agentName = (toolUseId && agentToolUseTypes.get(toolUseId)) || description || 'Subagent';

    const node: WeftNode = {
      id: phantomId,
      type: 'phantom',
      parentId: nodeId,
      title: agentName,
      nodeState: 'running',
      displayStage: 'planning',
      needsHuman: false,
      humanNeededType: null,
      humanNeededPayload: null,
      sessionId: null,
      errorInfo: null,
      overlap: { hasOverlap: false, overlappingNodes: [] },
      prUrl: null,
      prState: null,
      costUsd: 0,
      tokenUsage: { input: 0, output: 0 },
      contextPercent: null,
      x: 0,
      y: 0,
      isPhantomSubagent: true,
      subagentTaskId: taskId,
      toolUseCount: 0,
      totalTokens: 0,
      currentActivity: description || '',
    };

    const edge: WeftEdge = {
      id: `${nodeId}-${phantomId}`,
      source: nodeId,
      target: phantomId,
    };

    addPhantomNode(node, edge);
    console.log(`[msg-processor:${nodeId}] phantom node ${phantomId} created for subagent task ${taskId} (${agentName})`);
  }

  function updateSubagentStats(taskId: string, patch: Partial<WeftNode>): void {
    const phantomId = activeSubagents.get(taskId);
    if (!phantomId) return;
    updatePhantomNode(phantomId, patch);
  }

  function removeSubagentNode(taskId: string): void {
    const phantomId = activeSubagents.get(taskId);
    if (!phantomId) return;
    activeSubagents.delete(taskId);

    // Mark completed, then remove after a short delay so the UI can show the transition
    updatePhantomNode(phantomId, { nodeState: 'completed' });

    setTimeout(() => {
      removePhantomNode(phantomId);
      console.log(`[msg-processor:${nodeId}] phantom node ${phantomId} removed (task ${taskId} completed)`);
    }, PHANTOM_REMOVAL_DELAY_MS);
  }

  function failSubagentNode(taskId: string, errorMessage: string): void {
    const phantomId = activeSubagents.get(taskId);
    if (!phantomId) return;
    // Keep in activeSubagents so failed nodes remain visible
    // (but don't delete from map — they stay on the DAG for inspection)

    updatePhantomNode(phantomId, {
      nodeState: 'crashed',
      errorInfo: { type: 'subagent_failed', message: errorMessage },
    });
    console.log(`[msg-processor:${nodeId}] phantom node ${phantomId} failed (task ${taskId}): ${errorMessage}`);
  }

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
      // Auto-title logic:
      // - Subtasks: overwrite prompt-truncated titles (ends with '...' or > 35 chars)
      // - Features: only overwrite the default "New feature" (user input sets the real title)
      const shouldAutoTitle = node && (
        (node.type !== 'feature' && (node.title.endsWith('...') || node.title.length > 35)) ||
        (node.type === 'feature' && node.title === 'New feature')
      );
      if (shouldAutoTitle) {
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
    // Subagent messages: extract stats, then suppress from parent terminal.
    if (msg.parent_tool_use_id) {
      const taskId = toolUseIdToTaskId.get(msg.parent_tool_use_id);
      if (taskId) {
        const stats = subagentAccumulatedStats.get(taskId);
        if (stats) {
          // Count tool_use blocks in this assistant turn
          const content = msg.message?.content;
          if (content && Array.isArray(content)) {
            for (const block of content) {
              if (block.type === 'tool_use') stats.toolUseCount++;
            }
          }
          // Accumulate tokens from message usage
          const usage = msg.message?.usage;
          if (usage) {
            stats.totalTokens += (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0);
          }
          // Derive current activity from the last tool_use block
          let lastToolName: string | undefined;
          if (content && Array.isArray(content)) {
            for (const block of content) {
              if (block.type === 'tool_use' && 'name' in block) lastToolName = String(block.name);
            }
          }
          updateSubagentStats(taskId, {
            toolUseCount: stats.toolUseCount,
            totalTokens: stats.totalTokens,
            currentActivity: lastToolName ?? undefined,
          });
        }
      }
      return [];
    }

    const messages: TerminalMessage[] = [];
    const content = msg.message?.content;

    if (content && Array.isArray(content)) {
      for (const block of content) {
        if (block.type === 'text' && 'text' in block) {
          // Text was already streamed via stream_event deltas — skip to avoid
          // duplication.  Still use the complete text for title extraction.
          tryExtractTitle(block.text as string);
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

          // When we see an Agent tool_use block, store the tool_use_id →
          // description mapping so that task_started can correlate back
          // to get a human-readable display name for the phantom node.
          if (name === 'Agent' && 'id' in block) {
            const inp = input && typeof input === 'object' ? input as Record<string, unknown> : {};
            const displayName = String(inp.description ?? inp.subagent_type ?? 'Agent');
            agentToolUseTypes.set(String(block.id), displayName);
          }

          // Precedence rule: AskUserQuestion emits human_needed, not tool_use
          if (name === 'AskUserQuestion') {
            // Extract question text — payload is { questions: [{ question, ... }] }
            let questionText = name;
            if (input && typeof input === 'object') {
              const inp = input as Record<string, unknown>;
              if (Array.isArray(inp.questions) && inp.questions.length > 0) {
                const first = inp.questions[0] as Record<string, unknown> | undefined;
                if (first && typeof first.question === 'string') {
                  questionText = first.question;
                }
              } else if ('question' in inp) {
                questionText = String(inp.question);
              }
            }
            messages.push({ type: 'human_needed', text: questionText });
            setHumanNeeded('question', input);
          } else {
            const inp = input && typeof input === 'object' ? input as Record<string, unknown> : {};
            // Map tool names to match Claude CLI display
            const displayName = name === 'Agent'
              ? String(inp.subagent_type ?? name)
              : name === 'Edit' ? 'Update'
              : name === 'WebSearch' ? 'Web Search'
              : name === 'WebFetch' ? 'Fetch'
              : name;
            const tmsg: TerminalMessage = { type: 'tool_use', text: extractToolSummary(name, inp), toolName: displayName };

            // Attach diff data for Edit tools
            if (name === 'Edit') {
              if (typeof inp.old_string === 'string' && inp.old_string !== '') {
                tmsg.diffRemoved = formatDiffSide(inp.old_string, '-');
              }
              if (typeof inp.new_string === 'string') {
                tmsg.diffAdded = formatDiffSide(inp.new_string, '+');
              }
            }
            messages.push(tmsg);
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
    // Suppress subagent streaming messages — they belong to the subagent
    // tracker, not the parent terminal buffer.
    if (msg.parent_tool_use_id) return [];

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
      // Extract context window from modelUsage (keyed by model ID)
      const modelUsageEntry: ModelUsage | undefined = Object.values(msg.modelUsage)[0];
      const contextWindow = modelUsageEntry?.contextWindow ?? null;

      // Context % = how much of the window remains.
      // input_tokens on the latest result reflects the full conversation size.
      let contextPercent: number | null = null;
      if (contextWindow && contextWindow > 0) {
        const used = msg.usage.input_tokens + msg.usage.output_tokens;
        contextPercent = Math.max(0, Math.min(100, ((contextWindow - used) / contextWindow) * 100));
      }

      const updated = updateNode(nodeId, {
        costUsd: node.costUsd + msg.total_cost_usd,
        tokenUsage: {
          input: node.tokenUsage.input + msg.usage.input_tokens,
          output: node.tokenUsage.output + msg.usage.output_tokens,
        },
        contextPercent,
      });
      if (updated) {
        broadcast({ type: 'node_updated', node: updated });
      }
    }

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

    // Reset idle timer on any message
    resetIdleTimer();

    // Clear idle human-needed on activity (session is no longer idle)
    const currentNode = getNode(nodeId);
    if (currentNode?.humanNeededType === 'idle') {
      clearHumanNeeded(nodeId);
    }

    switch (msg.type) {
      case 'system': {
        if (!('subtype' in msg)) break;

        if (msg.subtype === 'init') {
          handleSystemInit(msg as SDKSystemMessage);
        } else if (msg.subtype === 'task_started') {
          const taskMsg = msg as SDKTaskStartedMessage;
          createSubagentNode(taskMsg.task_id, taskMsg.tool_use_id, taskMsg.description);
        } else if (msg.subtype === 'task_progress') {
          const taskMsg = msg as SDKTaskProgressMessage;
          // Update phantom node stats from task_progress usage data
          updateSubagentStats(taskMsg.task_id, {
            toolUseCount: taskMsg.usage.tool_uses,
            totalTokens: taskMsg.usage.total_tokens,
            currentActivity: taskMsg.last_tool_name
              ? `${taskMsg.last_tool_name}: ${taskMsg.description}`
              : taskMsg.description,
          });
        } else if (msg.subtype === 'task_notification') {
          const taskMsg = msg as SDKTaskNotificationMessage;
          if (taskMsg.status === 'completed' || taskMsg.status === 'stopped') {
            // Update final stats if available
            if (taskMsg.usage) {
              updateSubagentStats(taskMsg.task_id, {
                toolUseCount: taskMsg.usage.tool_uses,
                totalTokens: taskMsg.usage.total_tokens,
                currentActivity: taskMsg.status === 'completed' ? 'Completed' : 'Stopped',
              });
            }
            removeSubagentNode(taskMsg.task_id);
          } else if (taskMsg.status === 'failed') {
            const errorText = taskMsg.summary || 'Subagent task failed';
            failSubagentNode(taskMsg.task_id, errorText);
          }
        }
        // Ignore status, compact_boundary, and other subtypes
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

        // Turn complete — mark all active subagents as completed.
        // The CLI never emits task_notification via the SDK stream, so we
        // use the result message as the completion signal.
        for (const taskId of [...activeSubagents.keys()]) {
          updateSubagentStats(taskId, { currentActivity: 'Completed' });
          removeSubagentNode(taskId);
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

    // Remove all remaining phantom nodes (session is ending)
    for (const [taskId, phantomId] of activeSubagents) {
      const removed = removePhantomNode(phantomId);
      if (removed) {
        console.log(`[msg-processor:${nodeId}] cleanup: removed phantom node ${phantomId} (task ${taskId})`);
      }
    }
    activeSubagents.clear();
    agentToolUseTypes.clear();
    toolUseIdToTaskId.clear();
    subagentAccumulatedStats.clear();
  }

  return { processMessage, cleanup };
}
