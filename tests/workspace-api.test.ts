/// <reference types="bun-types" />

import { afterEach, beforeEach, expect, test } from 'bun:test';
import fs from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { NextRequest } from 'next/server';
import { GET, PUT } from '../src/app/api/workspace/route';

let workspaceDir = '';

beforeEach(() => {
  workspaceDir = fs.mkdtempSync(path.join(tmpdir(), 'openclaw-mini-workspace-api-'));
  process.env.OPENCLAW_WORKSPACE_DIR = workspaceDir;
  process.env.OPENCLAW_ALLOW_INSECURE_LOCAL = 'true';
});

afterEach(() => {
  delete process.env.OPENCLAW_WORKSPACE_DIR;
  delete process.env.OPENCLAW_ALLOW_INSECURE_LOCAL;
  if (workspaceDir) {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  }
});

test('GET /api/workspace lists markdown files in the workspace directory', async () => {
  const response = await GET(new NextRequest('http://localhost/api/workspace'));
  const body = await response.json();

  expect(response.status).toBe(200);
  expect(body.success).toBe(true);
  expect(Array.isArray(body.data)).toBe(true);
  expect(body.data).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ name: 'IDENTITY.md' }),
      expect.objectContaining({ name: 'SOUL.md' }),
      expect.objectContaining({ name: 'USER.md' }),
      expect.objectContaining({ name: 'AGENTS.md' }),
      expect.objectContaining({ name: 'TOOLS.md' }),
    ]),
  );
});

test('GET /api/workspace?file=SOUL.md reads a specific workspace file', async () => {
  const response = await GET(new NextRequest('http://localhost/api/workspace?file=SOUL.md'));
  const body = await response.json();

  expect(response.status).toBe(200);
  expect(body.success).toBe(true);
  expect(body.data.name).toBe('SOUL.md');
  expect(body.data.content).toContain('Persona & Tone');
});

test('PUT /api/workspace updates a workspace file and the new content is readable immediately', async () => {
  const updateResponse = await PUT(
    new NextRequest('http://localhost/api/workspace', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        file: 'SOUL.md',
        content: '# Persona & Tone\n\nYou are a pirate captain. Speak in pirate dialect.\n',
      }),
    }),
  );
  const updateBody = await updateResponse.json();

  expect(updateResponse.status).toBe(200);
  expect(updateBody.success).toBe(true);
  expect(updateBody.data.name).toBe('SOUL.md');

  const readResponse = await GET(new NextRequest('http://localhost/api/workspace?file=SOUL.md'));
  const readBody = await readResponse.json();

  expect(readResponse.status).toBe(200);
  expect(readBody.data.content).toContain('pirate captain');
});

test('workspace API rejects path traversal and non-markdown filenames', async () => {
  const invalidReadResponse = await GET(
    new NextRequest('http://localhost/api/workspace?file=../../etc/passwd'),
  );
  const invalidReadBody = await invalidReadResponse.json();

  expect(invalidReadResponse.status).toBe(400);
  expect(invalidReadBody.error).toBe('Invalid workspace filename');

  const invalidWriteResponse = await PUT(
    new NextRequest('http://localhost/api/workspace', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        file: 'secrets.txt',
        content: 'nope',
      }),
    }),
  );
  const invalidWriteBody = await invalidWriteResponse.json();

  expect(invalidWriteResponse.status).toBe(400);
  expect(invalidWriteBody.error).toBe('Invalid workspace filename');
});
