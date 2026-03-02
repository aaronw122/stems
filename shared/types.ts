// ── Terminal message types ────────────────────────────────────────────

export type TerminalMessageType =
  | 'assistant_text'
  | 'user_message'
  | 'tool_use'
  | 'tool_result'
  | 'human_needed'
  | 'system'
  | 'session_banner'
  | 'error';

export interface TerminalMessage {
  type: TerminalMessageType;
  text: string;
  toolName?: string;
  isSuccess?: boolean;
  costUsd?: number;
  diffRemoved?: string;
  diffAdded?: string;
  bannerData?: {
    claudeCodeVersion: string;
    model: string;           // raw model ID like "claude-opus-4-6"
    modelDisplayName: string; // pretty name like "Opus 4.6"
    subscriptionType?: string;
    cwd: string;
    upgradeAvailable?: boolean;
    latestVersion?: string;
  };
}

// ── Node enums / union types ──────────────────────────────────────────

export type NodeState = 'idle' | 'running' | 'needs-human' | 'completed' | 'crashed';

export type DisplayStage = 'planning' | 'executing' | 'testing';

export type NodeType = 'repo' | 'feature' | 'subtask' | 'phantom';

export type HumanNeededType = 'question' | 'permission' | 'error' | 'idle' | null;

// ── Core data models ─────────────────────────────────────────────────

export interface WeftNode {
  id: string;
  type: NodeType;
  parentId: string | null;
  title: string;
  nodeState: NodeState;
  displayStage: DisplayStage;

  needsHuman: boolean;
  humanNeededType: HumanNeededType;
  humanNeededPayload: unknown;

  sessionId: string | null;
  errorInfo: { type: string; message: string } | null;

  overlap: { hasOverlap: boolean; overlappingNodes: string[] };

  prUrl: string | null;
  prState: 'open' | 'merged' | 'closed' | null;

  costUsd: number;
  tokenUsage: { input: number; output: number };
  contextPercent: number | null;

  x: number;
  y: number;

  /** The prompt used to spawn this node's session */
  prompt?: string;

  /** Only present on repo nodes */
  repoPath?: string;
  /** Optional branch name */
  branch?: string;

  /** Marks auto-created visualization nodes for subagent tracking */
  isPhantomSubagent?: boolean;
  /** Correlates back to the SDK task_id for subagent lifecycle */
  subagentTaskId?: string;
  /** Number of tool uses by this subagent (phantom nodes only) */
  toolUseCount?: number;
  /** Total tokens consumed by this subagent (phantom nodes only) */
  totalTokens?: number;
  /** Current activity description for the subagent (phantom nodes only) */
  currentActivity?: string;
}

export interface WeftEdge {
  id: string;
  source: string;
  target: string;
}

// ── Client -> Server messages ────────────────────────────────────────

export type SendInputPayload =
  | { kind: 'question_answer'; answer: string }
  | { kind: 'permission'; granted: boolean }
  | { kind: 'text_input'; text: string };

export type ClientMessage =
  | { type: 'add_repo'; path: string }
  | { type: 'spawn_feature'; parentId: string; title: string; prompt: string }
  | { type: 'spawn_subtask'; parentId: string; title: string; prompt: string }
  | { type: 'subscribe_terminal'; nodeId: string }
  | { type: 'unsubscribe_terminal'; nodeId: string }
  | { type: 'update_title'; nodeId: string; title: string }
  | { type: 'close_node'; nodeId: string }
  | { type: 'delete_tree'; nodeId: string }
  | { type: 'node_moved'; nodeId: string; x: number; y: number }
  | { type: 'send_input'; nodeId: string; payload: SendInputPayload };

// ── Server -> Client messages ────────────────────────────────────────

export type ServerMessage =
  | { type: 'full_state'; nodes: WeftNode[]; edges: WeftEdge[]; doneList: WeftNode[] }
  | { type: 'node_added'; node: WeftNode; edge: WeftEdge | null }
  | { type: 'node_updated'; node: WeftNode }
  | { type: 'node_removed'; nodeId: string }
  | { type: 'terminal_data'; nodeId: string; messages: TerminalMessage[] }
  | { type: 'terminal_replay'; nodeId: string; messages: TerminalMessage[] }
  | { type: 'done_list_updated'; doneList: WeftNode[] }
  | { type: 'tree_removed'; nodeIds: string[] }
  | { type: 'error'; message: string };

// ── Autocomplete ────────────────────────────────────────────────────

export interface AutocompleteItem {
  label: string;       // filename or command name
  detail?: string;     // path context or command description
  insertText: string;  // what gets inserted on Tab
}
