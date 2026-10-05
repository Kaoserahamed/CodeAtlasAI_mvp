/**
 * Main App Component
 */

import { useState, useEffect, useCallback } from 'react';
import { GraphCanvas } from './components/GraphCanvas';
import { DetailsPanel } from './components/DetailsPanel';
import { Header } from './components/Header';
import { LandingPage } from './components/LandingPage';
import { ProcessingStatus, ProcessingStep } from './components/ProcessingStatus';
import { defaultProcessingSteps } from './processingSteps';
import { api, Job } from './services/api';
import { logger } from './services/logger';
import { GraphData, GraphNode } from './types';
import { AlertCircle } from 'lucide-react';
import { isDemoMode, demoGraphData } from './demo-data';

type AppView = 'landing' | 'processing' | 'graph';

function App() {
  const [currentView, setCurrentView] = useState<AppView>('landing');
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [repositoryUrl, setRepositoryUrl] = useState<string>('');
  const [processingSteps, setProcessingSteps] = useState<ProcessingStep[]>(defaultProcessingSteps);

  // Check if graph data exists on mount
  useEffect(() => {
    checkExistingGraph();
  }, []);

  /**
   * Check if there's existing graph data
   */
  const checkExistingGraph = async () => {
    if (isDemoMode) {
      setGraphData(demoGraphData as GraphData);
      setCurrentView('graph');
      return;
    }

    try {
      const data = await api.fetchGraph();
      if (data && data.nodes.length > 0) {
        setGraphData(data);
        setCurrentView('graph');
      } else {
        setCurrentView('landing');
      }
    } catch (err) {
      // No existing data, show landing page
      setCurrentView('landing');
    }
  };

  /**
   * Handle repository submission from landing page
   */
  const handleRepositorySubmit = async (repoUrl: string) => {
    setRepositoryUrl(repoUrl);
    setError(null);
    setIsLoading(true);
    setCurrentView('processing');
    
    // Reset processing steps
    setProcessingSteps(defaultProcessingSteps.map(step => ({ ...step })));

    try {
      // Start analysis
      const { jobId } = await api.analyzeGitHubRepository(repoUrl);

      // Poll for status updates
      await api.pollJobStatus(jobId, (job: Job) => {
        updateProcessingSteps(job);
      });

      // Load the graph data
      const data = await api.fetchGraph();
      setGraphData(data);
      setCurrentView('graph');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to analyze repository';
      logger.error('App', 'repository analysis failed', { error: err, repoUrl });
      setError(message);
      updateProcessingSteps({ status: 'failed', message } as Job);
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Update processing steps based on job status
   */
  const updateProcessingSteps = (job: Job) => {
    setProcessingSteps((prevSteps) => {
      const newSteps = prevSteps.map(step => ({ ...step }));

      // Reset all to pending first if starting
      if (job.status === 'pending') {
        return newSteps.map(s => ({ ...s, status: 'pending' as const }));
      }

      // Update based on current status
      switch (job.status) {
        case 'cloning':
          newSteps[0].status = 'active';
          newSteps[0].message = job.message;
          break;
        case 'analyzing':
          newSteps[0].status = 'completed';
          newSteps[1].status = 'active';
          newSteps[1].message = job.message;
          break;
        case 'storing':
          newSteps[0].status = 'completed';
          newSteps[1].status = 'completed';
          newSteps[2].status = 'active';
          newSteps[2].message = job.message;
          break;
        case 'completed':
          newSteps[0].status = 'completed';
          newSteps[1].status = 'completed';
          newSteps[2].status = 'completed';
          newSteps[3].status = 'completed';
          if (job.stats) {
            newSteps[3].message = `Found ${job.stats.files} files and ${job.stats.functions} functions`;
          }
          break;
        case 'failed': {
          // Mark current step as error. The block scopes `activeIndex`, which
          // would otherwise leak into the enclosing switch.
          const activeIndex = newSteps.findIndex(s => s.status === 'active');
          if (activeIndex !== -1) {
            newSteps[activeIndex].status = 'error';
            newSteps[activeIndex].message = job.error || 'An error occurred';
          }
          break;
        }
      }

      return newSteps;
    });
  };

  // Handle node click
  const handleNodeClick = useCallback((node: GraphNode) => {
    setSelectedNode(node);
  }, []);

  // Handle panel close
  const handleClosePanel = useCallback(() => {
    setSelectedNode(null);
  }, []);

  /**
   * Handle refresh - reload graph data
   */
  const handleRefresh = async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      const data = await api.fetchGraph();
      setGraphData(data);
    } catch (err) {
      logger.error('App', 'loading the graph failed', { error: err });
      setError(err instanceof Error ? err.message : 'Failed to load graph data');
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Handle new analysis
   */
  const handleNewAnalysis = () => {
    setCurrentView('landing');
    setGraphData(null);
    setSelectedNode(null);
    setError(null);
    setRepositoryUrl('');
  };

  // Render based on current view
  if (currentView === 'landing') {
    return (
      <LandingPage 
        onSubmit={handleRepositorySubmit} 
        isLoading={isLoading}
      />
    );
  }

  if (currentView === 'processing') {
    return (
      <ProcessingStatus
        steps={processingSteps}
        repositoryUrl={repositoryUrl}
        error={error || undefined}
        onComplete={() => {
          // This will be called after a delay when all steps are completed
        }}
      />
    );
  }

  // Graph view
  return (
    <div className="h-screen flex flex-col bg-gray-50">
      <Header
        onRefresh={handleRefresh}
        onNewAnalysis={handleNewAnalysis}
        isLoading={isLoading}
        stats={
          graphData
            ? { nodes: graphData.nodes.length, edges: graphData.edges.length }
            : undefined
        }
        repositoryName={repositoryUrl ? repositoryUrl.split('/').slice(-2).join('/') : undefined}
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
                  onClick={handleRefresh}
                  className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
                >
                  Try Again
                </button>
              </div>
            </div>
          )}

          {!isLoading && !error && graphData && graphData.nodes.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-50">
              <div className="text-center max-w-md mx-auto p-6">
                <p className="text-gray-600 mb-4">No graph data available</p>
                <button
                  onClick={handleNewAnalysis}
                  className="px-6 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors"
                >
                  Analyze Repository
                </button>
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
