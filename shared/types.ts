// ── Terminal message types ────────────────────────────────────────────

export type TerminalMessageType =
  | 'assistant_text'
  | 'user_message'
  | 'tool_use'
  | 'tool_result'
  | 'human_needed'
  | 'system'
  | 'error';

export interface TerminalMessage {
  type: TerminalMessageType;
  text: string;
  toolName?: string;
  isSuccess?: boolean;
  costUsd?: number;
}

// ── Node enums / union types ──────────────────────────────────────────

export type NodeState = 'idle' | 'running' | 'needs-human' | 'completed' | 'crashed';

export type DisplayStage = 'planning' | 'executing' | 'testing';

export type NodeType = 'repo' | 'feature' | 'subtask';

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

  x: number;
  y: number;

  /** The prompt used to spawn this node's session */
  prompt?: string;

  /** Only present on repo nodes */
  repoPath?: string;
  /** Optional branch name */
  branch?: string;
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
  | { type: 'error'; message: string };
