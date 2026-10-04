/**
 * Command-line scanner.
 *
 * Usage:
 *   npm run scan -- /path/to/repo            incremental scan
 *   npm run scan -- /path/to/repo --force    re-parse everything
 *   npm run scan -- /path/to/repo --id owner/repo
 *
 * Runs through the same AnalysisService the API uses, so a CLI scan and an
 * API scan produce identical graphs.
 */
import path from 'path';
import { Neo4jClient } from '../database/neo4jClient';
import { AnalysisService } from '../services/analysisService';
import { ParserRegistry } from '../parser/registry';
import { isTreeSitterAvailable } from '../parser/languages/treeSitterLoader';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const target = args.find((a) => !a.startsWith('--'));
  const force = args.includes('--force');
  const idIndex = args.indexOf('--id');
  const repoId =
    idIndex >= 0 && args[idIndex + 1]
      ? args[idIndex + 1]
      : path.basename(target ?? '.').toLowerCase();

  if (!target) {
    console.error('Usage: npm run scan -- <path> [--force] [--id owner/repo]');
    process.exit(1);
  }

  const repoRoot = path.resolve(target);
  const db = new Neo4jClient();

  if (!(await db.testConnection())) {
    console.error('Cannot reach Neo4j. Check NEO4J_URI and credentials.');
    process.exit(1);
  }

  const registry = ParserRegistry.default();
  if (!(await isTreeSitterAvailable())) {
    console.warn(
      'Warning: tree-sitter WASM unavailable; only JavaScript/TypeScript will be parsed.'
    );
  }

  console.log(`Scanning ${repoRoot} as ${repoId}`);
  console.log(`Languages: ${registry.languages.join(', ')}\n`);

  const service = new AnalysisService({ db, registry });

  try {
    const result = await service.analyze(
      { repoId, repoRoot, force },
      {
        progress: (fraction, message) => {
          if (message) {
            process.stdout.write(
              `\r[${String(Math.round(fraction * 100)).padStart(3)}%] ${message.padEnd(50)}`
            );
          }
        },
        isCancelled: () => false,
        signal: new AbortController().signal,
      }
    );

    process.stdout.write('\n\n');
    console.log('Scan complete');
    console.log(`  files:         ${result.files}`);
    console.log(`  functions:     ${result.functions}`);
    console.log(`  classes:       ${result.classes}`);
    console.log(`  imports:       ${result.imports}`);
    console.log(
      `  calls:         ${result.calls} ` +
        `(${result.resolvedCalls ?? 0} resolved, ${result.inferredCalls ?? 0} inferred, ` +
        `${result.unknownCalls ?? 0} unresolved)`
    );
    console.log(`  changed files: ${result.changedFiles}`);
    console.log(`  parse errors:  ${result.parseErrors}`);
    console.log(`  duration:      ${(result.durationMs / 1000).toFixed(1)}s`);
  } catch (err) {
    console.error('\nScan failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  } finally {
    await db.close();
  }
}

void main();