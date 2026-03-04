import { join } from 'path';
import { homedir } from 'os';
import type { WeftNode, WeftEdge, TerminalMessage } from '../shared/types.ts';

// ── Persisted types ─────────────────────────────────────────────────

export type PersistedNode = Pick<
  WeftNode,
  'id' | 'type' | 'parentId' | 'title' | 'repoPath' | 'branch' | 'prompt' | 'prUrl' | 'prState' | 'costUsd' | 'tokenUsage' | 'isPhantomSubagent' | 'sessionId'
>;

export interface WorkspaceFile {
  version: 1;
  savedAt: string;
  nodes: PersistedNode[];
  edges: WeftEdge[];
  doneList: PersistedNode[];
}

// ── File paths ──────────────────────────────────────────────────────

const STEMS_DIR = join(homedir(), '.stems');
const WORKSPACE_PATH = join(STEMS_DIR, 'workspace.json');
const WORKSPACE_TMP_PATH = join(STEMS_DIR, 'workspace.json.tmp');
const TERMINALS_PATH = join(STEMS_DIR, 'terminals.json');
const TERMINALS_TMP_PATH = join(STEMS_DIR, 'terminals.json.tmp');

// ── Node conversion ─────────────────────────────────────────────────

export function toPersistedNode(node: WeftNode): PersistedNode {
  return {
    id: node.id,
    type: node.type,
    parentId: node.parentId,
    title: node.title,
    repoPath: node.repoPath,
    branch: node.branch,
    prompt: node.prompt,
    prUrl: node.prUrl,
    prState: node.prState,
    costUsd: node.costUsd,
    tokenUsage: { input: node.tokenUsage.input, output: node.tokenUsage.output },
    isPhantomSubagent: node.isPhantomSubagent,
    sessionId: node.sessionId,
  };
}

export function toWeftNode(persisted: PersistedNode): WeftNode {
  return {
    id: persisted.id,
    type: persisted.type,
    parentId: persisted.parentId,
    title: persisted.title,
    repoPath: persisted.repoPath,
    branch: persisted.branch,
    prompt: persisted.prompt,
    prUrl: persisted.prUrl,
    prState: persisted.prState,
    costUsd: persisted.costUsd,
    tokenUsage: { input: persisted.tokenUsage.input, output: persisted.tokenUsage.output },
    isPhantomSubagent: persisted.isPhantomSubagent,
    // Reset volatile fields to safe defaults
    nodeState: 'idle',
    displayStage: 'planning',
    sessionId: persisted.sessionId ?? null,
    needsHuman: false,
    humanNeededType: null,
    humanNeededPayload: null,
    errorInfo: null,
    overlap: { hasOverlap: false, overlappingNodes: [] },
    contextPercent: null,
    x: 0,
    y: 0,
  };
}

// ── Terminal persistence types ───────────────────────────────────────

interface TerminalsFile {
  version: 1;
  savedAt: string;
  buffers: Record<string, TerminalMessage[]>;
}

// ── Debounced save ──────────────────────────────────────────────────

type GetStateFn = () => { nodes: WeftNode[]; edges: WeftEdge[]; doneList: WeftNode[] };
type GetTerminalsFn = () => Map<string, TerminalMessage[]>;

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let cachedGetState: GetStateFn | null = null;
let terminalGetter: GetTerminalsFn | null = null;

const DEBOUNCE_MS = 2000;

/** Register the function that returns terminal buffers. Call once at init. */
export function setTerminalGetter(fn: GetTerminalsFn): void {
  terminalGetter = fn;
}

export function scheduleSave(getState: GetStateFn): void {
  cachedGetState = getState;
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer);
  }
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    saveNow();
  }, DEBOUNCE_MS);
}

export function flushSave(): void {
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  if (cachedGetState) {
    saveNow();
  }
}

export async function saveNow(): Promise<void> {
  if (!cachedGetState) return;

  const state = cachedGetState();
  const workspace: WorkspaceFile = {
    version: 1,
    savedAt: new Date().toISOString(),
    nodes: state.nodes.map(toPersistedNode),
    edges: [...state.edges],
    doneList: state.doneList.map(toPersistedNode),
  };

  try {
    const { mkdir, rename } = await import('fs/promises');
    await mkdir(STEMS_DIR, { recursive: true });

    // Atomic write: write to temp file, then rename
    await Bun.write(WORKSPACE_TMP_PATH, JSON.stringify(workspace, null, 2));
    await rename(WORKSPACE_TMP_PATH, WORKSPACE_PATH);

    // Also save terminal buffers if a getter has been registered
    if (terminalGetter) {
      await saveTerminals(terminalGetter);
    }
  } catch (err) {
    console.error('[persistence] Failed to save workspace:', err);
  }
}

async function saveTerminals(getBuffers: GetTerminalsFn): Promise<void> {
  const buffers = getBuffers();

  // Build record, skipping empty buffers
  const record: Record<string, TerminalMessage[]> = {};
  for (const [nodeId, messages] of buffers) {
    if (messages.length > 0) {
      record[nodeId] = messages;
    }
  }

  // Skip writing if there are no buffers to persist
  if (Object.keys(record).length === 0) {
    // Remove stale file if it exists
    try {
      const { unlink } = await import('fs/promises');
      const file = Bun.file(TERMINALS_PATH);
      if (await file.exists()) await unlink(TERMINALS_PATH);
    } catch { /* ignore */ }
    return;
  }

  const data: TerminalsFile = {
    version: 1,
    savedAt: new Date().toISOString(),
    buffers: record,
  };

  try {
    const { rename } = await import('fs/promises');
    await Bun.write(TERMINALS_TMP_PATH, JSON.stringify(data));
    await rename(TERMINALS_TMP_PATH, TERMINALS_PATH);
  } catch (err) {
    console.error('[persistence] Failed to save terminals:', err);
  }
}

// ── Load ────────────────────────────────────────────────────────────

export async function loadWorkspace(): Promise<{
  nodes: WeftNode[];
  edges: WeftEdge[];
  doneList: WeftNode[];
} | null> {
  try {
    const file = Bun.file(WORKSPACE_PATH);
    if (!(await file.exists())) return null;

    const raw = await file.json();

    // Validate structure
    if (!raw || typeof raw !== 'object') return null;
    if (raw.version !== 1) return null;
    if (!Array.isArray(raw.nodes) || !Array.isArray(raw.edges) || !Array.isArray(raw.doneList)) {
      return null;
    }

    const workspace = raw as WorkspaceFile;

    return {
      nodes: workspace.nodes.map(toWeftNode),
      edges: workspace.edges,
      doneList: workspace.doneList.map(toWeftNode),
    };
  } catch (err) {
    console.error('[persistence] Failed to load workspace (starting fresh):', err);
    return null;
  }
}

export async function loadTerminals(): Promise<Map<string, TerminalMessage[]> | null> {
  try {
    const file = Bun.file(TERMINALS_PATH);
    if (!(await file.exists())) return null;

    const raw = await file.json();

    // Validate structure
    if (!raw || typeof raw !== 'object') return null;
    if (raw.version !== 1) return null;
    if (!raw.buffers || typeof raw.buffers !== 'object') return null;

    const data = raw as TerminalsFile;
    const result = new Map<string, TerminalMessage[]>();

    for (const [nodeId, messages] of Object.entries(data.buffers)) {
      if (Array.isArray(messages) && messages.length > 0) {
        result.set(nodeId, messages);
      }
    }

    return result;
  } catch (err) {
    console.error('[persistence] Failed to load terminals (starting fresh):', err);
    return null;
  }
}
