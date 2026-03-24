/// <reference types="bun-types" />

import { afterAll, beforeAll, beforeEach, expect, mock, test } from 'bun:test';
import fs from 'fs';
import path from 'path';
import { cleanupRuntimeConfigFixture, createRuntimeConfigFixture, type RuntimeConfigFixture } from './runtime-config-fixture';

const TESTS_DIR = path.dirname(new URL(import.meta.url).pathname);
const TEST_SERVER_DIR = path.join(TESTS_DIR, '.tmp');
const TEST_SERVER_SCRIPT = path.join(TEST_SERVER_DIR, 'openclaw-mini-mcp-mock-server.cjs');

let runtimeConfigFixture: RuntimeConfigFixture | null = null;

mock.module('ai', () => ({
  generateText: async () => ({ text: 'stub', steps: [] }),
  stepCountIs: () => () => true,
}));

function writeMockServerScript(): void {
  fs.writeFileSync(TEST_SERVER_SCRIPT, `
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const z = require('zod');

const server = new McpServer({ name: 'mock-mcp', version: '1.0.0' });

server.registerTool('echo_text', {
  description: 'Echo text back',
  inputSchema: { text: z.string() },
}, async ({ text }) => ({
  content: [{ type: 'text', text: 'echo:' + text }],
}));

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
`, 'utf-8');
}

beforeAll(async () => {
  process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? 'test-key';
  process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? 'test-key';
  process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ?? 'test-key';
  process.env.POE_API_KEY = process.env.POE_API_KEY ?? 'test-key';
  fs.mkdirSync(TEST_SERVER_DIR, { recursive: true });
  writeMockServerScript();
});

beforeEach(async () => {
  if (runtimeConfigFixture) {
    cleanupRuntimeConfigFixture(runtimeConfigFixture.dir);
  }

  runtimeConfigFixture = createRuntimeConfigFixture('openclaw-mini-mcp-integration-', {
    mcp: {
      servers: {
        mock: {
          command: process.execPath,
          args: [TEST_SERVER_SCRIPT],
          description: 'Mock MCP server',
        },
      },
    },
  });

  process.env.OPENCLAW_CONFIG_PATH = runtimeConfigFixture.configPath;

  const { initializeProviderRegistry, resetProviderRegistryForTests } = await import('../src/lib/services/provider-registry');
  resetProviderRegistryForTests();
  initializeProviderRegistry();
});

afterAll(() => {
  if (runtimeConfigFixture) {
    cleanupRuntimeConfigFixture(runtimeConfigFixture.dir);
    runtimeConfigFixture = null;
  }
  fs.rmSync(TEST_SERVER_SCRIPT, { force: true });
  fs.rmSync(TEST_SERVER_DIR, { recursive: true, force: true });
  delete process.env.OPENCLAW_CONFIG_PATH;
});

test('mcp_list discovers tools and mcp_call invokes one end-to-end', async () => {
  const { getTool } = await import('../src/lib/tools');
  const listTool = getTool('mcp_list');
  const callTool = getTool('mcp_call');

  if (!listTool?.execute || !callTool?.execute) {
    throw new Error('MCP tools are not registered');
  }

  const listResult = await listTool.execute({ server: 'mock' }, { toolCallId: 'list', messages: [] });
  if (!listResult.success) {
    throw new Error(listResult.error ?? 'mcp_list failed');
  }
  expect(listResult.success).toBe(true);
  expect(listResult.data).toMatchObject({
    server: 'mock',
    tools: ['echo_text: Echo text back (required: text)'],
  });

  const callResult = await callTool.execute(
    { server: 'mock', tool: 'echo_text', arguments: { text: 'hello' } },
    { toolCallId: 'call', messages: [] },
  );
  if (!callResult.success) {
    throw new Error(callResult.error ?? 'mcp_call failed');
  }

  expect(callResult.success).toBe(true);
  expect(callResult.data).toMatchObject({
    server: 'mock',
    tool: 'echo_text',
    result: {
      content: [{ type: 'text', text: 'echo:hello' }],
    },
  });
});
