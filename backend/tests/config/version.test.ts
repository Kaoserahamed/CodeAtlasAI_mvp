/**
 * Version consistency.
 *
 * /api/health reported "2.0.0" while every package manifest said "1.0.0".
 * Two versions of the same service is worse than either, because a bug report
 * quoting one of them is ambiguous.
 *
 * The version now lives in the config module, which is the only place the
 * server reads it from. This test asserts it still matches the manifests, so
 * a release cannot bump one and forget the others.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { config } from '../../src/config';

const ROOT = path.resolve(__dirname, '../../..');

const manifestVersion = (relative: string): string =>
  JSON.parse(fs.readFileSync(path.join(ROOT, relative), 'utf-8')).version as string;

describe('service version', () => {
  it('reports the same version as the root manifest', () => {
    expect(config.version).toBe(manifestVersion('package.json'));
  });

  it('reports the same version as the backend manifest', () => {
    expect(config.version).toBe(manifestVersion('backend/package.json'));
  });

  it('reports the same version as the frontend manifest', () => {
    // The two ship as one deployable, so they must not disagree.
    expect(config.version).toBe(manifestVersion('frontend/package.json'));
  });

  it('is a plain semver string', () => {
    expect(config.version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});