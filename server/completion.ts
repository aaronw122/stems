import {
  getNode,
  getEdges,
  removeNode,
  addToDoneList,
  getDoneList,
  broadcast,
} from './state.ts';
import type { WeftNode } from '../shared/types.ts';

// ── Completion criteria ──────────────────────────────────────────────

/**
 * Check whether a node meets all completion criteria:
 * 1. Its session has ended (nodeState is 'completed')
 * 2. If it has a PR, the PR is merged
 * 3. All its children (subtasks) are also completed
 */
export function checkCompletionCriteria(nodeId: string): boolean {
  const node = getNode(nodeId);
  if (!node) return false;

  // 1. Session must be completed
  if (node.nodeState !== 'completed') return false;

  // 2. If it has a PR, the PR must be merged
  if (node.prUrl && node.prState !== 'merged') return false;

  // 3. All children must also be complete
  const children = getChildNodes(nodeId);
  for (const child of children) {
    if (!checkCompletionCriteria(child.id)) return false;
  }

  return true;
}

/**
 * Get all direct children of a node (connected via edges where node is source).
 */
function getChildNodes(nodeId: string): WeftNode[] {
  const edges = getEdges();
  const childIds = edges
    .filter((e) => e.source === nodeId)
    .map((e) => e.target);

  const children: WeftNode[] = [];
  for (const childId of childIds) {
    const child = getNode(childId);
    // Skip phantom subagent nodes — they are transient visualizations
    // and must not block parent completion
    if (child && !child.isPhantomSubagent) children.push(child);
  }
  return children;
}

/**
 * Check if a node is completable and if so, auto-move it to the done list.
 * Also recursively checks parent nodes since completing a child
 * may unblock the parent's completion.
 */
export function autoMoveIfComplete(nodeId: string): void {
  const node = getNode(nodeId);
  if (!node) return;

  // Phantom subagent nodes are transient visualization — they have their own
  // removal lifecycle managed by the message processor, not the completion system.
  if (node.isPhantomSubagent) return;

  if (checkCompletionCriteria(nodeId)) {
    // Move to done list
    const removed = removeNode(nodeId);
    if (removed) {
      addToDoneList(removed);
      broadcast({ type: 'node_removed', nodeId });
      broadcast({ type: 'done_list_updated', doneList: getDoneList() });
      console.log(`[completion] Node ${nodeId} ("${removed.title}") moved to done list`);

      // Check if parent is now completable
      if (removed.parentId) {
        autoMoveIfComplete(removed.parentId);
      }
    }
  }
}
