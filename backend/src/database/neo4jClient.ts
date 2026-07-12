/**
 * Neo4j Database Client
 * Handles connection and operations with Neo4j graph database
 */

import neo4j, { Driver, Session } from 'neo4j-driver';
import { config } from '../config';
import { CodeGraph, GraphData, GraphNode, GraphEdge } from '../types';

export class Neo4jClient {
  private driver: Driver;

  constructor() {
    this.driver = neo4j.driver(
      config.neo4j.uri,
      neo4j.auth.basic(config.neo4j.user, config.neo4j.password)
    );
  }

  /**
   * Test database connection
   */
  async testConnection(): Promise<boolean> {
    let session: Session | null = null;
    try {
      session = this.driver.session();
      await session.run('RETURN 1');
      console.log('✓ Neo4j connection successful');
      return true;
    } catch (error) {
      console.error('✗ Neo4j connection failed:', error);
      return false;
    } finally {
      if (session) await session.close();
    }
  }

  /**
   * Store code graph in Neo4j
   */
  async storeGraph(graph: CodeGraph): Promise<void> {
    const session = this.driver.session();

    try {
      // Clear existing data (optional - remove if you want to preserve)
      console.log('Clearing existing graph data...');
      await session.run('MATCH (n) DETACH DELETE n');

      // Create file nodes
      console.log(`Creating ${graph.files.length} file nodes...`);
      for (const file of graph.files) {
        await session.run(
          `
          MERGE (f:File {id: $id})
          SET f.name = $name,
              f.path = $path,
              f.extension = $extension
          `,
          {
            id: file.id,
            name: file.name,
            path: file.path,
            extension: file.extension,
          }
        );
      }

      // Create function nodes
      console.log(`Creating ${graph.functions.length} function nodes...`);
      for (const func of graph.functions) {
        await session.run(
          `
          MERGE (fn:Function {id: $id})
          SET fn.name = $name,
              fn.filePath = $filePath,
              fn.parameters = $parameters,
              fn.startLine = $startLine,
              fn.endLine = $endLine
          `,
          {
            id: func.id,
            name: func.name,
            filePath: func.filePath,
            parameters: func.parameters,
            startLine: func.startLine,
            endLine: func.endLine,
          }
        );

        // Create BELONGS_TO relationship between function and file
        await session.run(
          `
          MATCH (fn:Function {id: $functionId})
          MATCH (f:File {id: $fileId})
          MERGE (fn)-[:BELONGS_TO]->(f)
          `,
          {
            functionId: func.id,
            fileId: func.filePath,
          }
        );
      }

      // Create IMPORTS relationships
      console.log(`Creating ${graph.imports.length} import relationships...`);
      for (const imp of graph.imports) {
        await session.run(
          `
          MATCH (from:File {id: $from})
          MERGE (to:File {id: $to})
          MERGE (from)-[r:IMPORTS]->(to)
          SET r.symbols = $symbols
          `,
          {
            from: imp.from,
            to: imp.to,
            symbols: imp.importedSymbols || [],
          }
        );
      }

      // Create CALLS relationships
      console.log(`Creating ${graph.calls.length} call relationships...`);
      for (const call of graph.calls) {
        // Try to find the target function
        await session.run(
          `
          MATCH (from:Function {id: $from})
          OPTIONAL MATCH (to:Function {name: $toName})
          WHERE to.filePath = $filePath OR to.filePath IN [(from)-[:BELONGS_TO]->(f:File)-[:IMPORTS]->(imp:File) | imp.path]
          FOREACH (ignoredVar IN CASE WHEN to IS NOT NULL THEN [1] ELSE [] END |
            MERGE (from)-[r:CALLS]->(to)
          )
          `,
          {
            from: call.from,
            toName: call.to,
            filePath: call.filePath,
          }
        );
      }

      console.log('✓ Graph data stored successfully');
    } catch (error) {
      console.error('Error storing graph:', error);
      throw error;
    } finally {
      await session.close();
    }
  }

  /**
   * Fetch all graph data for visualization
   */
  async fetchGraph(): Promise<GraphData> {
    const session = this.driver.session();

    try {
      const nodes: GraphNode[] = [];
      const edges: GraphEdge[] = [];

      // Fetch file nodes
      const fileResult = await session.run(`
        MATCH (f:File)
        RETURN f
      `);

      for (const record of fileResult.records) {
        const file = record.get('f').properties;
        nodes.push({
          id: file.id,
          type: 'file',
          label: file.name,
          data: {
            id: file.id,
            type: 'file',
            name: file.name,
            path: file.path,
            extension: file.extension,
          },
        });
      }

      // Fetch function nodes
      const functionResult = await session.run(`
        MATCH (fn:Function)
        RETURN fn
      `);

      for (const record of functionResult.records) {
        const func = record.get('fn').properties;
        nodes.push({
          id: func.id,
          type: 'function',
          label: func.name,
          data: {
            id: func.id,
            type: 'function',
            name: func.name,
            filePath: func.filePath,
            parameters: func.parameters || [],
            startLine: typeof func.startLine === 'number' ? func.startLine : func.startLine.toNumber(),
            endLine: typeof func.endLine === 'number' ? func.endLine : func.endLine.toNumber(),
          },
        });
      }

      // Fetch IMPORTS relationships
      const importsResult = await session.run(`
        MATCH (from:File)-[r:IMPORTS]->(to:File)
        RETURN from.id as fromId, to.id as toId, r
      `);

      for (const record of importsResult.records) {
        const fromId = record.get('fromId');
        const toId = record.get('toId');
        edges.push({
          id: `${fromId}-IMPORTS-${toId}`,
          source: fromId,
          target: toId,
          type: 'IMPORTS',
          label: 'imports',
        });
      }

      // Fetch CALLS relationships
      const callsResult = await session.run(`
        MATCH (from:Function)-[r:CALLS]->(to:Function)
        RETURN from.id as fromId, to.id as toId, r
      `);

      for (const record of callsResult.records) {
        const fromId = record.get('fromId');
        const toId = record.get('toId');
        edges.push({
          id: `${fromId}-CALLS-${toId}`,
          source: fromId,
          target: toId,
          type: 'CALLS',
          label: 'calls',
        });
      }

      // Fetch BELONGS_TO relationships (function to file)
      const belongsResult = await session.run(`
        MATCH (fn:Function)-[r:BELONGS_TO]->(f:File)
        RETURN fn.id as fromId, f.id as toId
      `);

      for (const record of belongsResult.records) {
        const fromId = record.get('fromId');
        const toId = record.get('toId');
        edges.push({
          id: `${fromId}-BELONGS_TO-${toId}`,
          source: fromId,
          target: toId,
          type: 'CALLS', // Use CALLS type for styling
          label: 'belongs to',
        });
      }

      return { nodes, edges };
    } catch (error) {
      console.error('Error fetching graph:', error);
      throw error;
    } finally {
      await session.close();
    }
  }

  /**
   * Clear all graph data
   */
  async clearGraph(): Promise<void> {
    const session = this.driver.session();
    try {
      await session.run('MATCH (n) DETACH DELETE n');
      console.log('✓ Graph cleared');
    } catch (error) {
      console.error('Error clearing graph:', error);
      throw error;
    } finally {
      await session.close();
    }
  }

  /**
   * Get graph statistics
   */
  async getStats(): Promise<any> {
    const session = this.driver.session();
    try {
      const result = await session.run(`
        MATCH (n)
        WITH labels(n) as label, count(*) as count
        RETURN label[0] as type, count
        UNION
        MATCH ()-[r]->()
        RETURN type(r) as type, count(r) as count
      `);

      const stats: any = {};
      for (const record of result.records) {
        const type = record.get('type');
        const count = record.get('count').toNumber();
        stats[type] = count;
      }

      return stats;
    } finally {
      await session.close();
    }
  }

  /**
   * Close database connection
   */
  async close(): Promise<void> {
    await this.driver.close();
  }
}
