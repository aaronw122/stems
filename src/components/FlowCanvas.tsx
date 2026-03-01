import { useCallback, useMemo } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  applyNodeChanges,
  applyEdgeChanges,
} from '@xyflow/react';
import type { NodeMouseHandler, OnNodeDrag, OnNodesChange, OnEdgesChange } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { RepoNode } from './nodes/RepoNode.tsx';
import { FeatureNode } from './nodes/FeatureNode.tsx';
import { SubtaskNode } from './nodes/SubtaskNode.tsx';
import { useGraph } from '../hooks/useGraph.ts';
import type { ClientMessage } from '../../shared/types.ts';

const nodeTypes = {
  repo: RepoNode,
  feature: FeatureNode,
  subtask: SubtaskNode,
};

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

  const handleUpdateTitle = useCallback(
    (nodeId: string, title: string) => {
      send({ type: 'update_title', nodeId, title });
    },
    [send],
  );

  // Inject callbacks into all node data so nodes can trigger spawning and title updates
  const nodesWithCallbacks = useMemo(
    () =>
      nodes.map((node) => ({
        ...node,
        data: { ...node.data, onSpawn, onUpdateTitle: handleUpdateTitle },
      })),
    [nodes, onSpawn, handleUpdateTitle],
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
  );
}
