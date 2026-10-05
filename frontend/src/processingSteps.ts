import type { ProcessingStep } from './components/ProcessingStatus';

// Re-exported so tests and callers can import the type alongside the data
// without reaching into the component module for a type-only symbol.
export type { ProcessingStep };

/**
 * Default pipeline shown while a repository is analysed.
 *
 * This lives outside the component module so that the file exports only
 * components, which is what React Fast Refresh requires: re-exporting a
 * plain constant from a component file disables hot reloading for it.
 */
export const defaultProcessingSteps: ProcessingStep[] = [
  {
    id: 'clone',
    label: 'Cloning Repository',
    status: 'pending',
    message: 'Downloading source code from GitHub...',
  },
  {
    id: 'analyze',
    label: 'Analyzing Code',
    status: 'pending',
    message: 'Parsing files and extracting structure...',
  },
  {
    id: 'store',
    label: 'Building Knowledge Graph',
    status: 'pending',
    message: 'Storing relationships in database...',
  },
  {
    id: 'complete',
    label: 'Complete',
    status: 'pending',
    message: 'Ready to visualize!',
  },
];