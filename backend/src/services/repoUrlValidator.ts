/**
 * URL validation for repository sources.
 *
 * Repository content is untrusted input. The previous check was
 * `repoUrl.includes('github.com')`, which passes for
 * `https://evil.example/?next=github.com` and would have let a caller make
 * the server clone an arbitrary host, including internal ones.
 *
 * Only exact, well-formed GitHub URLs over https are accepted, and the
 * owner/repo segments are restricted to characters GitHub actually permits.
 */
import { URL } from 'url';
import path from 'path';

export interface RepoRef {
  owner: string;
  repo: string;
  /** Normalised clone URL, always https and always .git suffixed. */
  cloneUrl: string;
  /** Canonical https://github.com/owner/repo form, for display. */
  webUrl: string;
}

const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO = /^[A-Za-z0-9._-]{1,100}$/;

export class InvalidRepoUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidRepoUrlError';
  }
}

/**
 * Parse and validate a GitHub repository reference.
 *
 * Accepts the shapes a user is likely to paste, but normalises them to a
 * single canonical https clone URL. Throws InvalidRepoUrlError otherwise.
 */
export function parseRepoUrl(input: string): RepoRef {
  if (typeof input !== 'string' || !input.trim()) {
    throw new InvalidRepoUrlError('Repository URL is required');
  }

  const raw = input.trim();

  // Prepend a scheme when the user omitted one.
  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new InvalidRepoUrlError('Repository URL is not a valid URL');
  }

  // Scheme must be https: cloning over plain http would expose credentials
  // and repository contents on the network.
  if (url.protocol !== 'https:') {
    throw new InvalidRepoUrlError('Repository URL must use https');
  }

  // Exact host match. A subdomain of github.com is not the same trust domain.
  const host = url.hostname.toLowerCase();
  if (host !== 'github.com' && host !== 'www.github.com') {
    throw new InvalidRepoUrlError('Only github.com repositories are supported');
  }

  // Strip credentials embedded in the URL; they must never be forwarded.
  if (url.username || url.password) {
    throw new InvalidRepoUrlError('Repository URL must not contain credentials');
  }

  const segments = url.pathname
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .split('/')
    .filter(Boolean);

  if (segments.length < 2) {
    throw new InvalidRepoUrlError(
      'Repository URL must include an owner and a repository name'
    );
  }

  // Extra segments are tolerated only for GitHub's browsing routes, each with
  // its own exact arity: `/tree/<branch>` and `/pull/<n>` are four segments,
  // `/releases` is three. Anything else points inside the repository rather
  // than at its root, so it is not a valid clone target.
  if (segments.length > 2) {
    const route = segments[2];
    const arity: Record<string, number> = {
      tree: 4,
      blob: 5,
      commit: 4,
      commits: 4,
      releases: 3,
      pull: 4,
      issues: 3,
    };
    if (arity[route] !== segments.length) {
      throw new InvalidRepoUrlError(
        'Repository URL must point at the repository root'
      );
    }
  }

  const owner = segments[0];
  const repo = segments[1].replace(/\.git$/i, '');

  if (!OWNER.test(owner)) {
    throw new InvalidRepoUrlError('Repository owner contains invalid characters');
  }
  if (!REPO.test(repo)) {
    throw new InvalidRepoUrlError('Repository name contains invalid characters');
  }

  return {
    owner,
    repo,
    cloneUrl: `https://github.com/${owner}/${repo}.git`,
    webUrl: `https://github.com/${owner}/${repo}`,
  };
}

/**
 * Stable identifier for a repository.
 *
 * Derived from owner/name rather than the URL string or the clone directory,
 * so rescanning the same repository reuses its graph instead of duplicating
 * it. Changing the repoId on every scan was why old analyses piled up.
 */
export function repoIdFor(ref: RepoRef): string {
  return `${ref.owner}/${ref.repo}`.toLowerCase();
}

/**
 * Guard against path traversal when a caller supplies a local path.
 * Returns the resolved absolute path, or throws if it escapes the root.
 */
export function resolveWithinRoot(root: string, requested: string): string {
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, requested);
  if (target !== resolvedRoot && !target.startsWith(resolvedRoot + path.sep)) {
    throw new InvalidRepoUrlError('Path escapes the allowed root directory');
  }
  return target;
}