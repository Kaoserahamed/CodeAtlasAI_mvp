/**
 * Processing Status Component
 * Shows progress when analyzing a repository
 */

import { useEffect } from 'react';
import { CheckCircle2, Loader2, Download, Search, Database, Sparkles } from 'lucide-react';

export interface ProcessingStep {
  id: string;
  label: string;
  status: 'pending' | 'active' | 'completed' | 'error';
  message?: string;
}

interface ProcessingStatusProps {
  steps: ProcessingStep[];
  repositoryUrl: string;
  onComplete?: () => void;
  error?: string;
}

export function ProcessingStatus({ 
  steps, 
  repositoryUrl, 
  onComplete,
  error 
}: ProcessingStatusProps) {
  useEffect(() => {
    // Check if all steps are completed
    const allCompleted = steps.every(step => step.status === 'completed');
    if (allCompleted && onComplete) {
      // Delay to show completed state
      const timer = setTimeout(() => {
        onComplete();
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [steps, onComplete]);

  const getStepIcon = (step: ProcessingStep) => {
    switch (step.status) {
      case 'completed':
        return <CheckCircle2 className="text-green-500" size={24} />;
      case 'active':
        return <Loader2 className="text-blue-500 animate-spin" size={24} />;
      case 'error':
        return <div className="text-red-500 text-xl">✕</div>;
      default:
        return <div className="w-6 h-6 rounded-full border-2 border-gray-300" />;
    }
  };

  const getIconForStepId = (id: string) => {
    switch (id) {
      case 'clone':
        return Download;
      case 'analyze':
        return Search;
      case 'store':
        return Database;
      case 'complete':
        return Sparkles;
      default:
        return CheckCircle2;
    }
  };

  const completedCount = steps.filter(s => s.status === 'completed').length;
  const progress = (completedCount / steps.length) * 100;

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 flex items-center justify-center p-6">
      <div className="max-w-2xl w-full">
        {/* Header */}
        <div className="text-center mb-8">
          <h2 className="text-3xl font-bold text-gray-900 mb-2">
            Analyzing Repository
          </h2>
          <p className="text-gray-600 mb-4">
            {repositoryUrl.split('/').slice(-2).join('/')}
          </p>
          
          {/* Progress Bar */}
          <div className="bg-gray-200 rounded-full h-2 overflow-hidden">
            <div 
              className="bg-gradient-to-r from-blue-600 to-purple-600 h-full transition-all duration-500 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-sm text-gray-500 mt-2">
            {completedCount} of {steps.length} steps completed
          </p>
        </div>

        {/* Steps */}
        <div className="bg-white rounded-2xl shadow-xl border border-gray-200 p-8">
          {error ? (
            <div className="text-center py-8">
              <div className="text-red-500 text-5xl mb-4">⚠</div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">
                Analysis Failed
              </h3>
              <p className="text-gray-600 mb-6">{error}</p>
              <button
                onClick={() => window.location.reload()}
                className="px-6 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors"
              >
                Try Again
              </button>
            </div>
          ) : (
            <div className="space-y-6">
              {steps.map((step, index) => {
                const StepIcon = getIconForStepId(step.id);
                const isActive = step.status === 'active';
                const isCompleted = step.status === 'completed';
                const isError = step.status === 'error';

                return (
                  <div
                    key={step.id}
                    className={`flex items-start space-x-4 transition-all duration-300 ${
                      isActive ? 'scale-105' : ''
                    }`}
                  >
                    {/* Icon/Status */}
                    <div className="flex-shrink-0 relative">
                      <div
                        className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${
                          isCompleted
                            ? 'bg-green-100'
                            : isActive
                            ? 'bg-blue-100'
                            : isError
                            ? 'bg-red-100'
                            : 'bg-gray-100'
                        }`}
                      >
                        <StepIcon
                          className={`${
                            isCompleted
                              ? 'text-green-600'
                              : isActive
                              ? 'text-blue-600'
                              : isError
                              ? 'text-red-600'
                              : 'text-gray-400'
                          } ${isActive ? 'animate-pulse' : ''}`}
                          size={24}
                        />
                      </div>
                      {index < steps.length - 1 && (
                        <div
                          className={`absolute left-1/2 top-12 w-0.5 h-6 -ml-px transition-colors ${
                            isCompleted ? 'bg-green-300' : 'bg-gray-200'
                          }`}
                        />
                      )}
                    </div>

                    {/* Content */}
                    <div className="flex-1 pt-2">
                      <div className="flex items-center justify-between">
                        <h3
                          className={`font-semibold ${
                            isActive
                              ? 'text-blue-600'
                              : isCompleted
                              ? 'text-green-600'
                              : isError
                              ? 'text-red-600'
                              : 'text-gray-400'
                          }`}
                        >
                          {step.label}
                        </h3>
                        {getStepIcon(step)}
                      </div>
                      {step.message && (
                        <p
                          className={`text-sm mt-1 ${
                            isActive ? 'text-gray-600' : 'text-gray-500'
                          }`}
                        >
                          {step.message}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Info */}
        {!error && (
          <div className="mt-6 text-center text-sm text-gray-500">
            <p>This may take a few minutes depending on repository size...</p>
          </div>
        )}
      </div>
    </div>
  );
}
