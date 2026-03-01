import { resolve } from 'node:path';
import { updateNode, getNode, broadcast } from './state.ts';

// ── File overlap tracking ────────────────────────────────────────────

// Map of nodeId -> Set of file paths being edited
const nodeFiles: Map<string, Set<string>> = new Map();

/**
 * Normalize a file path for consistent comparison.
 * Resolves relative paths and removes trailing slashes.
 */
function normalizePath(filePath: string): string {
  const resolved = resolve(filePath);
  return resolved.replace(/\/+$/, '');
}

/**
 * Track a file edit for a given node and check for overlaps.
 * When overlap is detected, both overlapping nodes are updated.
 */
export function trackFileEdit(nodeId: string, filePath: string): void {
  const normalized = normalizePath(filePath);

  let files = nodeFiles.get(nodeId);
  if (!files) {
    files = new Set();
    nodeFiles.set(nodeId, files);
  }
  files.add(normalized);

  // Check all other active nodes for overlap
  recheckOverlaps();
}

/**
 * Get overlap information for a specific node.
 */
export function getOverlaps(nodeId: string): { hasOverlap: boolean; overlappingNodes: string[] } {
  const myFiles = nodeFiles.get(nodeId);
  if (!myFiles || myFiles.size === 0) {
    return { hasOverlap: false, overlappingNodes: [] };
  }

  const overlapping: string[] = [];

  for (const [otherId, otherFiles] of nodeFiles) {
    if (otherId === nodeId) continue;

    for (const file of myFiles) {
      if (otherFiles.has(file)) {
        overlapping.push(otherId);
        break; // One overlapping file is enough to flag this node
      }
    }
  }

  return {
    hasOverlap: overlapping.length > 0,
    overlappingNodes: overlapping,
  };
}

/**
 * Remove all tracking for a node (when completed or closed).
 * Re-checks remaining nodes since overlaps may have resolved.
 */
export function clearNode(nodeId: string): void {
  nodeFiles.delete(nodeId);
  recheckOverlaps();
}

/**
 * Return the list of files being edited by a specific node.
 */
export function getNodeFiles(nodeId: string): string[] {
  const files = nodeFiles.get(nodeId);
  return files ? [...files] : [];
}

/**
 * Return a map of nodeId -> file list for all actively tracked nodes.
 * Used for context injection into spawned sessions.
 */
export function getAllActiveFiles(): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const [nodeId, files] of nodeFiles) {
    if (files.size > 0) {
      result.set(nodeId, [...files]);
    }
  }
  return result;
}

/**
 * Re-check all tracked nodes for overlap and broadcast updates
 * for any nodes whose overlap status changed.
 */
function recheckOverlaps(): void {
  for (const [nodeId] of nodeFiles) {
    const overlap = getOverlaps(nodeId);
    const node = getNode(nodeId);
    if (!node) continue;

    // Only broadcast if overlap status actually changed
    const currentOverlap = node.overlap;
    const hasChanged =
      currentOverlap.hasOverlap !== overlap.hasOverlap ||
      currentOverlap.overlappingNodes.length !== overlap.overlappingNodes.length ||
      !currentOverlap.overlappingNodes.every((id) => overlap.overlappingNodes.includes(id));

    if (hasChanged) {
      const updated = updateNode(nodeId, { overlap });
      if (updated) {
        broadcast({ type: 'node_updated', node: updated });
      }
    }
  }
}
