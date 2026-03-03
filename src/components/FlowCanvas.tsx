import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  SelectionMode,
  applyNodeChanges,
  applyEdgeChanges,
} from '@xyflow/react';
import type { NodeMouseHandler, OnNodeDrag, OnNodesChange, OnEdgesChange, Edge } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { RepoNode } from './nodes/RepoNode.tsx';
import { FeatureNode } from './nodes/FeatureNode.tsx';
import { SubtaskNode } from './nodes/SubtaskNode.tsx';
import { PhantomNode } from './nodes/PhantomNode.tsx';
import { ConfirmDialog } from './ConfirmDialog.tsx';
import { useGraph } from '../hooks/useGraph.ts';
import type { ClientMessage, WeftNode } from '../../shared/types.ts';

const nodeTypes = {
  repo: RepoNode,
  feature: FeatureNode,
  subtask: SubtaskNode,
  phantom: PhantomNode,
};

function getDescendantIds(nodeId: string, edges: Edge[]): string[] {
  const descendants: string[] = [];
  const queue = [nodeId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const edge of edges) {
      if (edge.source === current) {
        descendants.push(edge.target);
        queue.push(edge.target);
      }
    }
  }
  return descendants;
}

interface FlowCanvasProps {
  send: (msg: ClientMessage) => void;
  onSpawn: (nodeId: string, spawnType: 'feature' | 'subtask') => void;
}

export function FlowCanvas({ send, onSpawn }: FlowCanvasProps) {
  const nodes = useGraph((s) => s.nodes);
  const edges = useGraph((s) => s.edges);
  const setSelectedNode = useGraph((s) => s.setSelectedNode);
  const onNodeDragStop = useGraph((s) => s.onNodeDragStop);
  const applyChanges = useGraph((s) => s.applyNodeChanges);
  const applyEdgeChangesStore = useGraph((s) => s.applyEdgeChanges);

  // ── Delete confirmation state ─────────────────────────────────────
  const [deleteConfirm, setDeleteConfirm] = useState<{
    isOpen: boolean;
    nodeIds: string[];
    title: string;
    message: string;
    details: string;
  }>({ isOpen: false, nodeIds: [], title: '', message: '', details: '' });

  const handleDeleteRequest = useCallback(
    (...requestedIds: string[]) => {
      // Deduplicate: skip nodes that are already descendants of another selected node
      const allDescendants = new Set<string>();
      for (const id of requestedIds) {
        for (const desc of getDescendantIds(id, edges)) {
          allDescendants.add(desc);
        }
      }
      const rootIds = requestedIds.filter((id) => !allDescendants.has(id));

      // Collect all nodes that will be removed (roots + their descendants)
      const allRemovedIds = new Set(rootIds);
      for (const id of rootIds) {
        for (const desc of getDescendantIds(id, edges)) {
          allRemovedIds.add(desc);
        }
      }

      // Build title, message, and details
      const nodeTypeLabel = (type?: string) =>
        type === 'repo' ? 'repo' : type === 'feature' ? 'feature' : type === 'subtask' ? 'subtask' : 'node';

      let title: string;
      let message: string;
      if (rootIds.length === 1) {
        const node = nodes.find((n) => n.id === rootIds[0]);
        const name = (node?.data as Record<string, unknown> | undefined)?.title as string ?? 'this node';
        title = `Remove ${nodeTypeLabel(node?.type).replace(/^./, (c) => c.toUpperCase())}`;
        message = `Remove ${name} from the Stems view?`;
      } else {
        title = `Remove ${rootIds.length} Nodes`;
        message = `Remove ${rootIds.length} selected nodes from the Stems view?`;
      }

      const descendantCount = allRemovedIds.size - rootIds.length;
      let details = '';
      if (descendantCount > 0) {
        const descendantNodes = [...allRemovedIds]
          .filter((id) => !rootIds.includes(id))
          .map((id) => nodes.find((n) => n.id === id));
        const featureCount = descendantNodes.filter((n) => n?.type === 'feature').length;
        const subtaskCount = descendantNodes.filter((n) => n?.type === 'subtask').length;
        const parts: string[] = [];
        if (featureCount > 0) parts.push(`${featureCount} feature${featureCount > 1 ? 's' : ''}`);
        if (subtaskCount > 0) parts.push(`${subtaskCount} subtask${subtaskCount > 1 ? 's' : ''}`);
        details = `${descendantCount} child node${descendantCount > 1 ? 's' : ''} (${parts.join(', ')}) will also be removed. Active sessions will be terminated.`;
      }

      setDeleteConfirm({ isOpen: true, nodeIds: rootIds, title, message, details });
    },
    [nodes, edges],
  );

  const handleDeleteConfirm = useCallback(() => {
    for (const nodeId of deleteConfirm.nodeIds) {
      send({ type: 'delete_tree', nodeId });
    }
    setDeleteConfirm({ isOpen: false, nodeIds: [], title: '', message: '', details: '' });
  }, [send, deleteConfirm.nodeIds]);

  const handleDeleteCancel = useCallback(() => {
    setDeleteConfirm({ isOpen: false, nodeIds: [], title: '', message: '', details: '' });
  }, []);

  // ── Delete key handler (multi-select aware) ─────────────────────
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;

        const selectedNodes = nodes.filter((n) => n.selected);
        if (selectedNodes.length === 0) return;

        e.preventDefault();
        handleDeleteRequest(...selectedNodes.map((n) => n.id));
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [nodes, handleDeleteRequest]);

  const handlePaneClick = useCallback(() => {
    setSelectedNode(null);
  }, [setSelectedNode]);

  const handleUpdateTitle = useCallback(
    (nodeId: string, title: string) => {
      send({ type: 'update_title', nodeId, title });
    },
    [send],
  );

  // Inject callbacks into all node data so nodes can trigger spawning, title updates, and deletion
  const nodesWithCallbacks = useMemo(
    () =>
      nodes.map((node) => ({
        ...node,
        data: { ...node.data, onSpawn, onUpdateTitle: handleUpdateTitle, onDelete: handleDeleteRequest },
      })),
    [nodes, onSpawn, handleUpdateTitle, handleDeleteRequest],
  );

  const onNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      // Phantom subagent nodes are not selectable — they have no terminal to peek
      if ((node.data as unknown as WeftNode)?.isPhantomSubagent) return;
      setSelectedNode(node.id);
    },
    [setSelectedNode],
  );

  const handleNodeDragStop: OnNodeDrag = useCallback(
    (_event, node) => {
      onNodeDragStop(node.id, node.position.x, node.position.y);
      send({
        type: 'node_moved',
        nodeId: node.id,
        x: node.position.x,
        y: node.position.y,
      });
    },
    [onNodeDragStop, send],
  );

  const handleNodesChange: OnNodesChange = useCallback(
    (changes) => {
      applyChanges(changes);
    },
    [applyChanges],
  );

  const handleEdgesChange: OnEdgesChange = useCallback(
    (changes) => {
      applyEdgeChangesStore(changes);
    },
    [applyEdgeChangesStore],
  );

  const defaultEdgeOptions = useMemo(
    () => ({
      style: { stroke: '#525252', strokeWidth: 2 },
      animated: false,
    }),
    [],
  );

  return (
    <>
    <ConfirmDialog
      isOpen={deleteConfirm.isOpen}
      title={deleteConfirm.title}
      message={deleteConfirm.message}
      details={deleteConfirm.details || undefined}
      confirmLabel="Remove"
      onConfirm={handleDeleteConfirm}
      onCancel={handleDeleteCancel}
      destructive
    />
    <ReactFlow
      nodes={nodesWithCallbacks}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={handleNodesChange}
      onEdgesChange={handleEdgesChange}
      onNodeClick={onNodeClick}
      onNodeDragStop={handleNodeDragStop}
      onPaneClick={handlePaneClick}
      defaultEdgeOptions={defaultEdgeOptions}
      deleteKeyCode={null}
      panOnDrag={false}
      selectionOnDrag
      selectionMode={SelectionMode.Partial}
      panOnScroll
      zoomOnPinch
      zoomOnScroll={false}
      minZoom={0.25}
      maxZoom={4}
      colorMode="dark"
      fitView
      proOptions={{ hideAttribution: true }}
    >
      <Background color="#333" gap={20} />
      <Controls />
      <MiniMap
        nodeColor={(node) => {
          if (node.type === 'repo') return '#22c55e';
          if (node.type === 'feature') return '#3b82f6';
          if (node.type === 'phantom') return '#8b5cf6';
          return '#6b7280';
        }}
        style={{ background: '#1a1a1a' }}
      />
    </ReactFlow>
    </>
  );
}
