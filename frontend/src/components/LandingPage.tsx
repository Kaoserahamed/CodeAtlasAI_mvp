/**
 * Landing Page Component
 * Initial page where users input GitHub repository URL
 */

import { useState } from 'react';
import { GitBranch, Github, Search, Zap, Network, Code2 } from 'lucide-react';

interface LandingPageProps {
  onSubmit: (repoUrl: string) => void;
  isLoading?: boolean;
}

export function LandingPage({ onSubmit, isLoading = false }: LandingPageProps) {
  const [repoUrl, setRepoUrl] = useState('');
  const [error, setError] = useState('');

  const validateGitHubUrl = (url: string): boolean => {
    // Match GitHub URLs: https://github.com/user/repo or github.com/user/repo
    const githubPattern = /^(https?:\/\/)?(www\.)?github\.com\/[\w-]+\/[\w.-]+\/?$/;
    return githubPattern.test(url);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!repoUrl.trim()) {
      setError('Please enter a GitHub repository URL');
      return;
    }

    // Normalize URL
    let normalizedUrl = repoUrl.trim();
    if (!normalizedUrl.startsWith('http')) {
      normalizedUrl = 'https://' + normalizedUrl;
    }
    // Remove trailing slash
    normalizedUrl = normalizedUrl.replace(/\/$/, '');

    if (!validateGitHubUrl(normalizedUrl)) {
      setError('Please enter a valid GitHub repository URL (e.g., https://github.com/user/repo)');
      return;
    }

    onSubmit(normalizedUrl);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 flex items-center justify-center p-6">
      <div className="max-w-4xl w-full">
        {/* Header */}
        <div className="text-center mb-12">
          <div className="flex items-center justify-center mb-6">
            <div className="bg-blue-600 p-4 rounded-2xl shadow-lg">
              <Network className="text-white" size={48} />
            </div>
          </div>
          <h1 className="text-5xl font-bold text-gray-900 mb-4">
            Code<span className="text-blue-600">Atlas</span> AI
          </h1>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            Visualize your codebase as an interactive knowledge graph. 
            Understand file relationships, function calls, and code structure at a glance.
          </p>
        </div>

        {/* Features Grid */}
        <div className="grid md:grid-cols-3 gap-6 mb-12">
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 hover:shadow-md transition-shadow">
            <div className="bg-blue-100 w-12 h-12 rounded-lg flex items-center justify-center mb-4">
              <Search className="text-blue-600" size={24} />
            </div>
            <h3 className="font-semibold text-gray-900 mb-2">AST-Based Parsing</h3>
            <p className="text-sm text-gray-600">
              Deep code analysis using Abstract Syntax Trees to understand your JavaScript/TypeScript projects
            </p>
          </div>

          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 hover:shadow-md transition-shadow">
            <div className="bg-purple-100 w-12 h-12 rounded-lg flex items-center justify-center mb-4">
              <GitBranch className="text-purple-600" size={24} />
            </div>
            <h3 className="font-semibold text-gray-900 mb-2">Relationship Tracking</h3>
            <p className="text-sm text-gray-600">
              Visualize imports, function calls, and dependencies between files and functions
            </p>
          </div>

          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 hover:shadow-md transition-shadow">
            <div className="bg-green-100 w-12 h-12 rounded-lg flex items-center justify-center mb-4">
              <Zap className="text-green-600" size={24} />
            </div>
            <h3 className="font-semibold text-gray-900 mb-2">Interactive Graph</h3>
            <p className="text-sm text-gray-600">
              Explore your codebase with an intuitive, zoomable, and clickable graph visualization
            </p>
          </div>
        </div>

        {/* Input Form */}
        <div className="bg-white rounded-2xl shadow-xl border border-gray-200 p-8">
          <div className="flex items-center justify-center mb-6">
            <Github className="text-gray-700 mr-3" size={32} />
            <h2 className="text-2xl font-bold text-gray-900">Get Started</h2>
          </div>
          
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label 
                htmlFor="repo-url" 
                className="block text-sm font-medium text-gray-700 mb-2"
              >
                Enter GitHub Repository URL
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <Code2 className="text-gray-400" size={20} />
                </div>
                <input
                  id="repo-url"
                  type="text"
                  value={repoUrl}
                  onChange={(e) => {
                    setRepoUrl(e.target.value);
                    setError('');
                  }}
                  placeholder="https://github.com/username/repository"
                  disabled={isLoading}
                  className={`w-full pl-12 pr-4 py-4 border rounded-xl text-gray-900 placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all ${
                    error ? 'border-red-300 bg-red-50' : 'border-gray-300 bg-white'
                  } ${isLoading ? 'opacity-60 cursor-not-allowed' : ''}`}
                />
              </div>
              {error && (
                <p className="mt-2 text-sm text-red-600 flex items-center">
                  <span className="mr-1">⚠</span> {error}
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className={`w-full py-4 px-6 rounded-xl font-semibold text-white transition-all transform ${
                isLoading
                  ? 'bg-gray-400 cursor-not-allowed'
                  : 'bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 hover:shadow-lg active:scale-[0.98]'
              }`}
            >
              {isLoading ? (
                <span className="flex items-center justify-center">
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-3"></div>
                  Processing...
                </span>
              ) : (
                <span className="flex items-center justify-center">
                  <Search className="mr-2" size={20} />
                  Analyze Repository
                </span>
              )}
            </button>
          </form>

          {/* Example */}
          <div className="mt-6 pt-6 border-t border-gray-200">
            <p className="text-sm text-gray-500 mb-2">Example repositories to try:</p>
            <div className="flex flex-wrap gap-2">
              {[
                'https://github.com/vercel/next.js',
                'https://github.com/facebook/react',
                'https://github.com/microsoft/vscode'
              ].map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => setRepoUrl(example)}
                  disabled={isLoading}
                  className="text-xs px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {example.split('/').slice(-2).join('/')}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Footer Info */}
        <div className="mt-8 text-center text-sm text-gray-500">
          <p>
            Supports public JavaScript and TypeScript repositories. 
            <br />
            Analysis may take a few minutes depending on repository size.
          </p>
        </div>
      </div>
    </div>
  );
}
