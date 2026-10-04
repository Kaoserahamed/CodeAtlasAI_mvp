/**
 * Repository URL validation.
 *
 * These cases are the security boundary for cloning: repository content is
 * untrusted, and the previous `includes('github.com')` check accepted URLs
 * that would have made the server clone arbitrary hosts, including internal
 * ones.
 */
import { describe, it, expect } from 'vitest';
import path from 'path';
import {
  InvalidRepoUrlError,
  parseRepoUrl,
  repoIdFor,
  resolveWithinRoot,
} from '../../src/services/repoUrlValidator';

const valid = (url: string) => {
  const ref = parseRepoUrl(url);
  return ref.cloneUrl;
};

describe('parseRepoUrl', () => {
  it('accepts canonical GitHub URLs', () => {
    expect(valid('https://github.com/facebook/react')).toBe(
      'https://github.com/facebook/react.git'
    );
  });

  it('accepts URLs without a scheme and with .git', () => {
    expect(valid('github.com/facebook/react.git')).toBe(
      'https://github.com/facebook/react.git'
    );
  });

  it('tolerates a trailing slash or www', () => {
    expect(valid('https://www.github.com/facebook/react/')).toBe(
      'https://github.com/facebook/react.git'
    );
  });

  it('rejects a non-GitHub host', () => {
    expect(() => parseRepoUrl('https://gitlab.com/a/b')).toThrow(InvalidRepoUrlError);
  });

  it('rejects a host that merely contains github.com', () => {
    // The bypass the old substring check allowed.
    expect(() => parseRepoUrl('https://evil.example/?next=github.com')).toThrow(
      InvalidRepoUrlError
    );
    expect(() => parseRepoUrl('https://github.com.evil.example/a/b')).toThrow(
      InvalidRepoUrlError
    );
    expect(() => parseRepoUrl('https://notgithub.com/a/b')).toThrow(
      InvalidRepoUrlError
    );
  });

  it('rejects plain http so tokens are never sent in clear', () => {
    expect(() => parseRepoUrl('http://github.com/a/b')).toThrow(
      InvalidRepoUrlError
    );
  });

  it('rejects embedded credentials', () => {
    expect(() => parseRepoUrl('https://user:pass@github.com/a/b')).toThrow(
      InvalidRepoUrlError
    );
  });

  it('rejects a URL with no repository name', () => {
    expect(() => parseRepoUrl('https://github.com/facebook')).toThrow(
      InvalidRepoUrlError
    );
  });

  it('rejects a deep link beyond the repository root', () => {
    // `/tree/main` (three segments) points at the repo root and is normalised.
    // `/tree/main/src` points inside the repo, so it is not a clone target.
    expect(valid('https://github.com/a/b/tree/main')).toBe(
      'https://github.com/a/b.git'
    );
    expect(() => parseRepoUrl('https://github.com/a/b/tree/main/src')).toThrow(
      InvalidRepoUrlError
    );
    expect(() => parseRepoUrl('https://github.com/a/b/pull/12/files')).toThrow(
      InvalidRepoUrlError
    );
  });

  it('rejects an unrecognised extra path segment', () => {
    expect(() => parseRepoUrl('https://github.com/a/b/wiki/Page')).toThrow(
      InvalidRepoUrlError
    );
  });

  it('rejects owner or repo names with shell metacharacters', () => {
    expect(() => parseRepoUrl('https://github.com/a$(whoami)/b')).toThrow(
      InvalidRepoUrlError
    );
    expect(() => parseRepoUrl('https://github.com/a/b;rm -rf /')).toThrow(
      InvalidRepoUrlError
    );
  });

  it('rejects an empty or malformed input', () => {
    expect(() => parseRepoUrl('')).toThrow(InvalidRepoUrlError);
    expect(() => parseRepoUrl('not a url')).toThrow(InvalidRepoUrlError);
  });

  it('produces a stable repoId from owner and name', () => {
    const ref = parseRepoUrl('https://github.com/Facebook/React');
    // Case-insensitive so a URL retyped differently reuses the same graph.
    expect(repoIdFor(ref)).toBe('facebook/react');
    expect(repoIdFor(ref)).toBe(repoIdFor(parseRepoUrl('https://github.com/facebook/react')));
  });
});

describe('resolveWithinRoot', () => {
  // Compared through path.resolve so the assertions hold on Windows too,
  // where '/srv/repos' resolves against the current drive.
  it('allows paths inside the root', () => {
    const root = path.resolve('/srv/repos');
    expect(resolveWithinRoot(root, 'owner_repo')).toBe(
      path.join(root, 'owner_repo')
    );
  });

  it('rejects traversal outside the root', () => {
    const root = path.resolve('/srv/repos');
    expect(() => resolveWithinRoot(root, '../../etc')).toThrow(
      InvalidRepoUrlError
    );
    expect(() => resolveWithinRoot(root, path.resolve('/etc/passwd'))).toThrow(
      InvalidRepoUrlError
    );
  });

  it('rejects a sibling directory sharing the root prefix', () => {
    const root = path.resolve('/srv/repos');
    const sibling = `${root}-evil`;
    expect(() => resolveWithinRoot(root, path.join('..', `${path.basename(sibling)}`, 'x'))).toThrow(
      InvalidRepoUrlError
    );
  });
});