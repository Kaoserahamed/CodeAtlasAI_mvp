/**
 * Codebase assistant.
 *
 * The most important behaviour tested here is degradation: with no API key the
 * assistant must still answer with real citations rather than failing, and
 * prompt text must be redacted before it could reach a provider.
 */
import { describe, it, expect } from 'vitest';
import { AssistantService } from '../../src/services/assistantService';
import { LlmClient } from '../../src/services/llmService';
import { CodeIndex, buildChunks } from '../../src/services/codeIndex';
import { JavaScriptParser } from '../../src/parser/languages/javascript';
import { SymbolResolver } from '../../src/resolver/symbolResolver';

const REPO = 'r1';
const js = new JavaScriptParser();

const SOURCES = new Map([
  [
    'src/auth/login.ts',
    `export function authenticateUser(credentials) {
  const user = findUser(credentials.email);
  if (!user) throw new Error('Unknown user');
  return verifyPassword(user, credentials.password);
}`,
  ],
  [
    'src/auth/session.ts',
    `import { authenticateUser } from './login';
export function createSession(credentials) {
  return authenticateUser(credentials);
}`,
  ],
  ['src/db/connect.ts', 'export function connectDatabase(url) { return url; }'],
]);

async function indexFor(sources: Map<string, string> = SOURCES) {
  const parsed = [];
  for (const [path, content] of sources) {
    parsed.push(await js.parse({ repoId: REPO, path, content }));
  }
  const graph = new SymbolResolver().resolve(parsed, REPO);
  const index = new CodeIndex();
  index.build(buildChunks(REPO, graph.nodes, sources));
  return { index, graph };
}

const noModel = () => new AssistantService(new LlmClient({ apiKey: '' }));

/** Records prompts so redaction can be asserted. */
class RecordingLlm extends LlmClient {
  prompts: string[] = [];
  constructor() {
    super({ apiKey: 'test-key' });
  }
  async complete(prompt: string): Promise<string> {
    this.prompts.push(prompt);
    return 'Authentication happens in authenticateUser [Source 1].';
  }
}

describe('LlmClient', () => {
  it('reports unavailable when no key is configured', () => {
    expect(new LlmClient({ apiKey: '' }).isAvailable()).toBe(false);
    expect(new LlmClient({ apiKey: 'k' }).isAvailable()).toBe(true);
  });

  it('throws rather than silently returning nothing when unavailable', async () => {
    await expect(new LlmClient({ apiKey: '' }).complete('hi')).rejects.toThrow();
  });
});

describe('AssistantService', () => {
  it('answers with citations and no model configured', async () => {
    const { index, graph } = await indexFor();
    const result = await noModel().ask(index, graph, {
      repoId: REPO,
      question: 'How does authenticateUser work?',
    });

    expect(result.mode).toBe('retrieval-only');
    expect(result.noMatch).toBe(false);
    // The evidence behind any answer is always attached.
    expect(result.citations.length).toBeGreaterThan(0);

    const citation = result.citations[0];
    expect(citation.path).toBe('src/auth/login.ts');
    expect(citation.startLine).toBeGreaterThan(0);
    expect(citation.endLine).toBeGreaterThanOrEqual(citation.startLine);
    expect(citation.matchedBecause.length).toBeGreaterThan(0);
  });

  it('locates the right file for an authentication question', async () => {
    const { index, graph } = await indexFor();
    const result = await noModel().ask(index, graph, {
      repoId: REPO,
      question: 'authenticateUser password verification',
    });

    expect(result.citations.some((c) => c.path === 'src/auth/login.ts')).toBe(true);
  });

  it('admits when nothing matched rather than inventing an answer', async () => {
    const { index, graph } = await indexFor();
    const result = await noModel().ask(index, graph, {
      repoId: REPO,
      question: 'quantum teleportation scheduler',
    });

    expect(result.noMatch).toBe(true);
    expect(result.citations).toHaveLength(0);
    expect(result.answer).toContain('No matching code');
  });

  it('surfaces related symbols from the graph', async () => {
    const { index, graph } = await indexFor();
    const result = await noModel().ask(index, graph, {
      repoId: REPO,
      question: 'What does authenticateUser do?',
    });

    expect(result.relatedSymbols.map((s) => s.name)).toContain('authenticateUser');
  });

  it('suggests follow-up questions and clamps the citation limit', async () => {
    const { index, graph } = await indexFor();
    const result = await noModel().ask(index, graph, {
      repoId: REPO,
      question: 'user',
      limit: 999,
    });

    expect(result.suggestions.length).toBeGreaterThan(0);
    expect(result.citations.length).toBeLessThanOrEqual(12);
  });

  it('redacts credentials from the prompt before it leaves the process', async () => {
    const secret = 'AKIA7XQ2M9PLK4NRD8VZ';
    const sources = new Map(SOURCES);
    sources.set('src/config.ts', `export function loadKey() { return "${secret}"; }`);

    const { index, graph } = await indexFor(sources);
    const llm = new RecordingLlm();

    await new AssistantService(llm).ask(index, graph, {
      repoId: REPO,
      question: `loadKey ${secret}`,
    });

    expect(llm.prompts.length).toBeGreaterThan(0);
    // The secret must not appear in anything sent to the provider.
    for (const prompt of llm.prompts) {
      expect(prompt).not.toContain(secret);
    }
  });

  it('uses the model when one is configured and instructs it to cite', async () => {
    const { index, graph } = await indexFor();
    const llm = new RecordingLlm();

    const result = await new AssistantService(llm).ask(index, graph, {
      repoId: REPO,
      question: 'How does authentication work?',
    });

    expect(result.mode).toBe('ai');
    expect(llm.prompts.length).toBe(1);
    expect(llm.prompts[0]).toContain('[Source N]');
    expect(llm.prompts[0]).toContain('say so plainly');
  });

  it('keeps the retrieved evidence when the model fails', async () => {
    const { index, graph } = await indexFor();
    const failing = new LlmClient({ apiKey: 'k' });
    failing.complete = async () => {
      throw new Error('provider unreachable');
    };

    const result = await new AssistantService(failing).ask(index, graph, {
      repoId: REPO,
      question: 'How does authentication work?',
    });

    expect(result.mode).toBe('retrieval-only');
    // Losing the model must not lose the citations.
    expect(result.citations.length).toBeGreaterThan(0);
    expect(result.answer).toContain('provider unreachable');
  });
});