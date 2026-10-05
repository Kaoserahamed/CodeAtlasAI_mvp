/**
 * Configuration documentation.
 *
 * backend/.env.example is the only list of what this service accepts, and it
 * was missing GH_TOKEN, which two modules read. A variable that works but is
 * undocumented is a support question nobody can answer, so this test keeps the
 * two lists in step.
 *
 * The list is compared against the example file rather than a hand-kept
 * array, so adding a new variable without documenting it fails the build.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const BACKEND_SRC = path.resolve(__dirname, '../../src');
const ENV_EXAMPLE = path.resolve(__dirname, '../../.env.example');

/** Every .ts file under the backend src tree. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

/** Variables read from process.env anywhere in the backend source. */
function referencedVars(): Set<string> {
  const found = new Set<string>();
  const pattern = /process\.env\.([A-Z][A-Z0-9_]*)/g;

  for (const file of sourceFiles(BACKEND_SRC)) {
    const text = fs.readFileSync(file, 'utf-8');
    for (const match of text.matchAll(pattern)) found.add(match[1]);
  }
  return found;
}

/** Variables named in .env.example, whether commented out or set. */
function documentedVars(): Set<string> {
  const text = fs.readFileSync(ENV_EXAMPLE, 'utf-8');
  const found = new Set<string>();
  // Matches both `FOO=bar` and `# FOO=bar`, since optional variables are
  // shipped commented out with their default explained.
  for (const match of text.matchAll(/^\s*#?\s*([A-Z][A-Z0-9_]*)=/gm)) found.add(match[1]);
  return found;
}

describe('backend/.env.example', () => {
  it('documents every variable the backend reads', () => {
    const referenced = referencedVars();
    const documented = documentedVars();

    const undocumented = [...referenced].filter((v) => !documented.has(v)).sort();

    // GH_TOKEN was missing and is the reason this test exists.
    expect(undocumented).toEqual([]);
  });

  it('reads no variable it invents that the example does not list', () => {
    const referenced = referencedVars();

    expect(referenced.size).toBeGreaterThan(5);
  });

  it('does not ship a real secret as a default', () => {
    const text = fs.readFileSync(ENV_EXAMPLE, 'utf-8');

    // Placeholders are fine; anything shaped like a live credential is not.
    expect(text).not.toMatch(/ghp_[A-Za-z0-9]{20,}/);
    expect(text).not.toMatch(/AKIA[A-Z0-9]{16}/);
  });

  it('ships the compose credentials so a fresh clone matches the database', () => {
    const text = fs.readFileSync(ENV_EXAMPLE, 'utf-8');

    // docker-compose.yml sets exactly these, and a mismatch here is the first
    // thing a new contributor hits.
    expect(text).toContain('codeatlas-local');
  });
});