/// <reference types="bun-types" />

import { afterEach, expect, test } from 'bun:test';
import {
  getRuntimeCorsAllowedOrigins,
  getRuntimeCorsHeaders,
  isRuntimeCorsOriginAllowed,
} from '../src/lib/runtime-cors';

const ORIGINAL_ALLOWED_ORIGINS = process.env.OPENCLAW_ALLOWED_ORIGINS;

afterEach(() => {
  if (ORIGINAL_ALLOWED_ORIGINS === undefined) {
    delete process.env.OPENCLAW_ALLOWED_ORIGINS;
    return;
  }

  process.env.OPENCLAW_ALLOWED_ORIGINS = ORIGINAL_ALLOWED_ORIGINS;
});

test('runtime CORS defaults allow local runtime and dashboard origins', () => {
  delete process.env.OPENCLAW_ALLOWED_ORIGINS;

  expect(getRuntimeCorsAllowedOrigins()).toEqual([
    'http://localhost:3000',
    'http://localhost:3001',
  ]);
  expect(isRuntimeCorsOriginAllowed('http://localhost:3001')).toBe(true);
  expect(isRuntimeCorsOriginAllowed('https://example.com')).toBe(false);
});

test('runtime CORS parses configured origins and ignores invalid entries', () => {
  process.env.OPENCLAW_ALLOWED_ORIGINS = 'https://dashboard.example.com, invalid, http://localhost:4321/';

  expect(getRuntimeCorsAllowedOrigins()).toEqual([
    'https://dashboard.example.com',
    'http://localhost:4321',
  ]);
});

test('runtime CORS only emits headers for allowed browser origins', () => {
  process.env.OPENCLAW_ALLOWED_ORIGINS = 'https://dashboard.example.com';

  expect(getRuntimeCorsHeaders('https://dashboard.example.com')).toEqual({
    'Access-Control-Allow-Origin': 'https://dashboard.example.com',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    Vary: 'Origin',
  });
  expect(getRuntimeCorsHeaders('https://not-allowed.example.com')).toEqual({});
  expect(getRuntimeCorsHeaders(null)).toEqual({});
});
