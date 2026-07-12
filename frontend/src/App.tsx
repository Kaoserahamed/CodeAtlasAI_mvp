/**
 * Main App Component
 */

import { useState, useEffect, useCallback } from 'react';
import { GraphCanvas } from './components/GraphCanvas';
import { DetailsPanel } from './components/DetailsPanel';
import { Header } from './components/Header';
import { api } from './services/api';
import { GraphData, GraphNode } from './types';
import { AlertCircle } from 'lucide-react';
import { isDemoMode, demoGraphData } from './demo-data';

function App() {
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load graph data
  const loadGraph = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      if (isDemoMode) {
        // Load demo data
        setGraphData(demoGraphData as GraphData);
      } else {
        // Load from API
        const data = await api.fetchGraph();
        setGraphData(data);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load graph data');
      console.error('Error loading graph:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Load data on mount
  useEffect(() => {
    loadGraph();
  }, [loadGraph]);

  // Handle node click
  const handleNodeClick = useCallback((node: GraphNode) => {
    setSelectedNode(node);
  }, []);

  // Handle panel close
  const handleClosePanel = useCallback(() => {
    setSelectedNode(null);
  }, []);

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      <Header
        onRefresh={loadGraph}
        isLoading={isLoading}
        stats={
          graphData
            ? { nodes: graphData.nodes.length, edges: graphData.edges.length }
            : undefined
        }
      />

      <div className="flex-1 flex overflow-hidden">
        {/* Main Canvas */}
        <div className="flex-1 relative">
          {isLoading && !graphData && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-50">
              <div className="text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
                <p className="text-gray-600">Loading graph data...</p>
              </div>
            </div>
          )}

          {error && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-50">
              <div className="text-center max-w-md mx-auto p-6">
                <AlertCircle className="text-red-500 mx-auto mb-4" size={48} />
                <h3 className="text-lg font-semibold text-gray-800 mb-2">
                  Error Loading Graph
                </h3>
                <p className="text-gray-600 mb-4">{error}</p>
                <button
                  onClick={loadGraph}
                  className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
                >
                  Try Again
                </button>
                <div className="mt-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg text-left text-sm text-gray-700">
                  <p className="font-semibold mb-2">Make sure:</p>
                  <ul className="list-disc list-inside space-y-1">
                    <li>Backend server is running on port 3001</li>
                    <li>Neo4j database is running and accessible</li>
                    <li>You've scanned a repository using: <code className="bg-yellow-100 px-1 rounded">npm run scan</code></li>
                  </ul>
                </div>
              </div>
            </div>
          )}

          {!isLoading && !error && graphData && graphData.nodes.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-50">
              <div className="text-center max-w-md mx-auto p-6">
                <p className="text-gray-600 mb-4">No graph data available</p>
                <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg text-left text-sm text-gray-700">
                  <p className="font-semibold mb-2">To get started:</p>
                  <ol className="list-decimal list-inside space-y-1">
                    <li>Open a terminal in the <code className="bg-blue-100 px-1 rounded">backend</code> directory</li>
                    <li>Run: <code className="bg-blue-100 px-1 rounded">npm run scan -- /path/to/your/repo</code></li>
                    <li>Click the Refresh button</li>
                  </ol>
                </div>
              </div>
            </div>
          )}

          {!isLoading && !error && graphData && graphData.nodes.length > 0 && (
            <GraphCanvas
              graphData={graphData}
              onNodeClick={handleNodeClick}
              selectedNodeId={selectedNode?.id || null}
            />
          )}
        </div>

        {/* Details Panel */}
        {selectedNode && graphData && (
          <DetailsPanel
            node={selectedNode}
            edges={graphData.edges}
            nodes={graphData.nodes}
            onClose={handleClosePanel}
          />
        )}
      </div>
    </div>
  );
}

export default App;
