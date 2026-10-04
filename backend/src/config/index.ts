/**
 * Configuration management for CodeAtlas backend
 */

import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

/**
 * Parse an origin allowlist from a comma-separated env var.
 * Returns `false` for same-origin only, which is the default.
 */
function parseOrigins(raw?: string): string[] | false {
  if (!raw) return false;
  const list = raw
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  return list.length > 0 ? list : false;
}

export const config = {
  // Server
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  /** Explicit allowlist; `false` means same-origin only. */
  corsOrigins: parseOrigins(process.env.CORS_ORIGINS),

  // Neo4j
  neo4j: {
    uri: process.env.NEO4J_URI || 'bolt://localhost:7687',
    user: process.env.NEO4J_USER || 'neo4j',
    password: process.env.NEO4J_PASSWORD || 'password',
  },

  // Repository ingestion
  /** Root under which cloned repositories may be written and deleted. */
  cloneRoot: process.env.CLONE_ROOT || path.join(process.cwd(), '.codeatlas-repos'),
  /** Keep clones after a scan (useful locally, costly on a server). */
  keepCloneAfterScan: process.env.KEEP_CLONE_AFTER_SCAN === 'true',
  /** Deletes clones older than this many hours. */
  cloneMaxAgeHours: parseInt(process.env.CLONE_MAX_AGE_HOURS || '1', 10),

  // Limits
  /** Hard ceiling on files parsed per scan. */
  maxFilesPerScan: parseInt(process.env.MAX_FILES_PER_SCAN || '20000', 10),
  /** Concurrent background analyses. */
  jobConcurrency: parseInt(process.env.JOB_CONCURRENCY || '2', 10),

  // Optional AI. The assistant degrades to lexical retrieval when unset.
  geminiApiKey: process.env.GEMINI_API_KEY || '',

  /**
   * Legacy: only JS/TS by default. Kept so the scanner and any tooling that
   * imports it still works; the parser registry is the source of truth for
   * what is actually supported.
   */
  supportedExtensions: ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'],
};

export default config;
