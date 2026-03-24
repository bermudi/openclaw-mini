import { callOnce, createRuntime, type Runtime, type ServerDefinition, type ServerToolInfo } from 'mcporter';
import type { McpServerConfig } from '@/lib/config/schema';
import { getMcpServers } from '@/lib/config/runtime';

const MCP_TOOL_TIMEOUT_MS = 30_000;

interface McpServiceDependencies {
  getServers: () => Record<string, McpServerConfig>;
  createRuntime: typeof createRuntime;
  callOnce: typeof callOnce;
  rootDir: string;
}

export interface McpServerSummary {
  name: string;
  description?: string;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function isTimeoutError(error: unknown): boolean {
  const message = getErrorMessage(error);
  return message === 'Timeout' || /timed out|timeout/i.test(message);
}

function isStdioServerConfig(config: McpServerConfig): config is Extract<McpServerConfig, { command: string }> {
  return 'command' in config;
}

function toServerDefinition(name: string, config: McpServerConfig, rootDir: string): ServerDefinition {
  if (isStdioServerConfig(config)) {
    return {
      name,
      description: config.description,
      env: config.env,
      command: {
        kind: 'stdio',
        command: config.command,
        args: config.args ?? [],
        cwd: rootDir,
      },
    };
  }

  return {
    name,
    description: config.description,
    command: {
      kind: 'http',
      url: new URL(config.url),
      headers: config.headers,
    },
  };
}

function getRequiredParameterNames(inputSchema: unknown): string[] {
  if (!inputSchema || typeof inputSchema !== 'object' || !('required' in inputSchema)) {
    return [];
  }

  const required = (inputSchema as { required?: unknown }).required;
  if (!Array.isArray(required)) {
    return [];
  }

  return required.filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
}

function formatToolSummary(tool: ServerToolInfo): string {
  const description = tool.description?.trim();
  const required = getRequiredParameterNames(tool.inputSchema);
  const summary = description ? `${tool.name}: ${description}` : tool.name;

  if (required.length === 0) {
    return summary;
  }

  return `${summary} (required: ${required.join(', ')})`;
}

function formatConnectionError(serverName: string, error: unknown): Error {
  return new Error(`Failed to connect to MCP server '${serverName}': ${getErrorMessage(error)}`);
}

export class McpService {
  constructor(private readonly overrides: Partial<McpServiceDependencies> = {}) {}

  listServers(): McpServerSummary[] {
    return Object.entries(this.resolveDependencies().getServers())
      .map(([name, config]) => ({
        name,
        description: config.description,
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async listTools(serverName: string): Promise<string[]> {
    return this.withRuntime(serverName, async (runtime) => {
      await this.connect(runtime, serverName);
      const tools = await runtime.listTools(serverName, { includeSchema: true });
      return tools.map(formatToolSummary);
    });
  }

  async callTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown> = {},
  ): Promise<unknown> {
    return this.withRuntime(serverName, async (runtime) => {
      await this.connect(runtime, serverName);

      try {
        return await runtime.callTool(serverName, toolName, {
          args,
          timeoutMs: MCP_TOOL_TIMEOUT_MS,
        });
      } catch (error) {
        if (isTimeoutError(error)) {
          throw new Error(`MCP tool call '${toolName}' on server '${serverName}' timed out after 30s`);
        }

        throw error instanceof Error ? error : new Error(getErrorMessage(error));
      }
    });
  }

  buildMcpDirectory(): string {
    const servers = this.listServers();

    if (servers.length === 0) {
      return '';
    }

    return [
      'Available MCP servers (use mcp_list to discover tools):',
      ...servers.map((server) => server.description ? `- ${server.name} - ${server.description}` : `- ${server.name}`),
    ].join('\n');
  }

  private resolveDependencies(): McpServiceDependencies {
    return {
      getServers: this.overrides.getServers ?? getMcpServers,
      createRuntime: this.overrides.createRuntime ?? createRuntime,
      callOnce: this.overrides.callOnce ?? callOnce,
      rootDir: this.overrides.rootDir ?? process.cwd(),
    };
  }

  private getServerDefinition(serverName: string): ServerDefinition {
    const normalized = serverName.trim();
    const serverConfig = this.resolveDependencies().getServers()[normalized];

    if (!serverConfig) {
      throw new Error(`MCP server '${normalized}' is not configured`);
    }

    return toServerDefinition(normalized, serverConfig, this.resolveDependencies().rootDir);
  }

  private async withRuntime<T>(serverName: string, operation: (runtime: Runtime) => Promise<T>): Promise<T> {
    const dependencies = this.resolveDependencies();
    const runtime = await dependencies.createRuntime({
      servers: [this.getServerDefinition(serverName)],
      rootDir: dependencies.rootDir,
    });

    try {
      return await operation(runtime);
    } finally {
      await runtime.close(serverName).catch(() => undefined);
    }
  }

  private async connect(runtime: Runtime, serverName: string): Promise<void> {
    try {
      await runtime.connect(serverName);
    } catch (error) {
      if (isTimeoutError(error)) {
        throw new Error(`Connecting to MCP server '${serverName}' timed out after 30s`);
      }

      throw formatConnectionError(serverName, error);
    }
  }
}

export const mcpService = new McpService();
