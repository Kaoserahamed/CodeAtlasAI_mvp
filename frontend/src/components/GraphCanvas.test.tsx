/**
 * Graph canvas.
 *
 * React Flow is mocked rather than rendered. It measures its viewport on
 * mount, and jsdom has no layout engine, so a real render would fail on
 * missing measurements instead of telling us anything about the data
 * transformation this component is responsible for.
 *
 * The assertions therefore cover what GraphCanvas actually decides: which
 * nodes and edges reach the canvas, and how selection is expressed as
 * opacity. The node and edge counts are exposed through data-testid on the
 * mock.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GraphData } from '../types';

vi.mock('reactflow', async () => {
  // The node/edge state hooks are used for real: GraphCanvas populates them
  // from the graph data in an effect, so stubbing them out would leave the
  // canvas empty and every assertion here would be meaningless.
  const react = await import('react');

  // Only the two fields this spec reads are described. React Flow's own types
  // describe far more, and widening them here would let a real mismatch slip
  // past the compiler.
  type MockNode = { id: string; style?: { opacity?: number } };
  type MockEdge = { id: string; source: string; target: string };

  return {
    __esModule: true,
    default: ({
      nodes,
      edges,
    }: {
      nodes: MockNode[];
      edges: MockEdge[];
    }) =>
      react.createElement(
        'div',
        {
          'data-testid': 'reactflow',
          'data-node-count': String(nodes.length),
          'data-edge-count': String(edges.length),
          'data-opacities': JSON.stringify(nodes.map((n) => n.style?.opacity)),
        },
        null
      ),
    Controls: () => null,
    Background: () => null,
    Panel: ({ children }: { children?: React.ReactNode }) =>
      react.createElement('div', null, children),
    MarkerType: { ArrowClosed: 'arrowclosed' },
    useNodesState: <T,>(initial: T) => react.useState(initial),
    useEdgesState: <T,>(initial: T) => react.useState(initial),
  };
});

vi.mock('./nodes', () => ({
  FileNode: () => null,
  FunctionNode: () => null,
}));

// The component imports React Flow's stylesheet, which the jsdom runner has
// no CSS pipeline for.
vi.mock('reactflow/dist/style.css', () => ({}));

import { GraphCanvas } from './GraphCanvas';

const fileNode = (id: string, path: string) => ({
  id,
  type: 'file' as const,
  label: path,
  data: { id, type: 'file' as const, name: path.split('/').pop()!, path, extension: '.ts' },
});

const fnNode = (id: string, filePath: string) => ({
  id,
  type: 'function' as const,
  label: 'run',
  data: {
    id,
    type: 'function' as const,
    name: 'run',
    filePath,
    parameters: [],
    startLine: 1,
    endLine: 3,
  },
});

const graph: GraphData = {
  nodes: [fileNode('f1', 'src/a.ts'), fnNode('n1', 'src/a.ts'), fileNode('f2', 'src/b.ts')],
  edges: [
    { id: 'e1', source: 'n1', target: 'f2', type: 'IMPORTS', label: 'imports' },
  ],
};

const counts = () => ({
  nodes: Number(screen.getByTestId('reactflow').getAttribute('data-node-count')),
  edges: Number(screen.getByTestId('reactflow').getAttribute('data-edge-count')),
});

const opacities = () =>
  JSON.parse(screen.getByTestId('reactflow').getAttribute('data-opacities') ?? '[]');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GraphCanvas', () => {
  it('renders every node in the graph', () => {
    render(
      <GraphCanvas graphData={graph} onNodeClick={() => {}} selectedNodeId={null} />
    );

    expect(counts().nodes).toBe(3);
  });

  it('renders the edges whose endpoints both exist', () => {
    render(
      <GraphCanvas graphData={graph} onNodeClick={() => {}} selectedNodeId={null} />
    );

    expect(counts().edges).toBe(1);
  });

  it('drops an edge that points at a node which is not in the graph', () => {
    const dangling: GraphData = {
      nodes: [fileNode('f1', 'src/a.ts')],
      edges: [{ id: 'e1', source: 'f1', target: 'missing', type: 'IMPORTS', label: '' }],
    };

    render(
      <GraphCanvas graphData={dangling} onNodeClick={() => {}} selectedNodeId={null} />
    );

    // A dangling edge would render as a line to nowhere.
    expect(counts().edges).toBe(0);
  });

  it('leaves every node fully opaque when nothing is selected', () => {
    render(
      <GraphCanvas graphData={graph} onNodeClick={() => {}} selectedNodeId={null} />
    );

    expect(opacities()).toEqual([1, 1, 1]);
  });

  it('dims the other nodes and keeps the selection opaque', () => {
    render(
      <GraphCanvas graphData={graph} onNodeClick={() => {}} selectedNodeId="n1" />
    );

    // Only the selected node stays at full opacity; the rest recede.
    expect(opacities()).toEqual([0.4, 1, 0.4]);
  });

  it('handles an empty graph without throwing', () => {
    render(
      <GraphCanvas graphData={{ nodes: [], edges: [] }} onNodeClick={() => {}} selectedNodeId={null} />
    );

    expect(counts()).toEqual({ nodes: 0, edges: 0 });
  });
});