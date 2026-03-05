import { join } from 'path';
import { homedir } from 'os';
import type { ProviderId, RuntimeMetadata, WeftNode, WeftEdge, TerminalMessage } from '../shared/types.ts';
import {
  DEFAULT_PROVIDER_ID,
  isProviderId,
  normalizeRuntimeMetadata,
  resolveResumeCompatibility,
} from './provider-metadata.ts';

// ── Persisted types ─────────────────────────────────────────────────

export interface PersistedNode {
  id: string;
  type: WeftNode['type'];
  parentId: string | null;
  title: string;
  repoPath?: string;
  branch?: string;
  prompt?: string;
  prUrl: string | null;
  prState: 'open' | 'merged' | 'closed' | null;
  costUsd: number;
  tokenUsage: {
    input: number;
    output: number;
  };
  isPhantomSubagent?: boolean;
  sessionId?: string | null;
  providerId?: ProviderId;
  runtime?: Partial<RuntimeMetadata> | null;
}

export interface WorkspaceFile {
  version: 1;
  savedAt: string;
  nodes: PersistedNode[];
  edges: WeftEdge[];
  doneList: PersistedNode[];
}

export interface WorkspaceBackfillReport {
  providerDefaultsApplied: number;
  runtimeDefaultsApplied: number;
  legacySessionIdsPromoted: number;
}

export interface LoadedWorkspace {
  nodes: WeftNode[];
  edges: WeftEdge[];
  doneList: WeftNode[];
  backfill: WorkspaceBackfillReport;
}

// ── File paths ──────────────────────────────────────────────────────

const STEMS_DIR = join(homedir(), '.stems');
const WORKSPACE_PATH = join(STEMS_DIR, 'workspace.json');
const WORKSPACE_TMP_PATH = join(STEMS_DIR, 'workspace.json.tmp');
const TERMINALS_PATH = join(STEMS_DIR, 'terminals.json');
const TERMINALS_TMP_PATH = join(STEMS_DIR, 'terminals.json.tmp');

// ── Node conversion ─────────────────────────────────────────────────

function toFiniteNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function normalizeTokenUsage(
  tokenUsage: PersistedNode['tokenUsage'] | null | undefined,
): { input: number; output: number } {
  if (!tokenUsage || typeof tokenUsage !== 'object') {
    return { input: 0, output: 0 };
  }
  return {
    input: toFiniteNumber(tokenUsage.input),
    output: toFiniteNumber(tokenUsage.output),
  };
}

function normalizeProviderId(providerId: unknown): ProviderId {
  return isProviderId(providerId) ? providerId : DEFAULT_PROVIDER_ID;
}

function normalizePrState(value: unknown): 'open' | 'merged' | 'closed' | null {
  return value === 'open' || value === 'merged' || value === 'closed' ? value : null;
}

interface NodeBackfillInfo {
  providerDefaulted: boolean;
  runtimeDefaulted: boolean;
  legacySessionIdPromoted: boolean;
}

function emptyBackfillReport(): WorkspaceBackfillReport {
  return {
    providerDefaultsApplied: 0,
    runtimeDefaultsApplied: 0,
    legacySessionIdsPromoted: 0,
  };
}

function mergeBackfillReports(
  report: WorkspaceBackfillReport,
  nodeBackfill: NodeBackfillInfo,
): void {
  if (nodeBackfill.providerDefaulted) {
    report.providerDefaultsApplied += 1;
  }
  if (nodeBackfill.runtimeDefaulted) {
    report.runtimeDefaultsApplied += 1;
  }
  if (nodeBackfill.legacySessionIdPromoted) {
    report.legacySessionIdsPromoted += 1;
  }
}

export function toPersistedNode(node: WeftNode): PersistedNode {
  const runtime = normalizeRuntimeMetadata(node.providerId, node.runtime);
  const resumeCompat = resolveResumeCompatibility(
    node.providerId,
    runtime.resumeToken,
    node.sessionId,
  );

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
    sessionId: resumeCompat.sessionId,
    providerId: node.providerId,
    runtime: {
      ...runtime,
      resumeToken: resumeCompat.resumeToken,
    },
  };
}

export function toWeftNodeWithBackfill(
  persisted: PersistedNode,
): { node: WeftNode; backfill: NodeBackfillInfo } {
  const providerId = normalizeProviderId(persisted.providerId);
  const runtime = normalizeRuntimeMetadata(providerId, persisted.runtime);
  const resumeCompat = resolveResumeCompatibility(
    providerId,
    runtime.resumeToken,
    persisted.sessionId,
  );

  const node: WeftNode = {
    id: persisted.id,
    type: persisted.type,
    parentId: persisted.parentId,
    title: persisted.title,
    repoPath: persisted.repoPath,
    branch: persisted.branch,
    prompt: persisted.prompt,
    prUrl: persisted.prUrl ?? null,
    prState: normalizePrState(persisted.prState),
    costUsd: toFiniteNumber(persisted.costUsd),
    tokenUsage: normalizeTokenUsage(persisted.tokenUsage),
    isPhantomSubagent: persisted.isPhantomSubagent,
    providerId,
    runtime: {
      ...runtime,
      resumeToken: resumeCompat.resumeToken,
    },
    // Reset volatile fields to safe defaults
    nodeState: 'idle',
    displayStage: 'planning',
    sessionId: resumeCompat.sessionId,
    needsHuman: false,
    humanNeededType: null,
    humanNeededPayload: null,
    errorInfo: null,
    overlap: { hasOverlap: false, overlappingNodes: [] },
    contextPercent: null,
    x: 0,
    y: 0,
  };

  const runtimeObject = persisted.runtime;
  const runtimeDefaulted = !runtimeObject
    || typeof runtimeObject !== 'object'
    || typeof runtimeObject.runtimeId !== 'string'
    || runtimeObject.runtimeId.trim().length === 0;

  return {
    node,
    backfill: {
      providerDefaulted: !isProviderId(persisted.providerId),
      runtimeDefaulted,
      legacySessionIdPromoted: resumeCompat.source === 'legacy-session-id',
    },
  };
}

export function toWeftNode(persisted: PersistedNode): WeftNode {
  return toWeftNodeWithBackfill(persisted).node;
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

export async function loadWorkspace(): Promise<LoadedWorkspace | null> {
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
    const backfillReport = emptyBackfillReport();

    const restoredNodes = workspace.nodes.map((node) => {
      const restored = toWeftNodeWithBackfill(node);
      mergeBackfillReports(backfillReport, restored.backfill);
      return restored.node;
    });

    const restoredDoneList = workspace.doneList.map((node) => {
      const restored = toWeftNodeWithBackfill(node);
      mergeBackfillReports(backfillReport, restored.backfill);
      return restored.node;
    });

    return {
      nodes: restoredNodes,
      edges: workspace.edges,
      doneList: restoredDoneList,
      backfill: backfillReport,
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
