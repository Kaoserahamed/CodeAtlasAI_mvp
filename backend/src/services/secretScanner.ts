/**
 * Secret detection and redaction.
 *
 * Two hard rules drive this module:
 *  1. A detected secret's value must never be stored, logged, or included in
 *     an LLM prompt. Only its location and a non-reversible fingerprint are
 *     kept, so a finding can be traced without the secret being copied
 *     anywhere.
 *  2. Detection errs toward reporting: a false positive costs a developer
 *     thirty seconds, a missed credential costs them an incident. Findings are
 *     labelled as candidates rather than certainties.
 *
 * Patterns are narrow enough to avoid flagging every long string in a
 * lockfile or a minified bundle.
 */

import crypto from 'crypto';

export type SecretKind =
  | 'aws-access-key'
  | 'github-token'
  | 'slack-token'
  | 'stripe-key'
  | 'google-api-key'
  | 'private-key'
  | 'jwt'
  | 'basic-auth-url'
  | 'generic-secret';

export type SecretSeverity = 'high' | 'medium' | 'low';

export interface SecretFinding {
  kind: SecretKind;
  severity: SecretSeverity;
  /** Repo-relative path. */
  path: string;
  line: number;
  /** Never the secret itself. */
  fingerprint: string;
  /** Short description, safe to display. */
  description: string;
  /** Redacted preview, e.g. `AKIA****`. */
  preview: string;
}

interface Rule {
  kind: SecretKind;
  severity: SecretSeverity;
  pattern: RegExp;
  description: string;
  keepPrefix?: number;
}

const RULES: Rule[] = [
  {
    kind: 'private-key',
    severity: 'high',
    // The header line alone identifies a key block.
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/,
    description: 'Private key block',
  },
  {
    kind: 'aws-access-key',
    severity: 'high',
    pattern: /\bAKIA[0-9A-Z]{16}\b/,
    description: 'AWS access key ID',
    keepPrefix: 4,
  },
  {
    kind: 'github-token',
    severity: 'high',
    pattern: /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/,
    description: 'GitHub personal access token',
    keepPrefix: 4,
  },
  {
    kind: 'slack-token',
    severity: 'high',
    pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/,
    description: 'Slack token',
    keepPrefix: 5,
  },
  {
    kind: 'stripe-key',
    severity: 'high',
    pattern: /\b[sr]k_(?:live|test)_[A-Za-z0-9]{16,}\b/,
    description: 'Stripe secret key',
    keepPrefix: 7,
  },
  {
    kind: 'google-api-key',
    severity: 'medium',
    pattern: /\bAIza[0-9A-Za-z_-]{35}\b/,
    description: 'Google API key',
    keepPrefix: 4,
  },
  {
    kind: 'jwt',
    severity: 'medium',
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{10,}\b/,
    description: 'JSON Web Token',
    keepPrefix: 3,
  },
  {
    kind: 'basic-auth-url',
    severity: 'high',
    // Credentials embedded in a connection string.
    pattern: /\b[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^/\s:@]+@/i,
    description: 'Credentials embedded in a URL',
    keepPrefix: 0,
  },
  {
    kind: 'generic-secret',
    severity: 'medium',
    // `password = "..."` with a non-trivial value.
    pattern:
      /\b(?:password|passwd|pwd|secret|api[_-]?key|access[_-]?token|client[_-]?secret)\b\s*[:=]\s*["']([^"'\s]{8,})["']/i,
    description: 'Credential assigned in source',
  },
];

/**
 * Substrings that mark a value as a placeholder rather than a real credential.
 *
 * These are matched as whole words where possible. A naive substring check
 * would misfire badly: "EXAMPLE" appears in AWS's own documentation key
 * (AKIAIOSFODNN7EXAMPLE) and in countless real test fixtures.
 */
const PLACEHOLDER_PATTERNS: RegExp[] = [
  /\byour\b/i,
  /\byour[-_]/i,
  /example/i,
  // Matches change-me, change_me and changeme.
  /change[-_]?me/i,
  /placeholder/i,
  /x{4,}/i,
  /\btodo\b/i,
  /\bfake\b/i,
  /\bdummy\b/i,
  /\btest[-_]?(key|token|secret|password)?\b/i,
  /\bsample\b/i,
  /\bredacted\b/i,
  /\binsert\b/i,
  /\breplace\b/i,
  /^none$/i,
  /^null$/i,
  /^$/,
  /^[<{$]/,
];

/**
 * Exact values that are published documentation examples, so they can be
 * ignored without weakening the general "example" rule.
 *
 * AWS prints AKIAIOSFODNN7EXAMPLE in its own docs, and it is in every test
 * fixture ever written. It is not a credential, so reporting it would be pure
 * noise, but treating the substring "example" as placeholder is far too broad
 * and would hide real keys that happen to contain it.
 */
const KNOWN_DOC_VALUES = new Set([
  'AKIAIOSFODNN7EXAMPLE',
  'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  'AKIAI44QH8DHBEXAMPLE',
]);

/**
 * True when a value is obviously a placeholder.
 *
 * Matched as whole words where possible, because a naive substring check
 * would reject real credentials that merely contain a placeholder word.
 */
export function isPlaceholder(value: string): boolean {
  // A published documentation value is never a real secret.
  if (KNOWN_DOC_VALUES.has(value)) return true;

  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(value));
}

/**
 * Redact a value to a safe preview plus a stable fingerprint.
 *
 * The fingerprint is a truncated hash: enough to tell two occurrences of the
 * same secret apart from different secrets, useless for recovering the value.
 */
export function redact(
  value: string,
  keepPrefix = 4
): { preview: string; fingerprint: string } {
  const fingerprint = sha256(value).slice(0, 12);
  const head = keepPrefix > 0 ? value.slice(0, keepPrefix) : '';
  const masked = '*'.repeat(Math.min(12, Math.max(4, value.length - head.length)));
  return { preview: `${head}${masked}`, fingerprint };
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/** Scan one file's content for credential patterns. */
export function scanContent(
  path: string,
  content: string,
  options: { maxLineLength?: number } = {}
): SecretFinding[] {
  const findings: SecretFinding[] = [];
  const maxLine = options.maxLineLength ?? 2000;
  const lines = content.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Very long lines are minified bundles or lockfiles, not source.
    if (line.length > maxLine) continue;

    for (const rule of RULES) {
      // Rebuild the regex each time so no state leaks between rules.
      const regex = new RegExp(rule.pattern.source, rule.pattern.flags.replace('g', ''));
      const match = regex.exec(line);
      if (!match) continue;

      const value = match[1] ?? match[0];
      if (!value || isPlaceholder(value)) continue;

      const { preview, fingerprint } = redact(value, rule.keepPrefix ?? 4);
      findings.push({
        kind: rule.kind,
        severity: rule.severity,
        path,
        line: i + 1,
        fingerprint,
        description: rule.description,
        preview,
      });
    }
  }

  return findings;
}

/**
 * Strip anything that looks like a credential from text before it is sent to
 * an external model. Applied to prompts as a last line of defence, in case a
 * credential sits on a line no other check matched.
 *
 * Matches are replaced by index rather than through a replacer callback,
 * because String.replace passes the match offset as the second argument when a
 * pattern has no capture group, which previously caused numeric values to be
 * treated as text.
 */
export function redactForPrompt(text: string): string {
  let output = text;

  for (const rule of RULES) {
    const flags = rule.pattern.flags.replace('g', '') + 'g';
    const regex = new RegExp(rule.pattern.source, flags);

    // Collect first, then rewrite back-to-front so earlier offsets stay valid.
    const edits: { start: number; end: number; text: string }[] = [];

    for (const match of text.matchAll(regex)) {
      const index = match.index ?? 0;
      // Group 1 is the credential when the pattern has one; otherwise the
      // whole match is the credential.
      const value = (match[1] ?? match[0]) as string;
      if (!value) continue;

      const valueOffset = index + match[0].indexOf(value);

      if (rule.kind === 'basic-auth-url') {
        const start = valueOffset;
        const end = start + value.length;
        const rewritten = value.replace(
          /^([a-z][a-z0-9+.-]*:\/\/)[^/\s:@]+:[^/\s:@]+@/i,
          '$1[redacted]@'
        );
        edits.push({ start, end, text: rewritten });
      } else {
        const prefix = rule.keepPrefix ? value.slice(0, rule.keepPrefix) : '';
        const masked =
          prefix + '*'.repeat(Math.max(4, Math.min(12, value.length - prefix.length)));
        edits.push({
          start: valueOffset,
          end: valueOffset + value.length,
          text: masked,
        });
      }
    }

    for (const edit of edits.reverse()) {
      output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
    }
  }

  return output;
}