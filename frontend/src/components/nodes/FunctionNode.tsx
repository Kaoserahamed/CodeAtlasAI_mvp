/**
 * Custom Function Node Component
 */

import { memo } from 'react';
import { Handle, Position } from 'reactflow';
import { Code2 } from 'lucide-react';

interface FunctionNodeProps {
  data: {
    label?: string;
    name?: string;
    parameters?: string[];
    filePath?: string;
  };
}

export const FunctionNode = memo(({ data }: FunctionNodeProps) => {
  const paramCount = data.parameters?.length || 0;
  const functionName = data.name || data.label || 'anonymous';
  const fullSignature = `${functionName}(${data.parameters?.join(', ') || ''})`;
  
  return (
    <div className="px-3 py-2 shadow-md rounded-lg bg-purple-500 text-white border-2 border-purple-600 min-w-[120px] max-w-[200px]">
      <Handle type="target" position={Position.Top} className="w-3 h-3" />
      
      <div className="flex items-center gap-2">
        <Code2 size={14} className="flex-shrink-0" />
        <div className="font-medium text-xs truncate" title={fullSignature}>
          {functionName}
        </div>
      </div>
      
      {paramCount > 0 && (
        <div className="text-xs opacity-80 mt-1">
          {paramCount} param{paramCount !== 1 ? 's' : ''}
        </div>
      )}
      
      <Handle type="source" position={Position.Bottom} className="w-3 h-3" />
    </div>
  );
});

FunctionNode.displayName = 'FunctionNode';
