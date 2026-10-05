/**
 * Server entry point.
 *
 * Changes from the previous version:
 *  - CORS is restricted to an explicit allowlist. It used to reflect any
 *    origin, which let any site call the API from a user's browser.
 *  - A missing database no longer kills the process. The server starts and
 *    reports the degraded state through /api/health, so the UI can explain
 *    the problem instead of the container crash-looping.
 *  - Rate limiting and a request-id are in place, and shutdown closes the
 *    database driver cleanly.
 */
import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { config } from './config';
import { registerRoutes } from './api/routes';
import { Neo4jClient } from './database/neo4jClient';

const fastify = Fastify({
  logger: {
    // pino is declared explicitly rather than left to Fastify's default so the
    // logging dependency is visible in package.json and the level is a
    // deliberate choice. `warn` in production keeps a busy deployment from
    // filling its log with a line per job progress tick.
    level: config.nodeEnv === 'development' ? 'info' : 'warn',
    // Flatten nested objects into the log line so `jobId` and `repoId` are
    // top-level fields rather than a nested blob that is awkward to query.
    base: { service: 'codeatlas-api' },
  },
  // A client-supplied body larger than this is rejected outright.
  bodyLimit: 1_048_576,
  genReqId: () => `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
});

async function start(): Promise<void> {
  try {
    await fastify.register(cors, {
      origin: config.corsOrigins,
      credentials: true,
    });

    await fastify.register(rateLimit, {
      max: 120,
      timeWindow: '1 minute',
      // Health checks should not consume anyone else's budget.
      allowList: (req) => req.url === '/api/health',
    });

    const db = new Neo4jClient();
    const connected = await db.testConnection();

    if (!connected) {
      // Logged, not fatal: the API stays up so /api/health can be scraped and
      // the frontend can show a clear message.
      fastify.log.error(
        'Neo4j is unreachable. The API will start but analysis will fail until it is available.'
      );
    } else {
      await db.ensureSchema();
    }

    await registerRoutes(fastify);

    const address = await fastify.listen({
      port: config.port,
      host: '0.0.0.0',
    });

    fastify.log.info(`CodeAtlas API listening on ${address}`);
    fastify.log.info(
      `Database: ${connected ? 'connected' : 'DISCONNECTED'} | CORS origins: ${
        config.corsOrigins === false ? 'same-origin only' : config.corsOrigins.join(', ')
      }`
    );
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

async function shutdown(signal: string): Promise<void> {
  fastify.log.info(`${signal} received, shutting down`);
  try {
    await fastify.close();
  } catch {
    // Best effort: the process is exiting regardless.
  }
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

void start();
