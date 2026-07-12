/**
 * CodeAtlas Backend Server
 * Main entry point for the API server
 */

import Fastify from 'fastify';
import cors from '@fastify/cors';
import { config } from './config';
import { registerRoutes } from './api/routes';
import { Neo4jClient } from './database/neo4jClient';

const fastify = Fastify({
  logger: {
    level: config.nodeEnv === 'development' ? 'info' : 'error',
  },
});

async function start() {
  try {
    // Register CORS
    await fastify.register(cors, {
      origin: true, // Allow all origins in development
    });

    // Test database connection
    console.log('Testing Neo4j connection...');
    const db = new Neo4jClient();
    const connected = await db.testConnection();

    if (!connected) {
      console.error('Failed to connect to Neo4j. Please check your configuration.');
      console.error('Make sure Neo4j is running and .env file is configured correctly.');
      process.exit(1);
    }

    // Register routes
    await registerRoutes(fastify);

    // Start server
    const address = await fastify.listen({
      port: config.port,
      host: '0.0.0.0',
    });

    console.log('\n=================================');
    console.log('🚀 CodeAtlas Backend Server');
    console.log('=================================');
    console.log(`Server running at: ${address}`);
    console.log(`Environment: ${config.nodeEnv}`);
    console.log(`Neo4j: ${config.neo4j.uri}`);
    console.log('\nAPI Endpoints:');
    console.log(`  GET  ${address}/api/health`);
    console.log(`  GET  ${address}/api/graph`);
    console.log(`  GET  ${address}/api/stats`);
    console.log(`  POST ${address}/api/scan`);
    console.log(`  DELETE ${address}/api/graph`);
    console.log('=================================\n');
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

// Handle shutdown gracefully
process.on('SIGINT', async () => {
  console.log('\nShutting down gracefully...');
  await fastify.close();
  process.exit(0);
});

start();
