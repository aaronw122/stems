import { join } from 'path';
import { homedir } from 'os';
import type { WeftNode, WeftEdge } from '../shared/types.ts';

// ── Persisted types ─────────────────────────────────────────────────

export type PersistedNode = Pick<
  WeftNode,
  'id' | 'type' | 'parentId' | 'title' | 'repoPath' | 'branch' | 'prompt' | 'prUrl' | 'prState' | 'costUsd' | 'tokenUsage'
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
    // Reset volatile fields to safe defaults
    nodeState: 'idle',
    displayStage: 'planning',
    sessionId: null,
    needsHuman: false,
    humanNeededType: null,
    humanNeededPayload: null,
    errorInfo: null,
    overlap: { hasOverlap: false, overlappingNodes: [] },
    x: 0,
    y: 0,
  };
}

// ── Debounced save ──────────────────────────────────────────────────

type GetStateFn = () => { nodes: WeftNode[]; edges: WeftEdge[]; doneList: WeftNode[] };

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let cachedGetState: GetStateFn | null = null;

const DEBOUNCE_MS = 2000;

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
    const { mkdir } = await import('fs/promises');
    await mkdir(STEMS_DIR, { recursive: true });

    // Atomic write: write to temp file, then rename
    await Bun.write(WORKSPACE_TMP_PATH, JSON.stringify(workspace, null, 2));
    const { rename } = await import('fs/promises');
    await rename(WORKSPACE_TMP_PATH, WORKSPACE_PATH);
  } catch (err) {
    console.error('[persistence] Failed to save workspace:', err);
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
