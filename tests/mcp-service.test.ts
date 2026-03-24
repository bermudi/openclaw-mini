/// <reference types="bun-types" />

import { describe, expect, mock, test } from 'bun:test';
import type { Runtime, ServerToolInfo } from 'mcporter';
import type { McpServerConfig } from '../src/lib/config/schema';
import { McpService } from '../src/lib/services/mcp-service';

function createRuntimeStub(overrides: Partial<Runtime> = {}): Runtime {
  return {
    listServers: () => ['github'],
    getDefinitions: () => [],
    getDefinition: () => {
      throw new Error('not implemented');
    },
    registerDefinition: () => undefined,
    listTools: mock(async () => []),
    callTool: mock(async () => ({ ok: true })),
    listResources: mock(async () => ({})),
    connect: mock(async () => ({}) as Awaited<ReturnType<Runtime['connect']>>),
    close: mock(async () => undefined),
    ...overrides,
  };
}

function createService(options: {
  servers?: Record<string, McpServerConfig>;
  runtime?: Runtime;
}) {
  const runtime = options.runtime ?? createRuntimeStub();
  const createRuntimeMock = mock(async () => runtime);

  const service = new McpService({
    getServers: () => (options.servers ?? {
      github: {
        command: 'node',
        args: ['server.js'],
        description: 'GitHub API operations',
      },
    }),
    createRuntime: createRuntimeMock,
    rootDir: process.cwd(),
  });

  return { service, runtime, createRuntimeMock };
}

describe('McpService', () => {
  test('lists tools in compact format', async () => {
    const toolEntries: ServerToolInfo[] = [
      {
        name: 'create_issue',
        description: 'Create a new issue',
        inputSchema: {
          type: 'object',
          required: ['title', 'body'],
          properties: {
            title: { type: 'string' },
            body: { type: 'string' },
            labels: { type: 'array' },
          },
        },
      },
    ];
    const runtime = createRuntimeStub({
      listTools: mock(async () => toolEntries),
    });
    const { service } = createService({ runtime });

    const result = await service.listTools('github');

    expect(result).toEqual(['create_issue: Create a new issue (required: title, body)']);
    expect((runtime.connect as ReturnType<typeof mock>).mock.calls).toHaveLength(1);
    expect((runtime.close as ReturnType<typeof mock>).mock.calls).toHaveLength(1);
  });

  test('calls a tool successfully', async () => {
    const runtime = createRuntimeStub({
      callTool: mock(async (_server, _tool, options) => ({ echoed: options?.args })),
    });
    const { service } = createService({ runtime });

    const result = await service.callTool('github', 'create_issue', { title: 'Bug' });

    expect(result).toEqual({ echoed: { title: 'Bug' } });
    expect((runtime.callTool as ReturnType<typeof mock>).mock.calls[0]?.[2]).toEqual({
      args: { title: 'Bug' },
      timeoutMs: 30000,
    });
  });

  test('returns configured servers and descriptions', () => {
    const { service } = createService({
      servers: {
        github: { command: 'node', args: ['github.js'], description: 'GitHub API operations' },
        'brave-search': { url: 'http://localhost:3001/mcp', description: 'Web search via Brave' },
      },
    });

    expect(service.listServers()).toEqual([
      { name: 'brave-search', description: 'Web search via Brave' },
      { name: 'github', description: 'GitHub API operations' },
    ]);
  });

  test('throws clear error for unknown server', async () => {
    const { service } = createService({ servers: {} });

    await expect(service.listTools('missing')).rejects.toThrow("MCP server 'missing' is not configured");
  });

  test('rejects empty server names clearly', async () => {
    const { service } = createService({});

    await expect(service.listTools('   ')).rejects.toThrow('MCP server name cannot be empty');
  });

  test('surfaces invalid HTTP server URLs with server context', async () => {
    const { service } = createService({
      servers: {
        broken: { url: 'not-a-url' } as McpServerConfig,
      },
    });

    await expect(service.listTools('broken')).rejects.toThrow(
      "Invalid MCP server URL for 'broken': not-a-url",
    );
  });

  test('wraps connection failures with descriptive error', async () => {
    const runtime = createRuntimeStub({
      connect: mock(async () => {
        throw new Error('spawn ENOENT');
      }),
    });
    const { service } = createService({ runtime });

    await expect(service.listTools('github')).rejects.toThrow(
      "Failed to connect to MCP server 'github': spawn ENOENT",
    );
  });

  test('reports timeout errors and still cleans up', async () => {
    const runtime = createRuntimeStub({
      callTool: mock(async () => {
        throw new Error('Timeout');
      }),
    });
    const { service } = createService({ runtime });

    await expect(service.callTool('github', 'slow_tool', {})).rejects.toThrow(
      "MCP tool call 'slow_tool' on server 'github' timed out after 30s",
    );
    expect((runtime.close as ReturnType<typeof mock>).mock.calls).toHaveLength(1);
  });

  test('reports connect timeout after 30s', async () => {
    const runtime = createRuntimeStub({
      connect: mock(async () => {
        throw new Error('Timeout');
      }),
    });
    const { service } = createService({ runtime });

    await expect(service.listTools('github')).rejects.toThrow(
      "Connecting to MCP server 'github' timed out after 30s",
    );
  });

  test('logs cleanup failures instead of swallowing them silently', async () => {
    const runtime = createRuntimeStub({
      close: mock(async () => {
        throw new Error('close failed');
      }),
    });
    const { service } = createService({ runtime });
    const errorSpy = mock((..._args: unknown[]) => undefined);
    const originalError = console.error;
    console.error = errorSpy as typeof console.error;

    try {
      await service.listTools('github');
    } finally {
      console.error = originalError;
    }

    expect(errorSpy.mock.calls).toHaveLength(1);
    expect(String(errorSpy.mock.calls[0]?.[0])).toContain("[McpService] Failed to close MCP server 'github':");
  });

  test('builds MCP directory or returns empty string', () => {
    const { service } = createService({
      servers: {
        github: { command: 'node', args: ['github.js'], description: 'GitHub API operations' },
        local: { url: 'http://localhost:3001/mcp' },
      },
    });

    expect(service.buildMcpDirectory()).toBe([
      'Available MCP servers (use mcp_list to discover tools):',
      '- github - GitHub API operations',
      '- local',
    ].join('\n'));

    const emptyService = new McpService({
      getServers: () => ({}),
      createRuntime: mock(async () => createRuntimeStub()),
      rootDir: process.cwd(),
    });

    expect(emptyService.buildMcpDirectory()).toBe('');
  });
});
