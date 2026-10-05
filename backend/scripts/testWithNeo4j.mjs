/**
 * Run the integration suite against the compose-managed Neo4j.
 *
 * The point is that the integration tests actually run. `npm test` skips them
 * so the suite stays runnable without a database; here the database is
 * started, waited for, and torn down, and TEST_NEO4J=true makes the suite
 * fail rather than silently pass if the database never came up.
 *
 * Credentials are written into the environment for the child process only,
 * so they never touch a .env file or the developer's shell.
 */
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

const NEO4J_USER = process.env.NEO4J_USER ?? 'neo4j';
const NEO4J_PASSWORD = process.env.NEO4J_PASSWORD ?? 'codeatlas-local';
const NEO4J_URI = process.env.NEO4J_URI ?? 'bolt://127.0.0.1:7687';
const BOLT_PORT = Number(new URL(NEO4J_URI.replace('bolt', 'http')).port || 7687);
const HEALTH_URL = `http://127.0.0.1:${BOLT_PORT === 7687 ? 7474 : BOLT_PORT}/`;
const BOOT_TIMEOUT_MS = 180_000;

function run(command, args, options = {}) {
  return spawn(command, args, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32', ...options });
}

function compose(...args) {
  return run('docker', ['compose', ...args]);
}

function exitCode(child) {
  return new Promise((resolve) => child.on('close', resolve));
}

/** Poll the HTTP endpoint until Neo4j answers or the timeout expires. */
async function waitForNeo4j() {
  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  let attempt = 0;

  while (Date.now() < deadline) {
    attempt += 1;
    try {
      const response = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(5000) });
      if (response.ok) {
        console.log(`Neo4j is up after ${attempt} attempt(s).`);
        return true;
      }
    } catch {
      // Not listening yet; keep polling until the deadline.
    }
    await delay(2000);
  }

  console.error(`Neo4j did not become reachable at ${HEALTH_URL} within ${BOOT_TIMEOUT_MS / 1000}s.`);
  return false;
}

async function main() {
  const up = compose('up', '-d', '--wait');
  if ((await exitCode(up)) !== 0) {
    console.error('Could not start Neo4j. Is Docker running?');
    process.exit(1);
  }

  let code = 1;
  try {
    if (!(await waitForNeo4j())) {
      console.error('Start the database manually to debug: docker compose logs neo4j');
      process.exit(1);
    }

    const tests = run('npx', ['vitest', 'run'], {
      cwd: new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
      env: {
        ...process.env,
        TEST_NEO4J: 'true',
        NEO4J_URI,
        NEO4J_USER,
        NEO4J_PASSWORD,
      },
    });
    code = await exitCode(tests);
  } finally {
    // Tear down even when the tests fail, so a failed run does not leave a
    // container holding port 7474.
    compose('down', '-v');
  }

  process.exit(code ?? 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});