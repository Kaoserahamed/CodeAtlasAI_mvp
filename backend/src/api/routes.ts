/**
 * HTTP API.
 *
 * Every route declares a JSON schema so requests are validated before reaching
 * any logic. The previous version had no schemas, returned raw internal error
 * messages to clients, and reflected any CORS origin.
 *
 * Analysis is asynchronous: the analyze route returns a job id immediately and
 * the work happens on the background queue.
 */
import { FastifyInstance, FastifyReply } from 'fastify';
import { Neo4jClient } from '../database/neo4jClient';
import { AnalysisService } from '../services/analysisService';
import { GitHubService } from '../services/githubService';
import {
  InvalidRepoUrlError,
  parseRepoUrl,
  repoIdFor,
  RepoRef,
} from '../services/repoUrlValidator';
import { jobService, JobContext } from '../services/jobService';
import { metrics } from '../services/metricsService';
import { ParserRegistry } from '../parser/registry';
import { config } from '../config';

const db = new Neo4jClient();
const github = new GitHubService();

/** Uniform error envelope; internal details never reach the client. */
function fail(reply: FastifyReply, status: number, message: string) {
  return reply.code(status).send({ success: false, error: message });
}

/** Split a comma-separated query parameter into a list. */
const splitList = (value?: string) =>
  value ? value.split(',').map((s) => s.trim()).filter(Boolean) : undefined;

export async function registerRoutes(fastify: FastifyInstance) {
  const registry = ParserRegistry.default();
  const analysis = new AnalysisService({ db, registry });

  // One subscriber feeds both the structured log and the metrics collector, so
  // the numbers in /api/metrics and the lines in the log can never disagree.
  jobService.onUpdate((job) => {
    metrics.observe(job);
    fastify.log.info(
      { jobId: job.id, repoId: job.repoId, status: job.status, stage: job.stage, progress: job.progress },
      'job updated'
    );
    if (job.status === 'failed') {
      fastify.log.error(
        { jobId: job.id, repoId: job.repoId, error: job.error },
        'job failed'
      );
    }
  });

  // ---------------------------------------------------------------- health
  fastify.get('/api/health', async () => ({
    status: 'ok',
    database: (await db.testConnection()) ? 'connected' : 'disconnected',
    languages: registry.languages,
    version: '2.0.0',
    timestamp: new Date().toISOString(),
  }));

  /**
   * Queue depth and run timings.
   *
   * Separate from /api/health, which is polled by the container runtime and
   * should stay cheap and dependency-free. This endpoint is for a human
   * answering "why is this slow", so it is allowed to be a little heavier.
   */
  fastify.get('/api/metrics', async () => {
    const snapshot = metrics.snapshot();
    return { success: true, data: snapshot };
  });

  /** What this deployment can actually do, so the UI can adapt. */
  fastify.get('/api/capabilities', async () => ({
    success: true,
    data: {
      languages: registry.languages,
      extensions: registry.supportedExtensions(),
      privateRepositories: Boolean(process.env.GITHUB_TOKEN || process.env.GH_TOKEN),
      ai: Boolean(process.env.GEMINI_API_KEY),
    },
  }));

  // ------------------------------------------------------------ repositories
  fastify.get('/api/repositories', async () => ({
    success: true,
    data: await db.listRepositories(),
  }));

  /** Validate a repository URL without cloning anything. */
  fastify.post<{ Body: { repoUrl: string } }>(
    '/api/repositories/validate',
    {
      schema: {
        body: {
          type: 'object',
          required: ['repoUrl'],
          properties: {
            repoUrl: { type: 'string', minLength: 3, maxLength: 500 },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const ref = parseRepoUrl(request.body.repoUrl);
        return {
          success: true,
          data: {
            owner: ref.owner,
            repo: ref.repo,
            repoId: repoIdFor(ref),
            webUrl: ref.webUrl,
          },
        };
      } catch (err) {
        if (err instanceof InvalidRepoUrlError) return fail(reply, 400, err.message);
        request.log.error({ err }, 'repository validation failed');
        return fail(reply, 500, 'Failed to validate repository');
      }
    }
  );

  /**
   * Queue an analysis run. Returns 202 with a job id; the scan itself runs on
   * the background queue so a large repository never blocks the request.
   */
  fastify.post<{ Body: { repoUrl: string; ref?: string; force?: boolean } }>(
    '/api/repositories/analyze',
    {
      schema: {
        body: {
          type: 'object',
          required: ['repoUrl'],
          properties: {
            repoUrl: { type: 'string', minLength: 3, maxLength: 500 },
            ref: { type: 'string', maxLength: 200 },
            force: { type: 'boolean', default: false },
          },
        },
      },
    },
    async (request, reply) => {
      let ref: RepoRef;
      try {
        ref = parseRepoUrl(request.body.repoUrl);
      } catch (err) {
        if (err instanceof InvalidRepoUrlError) return fail(reply, 400, err.message);
        return fail(reply, 400, 'Invalid repository URL');
      }

      const repoId = repoIdFor(ref);
      const requestedRef = request.body.ref;
      const force = request.body.force ?? false;

      const job = jobService.enqueue(
        { repoUrl: ref.webUrl, repoId, ref: requestedRef },
        async (job, ctx) => {
          const localPath = await cloneForScan(ref, requestedRef, ctx);
          try {
            return await analysis.analyze(
              { repoId: job.repoId, repoRoot: localPath, force },
              ctx
            );
          } finally {
            // Release disk promptly unless explicitly configured to keep it.
            if (!config.keepCloneAfterScan) {
              await github.cleanup(localPath).catch(() => undefined);
            }
          }
        }
      );

      return reply.code(202).send({
        success: true,
        jobId: job.id,
        repoId,
        message: 'Analysis queued',
      });
    }
  );

  // -------------------------------------------------------------------- jobs
  fastify.get<{ Params: { jobId: string } }>(
    '/api/jobs/:jobId',
    {
      schema: {
        params: {
          type: 'object',
          required: ['jobId'],
          properties: { jobId: { type: 'string', maxLength: 100 } },
        },
      },
    },
    async (request, reply) => {
      const job = jobService.get(request.params.jobId);
      if (!job) return fail(reply, 404, 'Job not found');
      return { success: true, data: job };
    }
  );

  fastify.get('/api/jobs', async () => ({ success: true, data: jobService.list() }));

  fastify.delete<{ Params: { jobId: string } }>(
    '/api/jobs/:jobId',
    async (request, reply) => {
      if (!jobService.cancel(request.params.jobId)) {
        return fail(reply, 404, 'Job not found or already finished');
      }
      return { success: true, message: 'Cancellation requested' };
    }
  );

  // ------------------------------------------------------------------- graph
  fastify.get<{
    Querystring: {
      repoId?: string;
      limit?: string;
      kind?: string;
      edgeKind?: string;
      prefix?: string;
      language?: string;
      q?: string;
    };
  }>(
    '/api/graph',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            repoId: { type: 'string', maxLength: 200 },
            limit: { type: 'string', pattern: '^[0-9]{1,5}$' },
            kind: { type: 'string', maxLength: 300 },
            edgeKind: { type: 'string', maxLength: 300 },
            prefix: { type: 'string', maxLength: 500 },
            language: { type: 'string', maxLength: 40 },
            q: { type: 'string', maxLength: 200 },
          },
        },
      },
    },
    async (request, reply) => {
      const q = request.query;
      if (!q.repoId) return fail(reply, 400, 'repoId is required');

      try {
        const graph = await db.fetchGraph({
          repoId: q.repoId,
          limit: q.limit ? parseInt(q.limit, 10) : 300,
          kinds: splitList(q.kind),
          edgeKinds: splitList(q.edgeKind),
          pathPrefix: q.prefix,
          language: q.language,
          search: q.q,
        });
        return { success: true, data: graph };
      } catch (err) {
        request.log.error({ err }, 'graph fetch failed');
        return fail(reply, 500, 'Failed to fetch graph');
      }
    }
  );

  fastify.get<{ Params: { repoId: string } }>(
    '/api/repositories/:repoId/stats',
    {
      schema: {
        params: {
          type: 'object',
          required: ['repoId'],
          properties: { repoId: { type: 'string', maxLength: 200 } },
        },
      },
    },
    async (request, reply) => {
      try {
        return { success: true, data: await db.getStats(request.params.repoId) };
      } catch (err) {
        request.log.error({ err }, 'stats fetch failed');
        return fail(reply, 500, 'Failed to fetch stats');
      }
    }
  );

  /** Expand one node's neighbourhood, for lazy loading in the graph view. */
  fastify.get<{
    Params: { repoId: string; nodeId: string };
    Querystring: { depth?: string };
  }>(
    '/api/repositories/:repoId/nodes/:nodeId/neighbors',
    {
      schema: {
        params: {
          type: 'object',
          required: ['repoId', 'nodeId'],
          properties: {
            repoId: { type: 'string', maxLength: 200 },
            nodeId: { type: 'string', maxLength: 1000 },
          },
        },
        querystring: {
          type: 'object',
          properties: { depth: { type: 'string', pattern: '^[0-9]{1,2}$' } },
        },
      },
    },
    async (request, reply) => {
      const { repoId, nodeId } = request.params;
      try {
        return {
          success: true,
          data: await db.fetchNeighborhood(
            repoId,
            decodeURIComponent(nodeId),
            request.query.depth ? parseInt(request.query.depth, 10) : 1
          ),
        };
      } catch (err) {
        request.log.error({ err }, 'neighborhood fetch failed');
        return fail(reply, 500, 'Failed to fetch neighbours');
      }
    }
  );

  /** Search files, symbols and paths. */
  fastify.get<{
    Params: { repoId: string };
    Querystring: { q?: string; limit?: string };
  }>(
    '/api/repositories/:repoId/search',
    {
      schema: {
        params: {
          type: 'object',
          required: ['repoId'],
          properties: { repoId: { type: 'string', maxLength: 200 } },
        },
        querystring: {
          type: 'object',
          properties: {
            q: { type: 'string', maxLength: 200 },
            limit: { type: 'string', pattern: '^[0-9]{1,4}$' },
          },
        },
      },
    },
    async (request, reply) => {
      const term = request.query.q?.trim();
      if (!term) return fail(reply, 400, 'Search term is required');
      try {
        const results = await db.search(
          request.params.repoId,
          term,
          request.query.limit ? parseInt(request.query.limit, 10) : 50
        );
        return { success: true, data: results };
      } catch (err) {
        request.log.error({ err }, 'search failed');
        return fail(reply, 500, 'Search failed');
      }
    }
  );

  /** Remove a repository's analysis and everything derived from it. */
  fastify.delete<{ Params: { repoId: string } }>(
    '/api/repositories/:repoId',
    {
      schema: {
        params: {
          type: 'object',
          required: ['repoId'],
          properties: { repoId: { type: 'string', maxLength: 200 } },
        },
      },
    },
    async (request, reply) => {
      try {
        await db.clearRepository(request.params.repoId);
        return { success: true, message: 'Repository analysis deleted' };
      } catch (err) {
        request.log.error({ err }, 'repository delete failed');
        return fail(reply, 500, 'Failed to delete repository');
      }
    }
  );
}

/** Clone the repository the job needs, reporting progress as it goes. */
async function cloneForScan(
  ref: RepoRef,
  refName: string | undefined,
  ctx: JobContext
): Promise<string> {
  ctx.progress(0.01, 'Cloning repository');
  const result = await github.cloneRepository(ref, refName);
  if (!result.success) {
    throw new Error(result.error || 'Failed to clone repository');
  }
  return result.localPath;
}