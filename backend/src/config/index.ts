/**
 * Configuration management for CodeAtlas backend
 */

import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config();

export const config = {
  // Server configuration
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  // Neo4j configuration
  neo4j: {
    uri: process.env.NEO4J_URI || 'bolt://localhost:7687',
    user: process.env.NEO4J_USER || 'neo4j',
    password: process.env.NEO4J_PASSWORD || 'password',
  },

  // Target repository for scanning
  targetRepoPath: process.env.TARGET_REPO_PATH || './sample-repo',

  // Supported file extensions
  supportedExtensions: ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'],
};

export default config;
