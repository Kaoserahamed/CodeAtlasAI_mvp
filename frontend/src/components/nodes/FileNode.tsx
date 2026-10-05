/**
 * Custom File Node Component
 */

import { memo } from 'react';
import { Handle, Position } from 'reactflow';
import { File } from 'lucide-react';

interface FileNodeProps {
  data: {
    id?: string;
    label?: string;
    name?: string;
    extension?: string;
    path?: string;
  };
}

export const FileNode = memo(({ data }: FileNodeProps) => {
  // Safely extract filename with better fallbacks
  let fileName = 'Unknown File';
  let isExternalModule = false;
  let fullPath = '';
  
  // Try to get the id from data
  const id = data.id || data.path || data.label || '';
  fullPath = id;
  
  if (data.name) {
    fileName = data.name;
  } else if (data.path) {
    const parts = data.path.split(/[/\\]/);
    fileName = parts[parts.length - 1] || data.path;
  } else if (data.label) {
    const parts = data.label.split(/[/\\]/);
    fileName = parts[parts.length - 1] || data.label;
  } else if (id) {
    // Extract filename from id
    const parts = id.split(/[/\\]/);
    const lastPart = parts[parts.length - 1];
    
    if (lastPart) {
      fileName = lastPart;
      // Check if it's an external module (no file extension)
      if (!lastPart.includes('.')) {
        isExternalModule = true;
      }
    } else if (id && !id.includes('\\') && !id.includes('/')) {
      // It's just a module name like 'express', 'http'
      fileName = id;
      isExternalModule = true;
    }
  }
  
  const extension = data.extension || (isExternalModule ? 'npm' : '');
  
  return (
    <div className="px-4 py-2 shadow-md rounded-lg bg-blue-500 text-white border-2 border-blue-600 min-w-[150px] max-w-[250px]">
      <Handle type="target" position={Position.Top} className="w-3 h-3" />
      
      <div className="flex items-center gap-2">
        <File size={16} className="flex-shrink-0" />
        <div className="font-semibold text-sm truncate" title={fullPath}>
          {fileName}
        </div>
      </div>
      
      {extension && (
        <div className="text-xs opacity-80 mt-1">{extension}</div>
      )}
      
      <Handle type="source" position={Position.Bottom} className="w-3 h-3" />
    </div>
  );
});

FileNode.displayName = 'FileNode';
