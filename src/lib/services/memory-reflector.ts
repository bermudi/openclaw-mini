// OpenClaw Agent Runtime - Memory Reflector
// LLM-driven extraction of durable facts from compacted session content

import { generateText } from 'ai';
import { db } from '@/lib/db';
import { runWithModelFallback } from './model-provider';
import { memoryService, validateMemoryKey } from './memory-service';
import type { MemoryCategory } from '@/lib/types';

const INJECTION_PATTERNS = [
  'ignore previous instructions',
  'system prompt:',
  '<|system|>',
  '[inst]',
];

const EXTRACTED_CONFIDENCE_INITIAL = 0.7;
const EXTRACTED_CONFIDENCE_CEILING = 0.9;
const EXTRACTED_CONFIDENCE_BOOST = 0.1;

const EXTRACTION_SYSTEM_PROMPT = `Extract durable facts from the conversation summary below.
Return ONLY a JSON array (no markdown, no explanation) of objects with this exact shape:
[{"key": "user/name", "value": "Alice", "category": "extracted"}]

Rules:
- Only extract facts that are durable and reusable (preferences, decisions, names, important context)
- Skip small talk, ephemeral details, and one-time events
- Keys must use hierarchical paths: user/*, agent/*, system/*
- Values must be complete, self-contained sentences or facts
- Use category "extracted" for all entries
- If there are no durable facts, return an empty array: []`;

interface RawExtraction {
  key: string;
  value: string;
  category: string;
}

export function isInjectionAttempt(value: string): boolean {
  const lower = value.toLowerCase();
  for (const pattern of INJECTION_PATTERNS) {
    if (lower.includes(pattern)) {
      return true;
    }
  }
  return false;
}

export function isTooShort(value: string): boolean {
  return value.trim().length < 10;
}

export function isCleanExtraction(value: string): boolean {
  if (isInjectionAttempt(value)) return false;
  if (isTooShort(value)) return false;
  return true;
}

function normalizeForComparison(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, ' ');
}

export function contentSimilar(a: string, b: string): boolean {
  const na = normalizeForComparison(a);
  const nb = normalizeForComparison(b);
  if (na === nb) return true;
  const shorter = na.length <= nb.length ? na : nb;
  const longer = na.length <= nb.length ? nb : na;
  if (longer.includes(shorter) && shorter.length / longer.length >= 0.8) {
    return true;
  }
  return false;
}

function extractJsonFromResponse(text: string): unknown {
  const trimmed = text.trim();

  const codeBlock = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed);
  if (codeBlock) {
    return JSON.parse(codeBlock[1]!.trim());
  }

  const arrayMatch = /(\[[\s\S]*\])/.exec(trimmed);
  if (arrayMatch) {
    return JSON.parse(arrayMatch[1]!);
  }

  return JSON.parse(trimmed);
}

function validateExtraction(item: unknown): item is RawExtraction {
  if (typeof item !== 'object' || item === null) return false;
  const obj = item as Record<string, unknown>;
  return (
    typeof obj.key === 'string' &&
    typeof obj.value === 'string' &&
    typeof obj.category === 'string' &&
    obj.key.length > 0 &&
    obj.value.length > 0
  );
}

async function reinforceMemory(memoryId: string, currentConfidence: number): Promise<void> {
  const newConfidence = Math.min(currentConfidence + EXTRACTED_CONFIDENCE_BOOST, EXTRACTED_CONFIDENCE_CEILING);
  await db.memory.update({
    where: { id: memoryId },
    data: {
      confidence: newConfidence,
      lastReinforcedAt: new Date(),
    },
  });
}

export async function reflectOnContent(agentId: string, content: string): Promise<void> {
  let responseText: string;

  try {
    const result = await runWithModelFallback(({ model }) =>
      generateText({
        model,
        system: EXTRACTION_SYSTEM_PROMPT,
        prompt: content,
      }),
    );
    responseText = result.text.trim();
  } catch (error) {
    console.error('[MemoryReflector] LLM extraction call failed:', error);
    return;
  }

  let rawItems: unknown;
  try {
    rawItems = extractJsonFromResponse(responseText);
  } catch (error) {
    console.error('[MemoryReflector] Failed to parse LLM response as JSON:', error);
    return;
  }

  if (!Array.isArray(rawItems)) {
    console.error('[MemoryReflector] LLM response was not a JSON array');
    return;
  }

  for (const item of rawItems) {
    if (!validateExtraction(item)) {
      continue;
    }

    const { key, value, category } = item;

    if (!validateMemoryKey(key)) {
      continue;
    }

    if (!isCleanExtraction(value)) {
      continue;
    }

    const resolvedCategory = (category as MemoryCategory) ?? 'extracted';

    try {
      const existing = await db.memory.findUnique({
        where: { agentId_key: { agentId, key } },
      });

      if (existing) {
        if (contentSimilar(existing.value, value)) {
          await reinforceMemory(existing.id, existing.confidence);
        } else {
          await memoryService.setMemory({
            agentId,
            key,
            value,
            category: resolvedCategory,
            confidence: EXTRACTED_CONFIDENCE_INITIAL,
          });
        }
      } else {
        await memoryService.setMemory({
          agentId,
          key,
          value,
          category: resolvedCategory,
          confidence: EXTRACTED_CONFIDENCE_INITIAL,
        });
      }
    } catch (error) {
      console.error(`[MemoryReflector] Failed to upsert memory key "${key}":`, error);
    }
  }
}
