/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { generateText } from 'ai';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const skipIntegration = !GEMINI_API_KEY;

const describeIntegration = skipIntegration ? describe.skip : describe;

describeIntegration('Gemini provider integration', () => {
  beforeEach(() => {
    process.env.GEMINI_API_KEY = GEMINI_API_KEY!;
  });

  afterEach(async () => {
    const { resetProviderRegistryForTests } = await import('../src/lib/services/provider-registry');
    resetProviderRegistryForTests();
  });

  test('creates language model and generates text with gemini-2.5-flash', async () => {
    const { createLanguageModel } = await import('../src/lib/services/provider-registry');

    const model = createLanguageModel(
      {
        id: 'gemini',
        apiType: 'gemini',
        apiKey: GEMINI_API_KEY!,
      },
      'gemini-2.5-flash',
    );

    const result = await generateText({
      model,
      prompt: 'Say "Hello from Gemini" and nothing else.',
      maxOutputTokens: 20,
    });

    expect(result.text.toLowerCase()).toContain('hello');
  });

  test('supports custom baseURL configuration', async () => {
    const { createLanguageModel } = await import('../src/lib/services/provider-registry');

    // Using default Google AI Studio endpoint explicitly
    const model = createLanguageModel(
      {
        id: 'gemini-custom',
        apiType: 'gemini',
        apiKey: GEMINI_API_KEY!,
        baseURL: 'https://generativelanguage.googleapis.com/v1beta',
      },
      'gemini-2.5-flash',
    );

    const result = await generateText({
      model,
      prompt: 'Respond with just the word "test".',
      maxOutputTokens: 10,
    });

    expect(result.text.toLowerCase()).toContain('test');
  });
});
