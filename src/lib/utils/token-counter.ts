import { countTokens as tokenizerCountTokens } from 'gpt-tokenizer';

type CountTokensImplementation = (text: string) => number;

let countTokensImplementation: CountTokensImplementation = (text) => tokenizerCountTokens(text);

export function countTokens(text: string): number {
  try {
    return countTokensImplementation(text);
  } catch (error) {
    console.warn('[token-counter] Falling back to character-based token estimate:', error);
    return Math.ceil(text.length / 4);
  }
}

export function setCountTokensImplementationForTests(
  implementation: CountTokensImplementation | null,
): void {
  countTokensImplementation = implementation ?? ((text) => tokenizerCountTokens(text));
}
