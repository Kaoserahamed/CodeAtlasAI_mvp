/**
 * Details Panel Component
 * Shows detailed information when a node is selected
 */

import { X, FileText, Code2, ArrowRight, ArrowLeft } from 'lucide-react';
import { GraphNode, GraphEdge, FunctionNode } from '../types';

interface DetailsPanelProps {
  node: GraphNode | null;
  edges: GraphEdge[];
  nodes: GraphNode[];
  onClose: () => void;
}

export function DetailsPanel({ node, edges, nodes, onClose }: DetailsPanelProps) {
  if (!node) return null;

  const isFunction = node.type === 'function';
  const data = node.data;

  // Find incoming and outgoing connections
  const incomingEdges = edges.filter((e) => e.target === node.id);
  const outgoingEdges = edges.filter((e) => e.source === node.id);

  // Get node names for connections
  const getNodeLabel = (nodeId: string): string => {
    const n = nodes.find((node) => node.id === nodeId);
    return n?.label || nodeId;
  };

  return (
    <div className="w-96 h-full bg-white border-l border-gray-200 shadow-lg overflow-y-auto">
      {/* Header */}
      <div className="sticky top-0 bg-white border-b border-gray-200 p-4 flex items-center justify-between z-10">
        <div className="flex items-center gap-2">
          {isFunction ? (
            <Code2 className="text-purple-500" size={20} />
          ) : (
            <FileText className="text-blue-500" size={20} />
          )}
          <h2 className="text-lg font-semibold text-gray-800">
            {isFunction ? 'Function' : 'File'} Details
          </h2>
        </div>
        <button
          onClick={onClose}
          className="p-1 hover:bg-gray-100 rounded transition-colors"
          aria-label="Close panel"
        >
          <X size={20} />
        </button>
      </div>

      {/* Content */}
      <div className="p-4 space-y-6">
        {/* Basic Info */}
        <div>
          <h3 className="text-sm font-semibold text-gray-500 uppercase mb-2">
            Basic Information
          </h3>
          <div className="bg-gray-50 rounded-lg p-3 space-y-2">
            <div>
              <div className="text-xs text-gray-500">Name</div>
              <div className="font-mono text-sm text-gray-800">{node.label}</div>
            </div>
            
            {isFunction && 'parameters' in data && (
              <div>
                <div className="text-xs text-gray-500">Parameters</div>
                <div className="font-mono text-sm text-gray-800">
                  {data.parameters.length > 0
                    ? `(${data.parameters.join(', ')})`
                    : '(no parameters)'}
                </div>
              </div>
            )}

            {isFunction && 'startLine' in data && (
              <div>
                <div className="text-xs text-gray-500">Location</div>
                <div className="font-mono text-sm text-gray-800">
                  Lines {data.startLine} - {data.endLine}
                </div>
              </div>
            )}

            {'path' in data && (
              <div>
                <div className="text-xs text-gray-500">Path</div>
                <div className="font-mono text-xs text-gray-600 break-all">
                  {data.path}
                </div>
              </div>
            )}

            {isFunction && 'filePath' in data && (
              <div>
                <div className="text-xs text-gray-500">File</div>
                <div className="font-mono text-xs text-gray-600 break-all">
                  {data.filePath}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Incoming Connections */}
        {incomingEdges.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-gray-500 uppercase mb-2 flex items-center gap-2">
              <ArrowLeft size={16} />
              Incoming ({incomingEdges.length})
            </h3>
            <div className="space-y-2">
              {incomingEdges.map((edge) => (
                <div
                  key={edge.id}
                  className="bg-green-50 border border-green-200 rounded-lg p-3"
                >
                  <div className="text-xs text-green-600 font-semibold mb-1">
                    {edge.type}
                  </div>
                  <div className="font-mono text-sm text-gray-800">
                    {getNodeLabel(edge.source)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Outgoing Connections */}
        {outgoingEdges.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-gray-500 uppercase mb-2 flex items-center gap-2">
              <ArrowRight size={16} />
              Outgoing ({outgoingEdges.length})
            </h3>
            <div className="space-y-2">
              {outgoingEdges.map((edge) => (
                <div
                  key={edge.id}
                  className="bg-blue-50 border border-blue-200 rounded-lg p-3"
                >
                  <div className="text-xs text-blue-600 font-semibold mb-1">
                    {edge.type}
                  </div>
                  <div className="font-mono text-sm text-gray-800">
                    {getNodeLabel(edge.target)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* No Connections */}
        {incomingEdges.length === 0 && outgoingEdges.length === 0 && (
          <div className="text-center py-8 text-gray-400">
            <p>No connections found</p>
          </div>
        )}
      </div>
    </div>
  );
}
