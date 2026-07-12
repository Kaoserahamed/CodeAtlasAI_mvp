/**
 * Repository Scanning Script
 * Run this script to scan a repository and store it in Neo4j
 * 
 * Usage: npm run scan -- /path/to/repo
 */

import { RepositoryScanner } from '../parser/repositoryScanner';
import { Neo4jClient } from '../database/neo4jClient';
import { config } from '../config';

async function main() {
  const repoPath = process.argv[2] || config.targetRepoPath;

  if (!repoPath) {
    console.error('Error: Please provide a repository path');
    console.error('Usage: npm run scan -- /path/to/repo');
    process.exit(1);
  }

  console.log('=================================');
  console.log('CodeAtlas Repository Scanner');
  console.log('=================================');
  console.log(`Target: ${repoPath}\n`);

  try {
    // Test database connection
    const db = new Neo4jClient();
    const connected = await db.testConnection();

    if (!connected) {
      console.error('Failed to connect to Neo4j. Please check your configuration.');
      process.exit(1);
    }

    // Scan repository
    console.log('Scanning repository...\n');
    const scanner = new RepositoryScanner();
    const graph = scanner.scanDirectory(repoPath);

    // Store in Neo4j
    console.log('\nStoring graph in Neo4j...');
    await db.storeGraph(graph);

    console.log('\n=================================');
    console.log('✓ Scan completed successfully!');
    console.log('=================================');
    console.log('You can now view the graph at: http://localhost:5173');
    console.log('Or access the API at: http://localhost:3001/api/graph');
    console.log('=================================\n');

    await db.close();
  } catch (error) {
    console.error('\n✗ Error during scan:', error);
    process.exit(1);
  }
}

main();
