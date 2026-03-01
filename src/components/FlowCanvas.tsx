import { useCallback, useMemo, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  applyNodeChanges,
  applyEdgeChanges,
} from '@xyflow/react';
import type { NodeMouseHandler, OnNodeDrag, OnNodesChange, OnEdgesChange, Edge } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { RepoNode } from './nodes/RepoNode.tsx';
import { FeatureNode } from './nodes/FeatureNode.tsx';
import { SubtaskNode } from './nodes/SubtaskNode.tsx';
import { ConfirmDialog } from './ConfirmDialog.tsx';
import { useGraph } from '../hooks/useGraph.ts';
import type { ClientMessage } from '../../shared/types.ts';

const nodeTypes = {
  repo: RepoNode,
  feature: FeatureNode,
  subtask: SubtaskNode,
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
    nodeId: string;
    nodeName: string;
    details: string;
  }>({ isOpen: false, nodeId: '', nodeName: '', details: '' });

  const handleDeleteRequest = useCallback(
    (nodeId: string) => {
      const descendantIds = getDescendantIds(nodeId, edges);
      const nodeData = nodes.find((n) => n.id === nodeId);
      const nodeName = (nodeData?.data as Record<string, unknown> | undefined)?.title as string ?? 'this repo';

      let details = '';
      if (descendantIds.length > 0) {
        const descendants = descendantIds.map((id) => nodes.find((n) => n.id === id));
        const featureCount = descendants.filter((n) => n?.type === 'feature').length;
        const subtaskCount = descendants.filter((n) => n?.type === 'subtask').length;
        const parts: string[] = [];
        if (featureCount > 0) parts.push(`${featureCount} feature${featureCount > 1 ? 's' : ''}`);
        if (subtaskCount > 0) parts.push(`${subtaskCount} subtask${subtaskCount > 1 ? 's' : ''}`);
        details = `${nodeName} and ${descendantIds.length} child node${descendantIds.length > 1 ? 's' : ''} (${parts.join(', ')}) will be removed. Active sessions will be terminated.`;
      }

      setDeleteConfirm({ isOpen: true, nodeId, nodeName, details });
    },
    [nodes, edges],
  );

  const handleDeleteConfirm = useCallback(() => {
    send({ type: 'delete_tree', nodeId: deleteConfirm.nodeId });
    setDeleteConfirm({ isOpen: false, nodeId: '', nodeName: '', details: '' });
  }, [send, deleteConfirm.nodeId]);

  const handleDeleteCancel = useCallback(() => {
    setDeleteConfirm({ isOpen: false, nodeId: '', nodeName: '', details: '' });
  }, []);

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
      title="Remove Repo"
      message={`Remove ${deleteConfirm.nodeName} from the Stems view?`}
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
      defaultEdgeOptions={defaultEdgeOptions}
      panOnScroll
      zoomOnPinch
      zoomOnScroll={false}
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
          return '#6b7280';
        }}
        style={{ background: '#1a1a1a' }}
      />
    </ReactFlow>
    </>
  );
}
