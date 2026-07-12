/**
 * Header Component
 */

import { Network, RefreshCw } from 'lucide-react';

interface HeaderProps {
  onRefresh: () => void;
  isLoading: boolean;
  stats?: {
    nodes: number;
    edges: number;
  };
}

export function Header({ onRefresh, isLoading, stats }: HeaderProps) {
  return (
    <header className="bg-white border-b border-gray-200 px-6 py-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-500 rounded-lg">
            <Network className="text-white" size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-800">
              CodeAtlas AI
              {import.meta.env.VITE_DEMO_MODE === 'true' && (
                <span className="ml-2 text-sm bg-yellow-100 text-yellow-800 px-2 py-1 rounded">
                  DEMO
                </span>
              )}
            </h1>
            <p className="text-sm text-gray-500">Codebase Knowledge Graph</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {stats && (
            <div className="flex items-center gap-4 text-sm text-gray-600">
              <div>
                <span className="font-semibold">{stats.nodes}</span> nodes
              </div>
              <div>
                <span className="font-semibold">{stats.edges}</span> edges
              </div>
            </div>
          )}
          
          <button
            onClick={onRefresh}
            disabled={isLoading}
            className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label="Refresh graph"
          >
            <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
            {isLoading ? 'Loading...' : 'Refresh'}
          </button>
        </div>
      </div>
    </header>
  );
}
