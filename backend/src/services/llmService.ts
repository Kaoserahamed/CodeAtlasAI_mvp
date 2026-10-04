/**
 * Language model client.
 *
 * Wraps the Gemini API behind a small interface so the rest of the backend
 * does not depend on a particular provider, and so every code path can ask
 * `isAvailable()` and degrade cleanly when no key is configured.
 *
 * A missing key is not an error. The assistant answers from retrieved source
 * instead, which is more useful than failing.
 */
import { config } from '../config';

export interface LlmOptions {
  apiKey?: string;
  model?: string;
  /** Cap on generated tokens. */
  maxTokens?: number;
  temperature?: number;
}

export interface LlmMessage {
  role: 'user' | 'model';
  parts: { text: string }[];
}

export class LlmClient {
  private apiKey: string;
  private model: string;
  private maxTokens: number;
  private temperature: number;

  constructor(options: LlmOptions = {}) {
    this.apiKey = options.apiKey ?? config.geminiApiKey ?? '';
    // A small, inexpensive model: this is a summarisation task over code the
    // assistant has already retrieved, not open-ended reasoning.
    this.model = options.model ?? 'gemini-1.5-flash';
    this.maxTokens = options.maxTokens ?? 2048;
    this.temperature = options.temperature ?? 0.2;
  }

  isAvailable(): boolean {
    return this.apiKey.trim().length > 0;
  }

  /**
   * Generate a completion. Throws on provider failure so the caller can fall
   * back to retrieval rather than silently returning a partial answer.
   */
  async complete(prompt: string): Promise<string> {
    if (!this.isAvailable()) {
      throw new Error('No language model configured');
    }

    // Imported lazily so the dependency is only loaded when actually used.
    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    const client = new GoogleGenerativeAI(this.apiKey);

    const model = client.getGenerativeModel({
      model: this.model,
      generationConfig: {
        maxOutputTokens: this.maxTokens,
        // Low temperature: the task is to stay faithful to the source.
        temperature: this.temperature,
      },
      // Safety settings are intentionally left at their defaults.
    });

    const result = await model.generateContent(prompt);
    const text = result.response.text();

    if (!text || !text.trim()) {
      throw new Error('The language model returned an empty response');
    }

    return text.trim();
  }

  /** Model identifier, for display in the UI. */
  get modelName(): string {
    return this.model;
  }
}