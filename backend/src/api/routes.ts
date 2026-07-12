/**
 * API Routes for CodeAtlas
 */

import { FastifyInstance } from 'fastify';
import { Neo4jClient } from '../database/neo4jClient';
import { RepositoryScanner } from '../parser/repositoryScanner';

export async function registerRoutes(fastify: FastifyInstance) {
  const db = new Neo4jClient();

  /**
   * Health check endpoint
   */
  fastify.get('/api/health', async (request, reply) => {
    const dbConnected = await db.testConnection();
    return {
      status: 'ok',
      database: dbConnected ? 'connected' : 'disconnected',
      timestamp: new Date().toISOString(),
    };
  });

  /**
   * Fetch graph data
   */
  fastify.get('/api/graph', async (request, reply) => {
    try {
      const graph = await db.fetchGraph();
      return {
        success: true,
        data: graph,
      };
    } catch (error: any) {
      reply.code(500);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * Get graph statistics
   */
  fastify.get('/api/stats', async (request, reply) => {
    try {
      const stats = await db.getStats();
      return {
        success: true,
        data: stats,
      };
    } catch (error: any) {
      reply.code(500);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * Trigger repository scan
   */
  fastify.post<{
    Body: { path: string };
  }>('/api/scan', async (request, reply) => {
    try {
      const { path } = request.body;

      if (!path) {
        reply.code(400);
        return {
          success: false,
          error: 'Repository path is required',
        };
      }

      const scanner = new RepositoryScanner();
      const graph = scanner.scanDirectory(path);
      await db.storeGraph(graph);

      return {
        success: true,
        message: 'Repository scanned successfully',
        stats: {
          files: graph.files.length,
          functions: graph.functions.length,
          imports: graph.imports.length,
          calls: graph.calls.length,
        },
      };
    } catch (error: any) {
      reply.code(500);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * Clear graph data
   */
  fastify.delete('/api/graph', async (request, reply) => {
    try {
      await db.clearGraph();
      return {
        success: true,
        message: 'Graph cleared successfully',
      };
    } catch (error: any) {
      reply.code(500);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * Get function details with relationships
   */
  fastify.get<{
    Params: { id: string };
  }>('/api/function/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      // This would require additional Neo4j queries
      // For MVP, we return the info from the main graph
      const graph = await db.fetchGraph();
      const node = graph.nodes.find(n => n.id === id);

      if (!node) {
        reply.code(404);
        return {
          success: false,
          error: 'Function not found',
        };
      }

      // Find incoming and outgoing edges
      const incoming = graph.edges.filter(e => e.target === id);
      const outgoing = graph.edges.filter(e => e.source === id);

      return {
        success: true,
        data: {
          node,
          incoming,
          outgoing,
        },
      };
    } catch (error: any) {
      reply.code(500);
      return {
        success: false,
        error: error.message,
      };
    }
  });
}
