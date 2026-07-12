/**
 * Graph Canvas Component
 * Interactive graph visualization using React Flow
 */

import { useCallback, useEffect } from 'react';
import ReactFlow, {
  Node,
  Edge,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  MarkerType,
  Panel,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { GraphData, GraphNode as GraphNodeType } from '../types';
import { FileNode, FunctionNode as CustomFunctionNode } from './nodes';

// Register custom node types
const nodeTypes = {
  file: FileNode,
  function: CustomFunctionNode,
};

interface GraphCanvasProps {
  graphData: GraphData;
  onNodeClick: (node: GraphNodeType) => void;
  selectedNodeId: string | null;
}

export function GraphCanvas({ graphData, onNodeClick, selectedNodeId }: GraphCanvasProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  // Convert graph data to React Flow format
  useEffect(() => {
    if (!graphData) return;

    // Create a set of valid node IDs
    const validNodeIds = new Set(graphData.nodes.map(node => node.id));

    // Convert nodes
    const flowNodes: Node[] = graphData.nodes.map((node, index) => {
      return {
        id: node.id,
        type: node.type,
        data: {
          ...node.data,
          label: node.label,
          // Ensure we pass the correct path based on node type
          path: node.type === 'file' 
            ? (node.data as any).path 
            : (node.data as any).filePath,
          name: node.type === 'file'
            ? (node.data as any).name
            : (node.data as any).name,
        },
        position: {
          // Simple grid layout - you can enhance this with a proper layout algorithm
          x: (index % 5) * 250,
          y: Math.floor(index / 5) * 150,
        },
        style: {
          opacity: selectedNodeId ? (node.id === selectedNodeId ? 1 : 0.4) : 1,
        },
      };
    });

    // Filter out edges that point to non-existent nodes
    const validEdges = graphData.edges.filter(edge => 
      validNodeIds.has(edge.source) && validNodeIds.has(edge.target)
    );

    // Find edges connected to selected node
    const connectedEdgeIds = selectedNodeId 
      ? new Set(
          validEdges
            .filter(e => e.source === selectedNodeId || e.target === selectedNodeId)
            .map(e => e.id)
        )
      : new Set();

    // Convert edges with highlighting
    const flowEdges: Edge[] = validEdges.map((edge) => {
      const isConnected = connectedEdgeIds.has(edge.id);
      const baseColor = edge.type === 'IMPORTS' ? '#10b981' : '#3b82f6';
      const highlightColor = edge.type === 'IMPORTS' ? '#059669' : '#2563eb';
      
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label: edge.label,
        type: 'smoothstep',
        animated: edge.type === 'CALLS' && isConnected,
        style: {
          stroke: isConnected ? highlightColor : baseColor,
          strokeWidth: isConnected ? 3 : 2,
          opacity: selectedNodeId ? (isConnected ? 1 : 0.2) : 1,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: isConnected ? highlightColor : baseColor,
        },
        labelStyle: {
          fontSize: isConnected ? 11 : 10,
          fill: isConnected ? '#000' : '#666',
          fontWeight: isConnected ? 'bold' : 'normal',
        },
      };
    });

    setNodes(flowNodes);
    setEdges(flowEdges);
  }, [graphData, selectedNodeId, setNodes, setEdges]);

  // Handle node click
  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      const graphNode = graphData.nodes.find((n) => n.id === node.id);
      if (graphNode) {
        onNodeClick(graphNode);
      }
    },
    [graphData, onNodeClick]
  );

  return (
    <div className="w-full h-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        nodeTypes={nodeTypes}
        fitView
        attributionPosition="bottom-left"
      >
        <Controls />
        <Background color="#aaa" gap={16} />
        <Panel position="top-left" className="bg-white p-3 rounded-lg shadow-md">
          <div className="text-sm space-y-1">
            <div className="font-semibold text-gray-800">Legend</div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-blue-500 rounded"></div>
              <span className="text-gray-600">File</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-purple-500 rounded"></div>
              <span className="text-gray-600">Function</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-8 h-0.5 bg-green-500"></div>
              <span className="text-gray-600">Imports</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-8 h-0.5 bg-blue-500"></div>
              <span className="text-gray-600">Calls</span>
            </div>
          </div>
        </Panel>
        <Panel position="top-right" className="bg-white p-3 rounded-lg shadow-md">
          <div className="text-sm text-gray-600">
            <div>Nodes: {nodes.length}</div>
            <div>Edges: {edges.length}</div>
          </div>
        </Panel>
      </ReactFlow>
    </div>
  );
}
