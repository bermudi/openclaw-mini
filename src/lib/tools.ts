// OpenClaw Agent Runtime - Tools/Skills System
// Defines available tools that agents can use

export interface Tool {
  name: string;
  description: string;
  parameters: ToolParameter[];
  execute: (params: Record<string, unknown>) => Promise<ToolResult>;
  riskLevel: 'low' | 'medium' | 'high';
}

export interface ToolParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description: string;
  required: boolean;
}

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

// ============================================
// Tool Registry
// ============================================
const tools: Map<string, Tool> = new Map();

export function registerTool(tool: Tool): void {
  tools.set(tool.name, tool);
}

export function getTool(name: string): Tool | undefined {
  return tools.get(name);
}

export function getAvailableTools(): Tool[] {
  return Array.from(tools.values());
}

export function getToolSchemas(): Array<{
  name: string;
  description: string;
  parameters: ToolParameter[];
}> {
  return getAvailableTools().map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }));
}

// ============================================
// Built-in Tools
// ============================================

// Get current date/time
registerTool({
  name: 'get_datetime',
  description: 'Get the current date and time',
  parameters: [],
  riskLevel: 'low',
  execute: async (): Promise<ToolResult> => {
    const now = new Date();
    return {
      success: true,
      data: {
        iso: now.toISOString(),
        unix: now.getTime(),
        formatted: now.toLocaleString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
    };
  },
});

// Calculate expression
registerTool({
  name: 'calculate',
  description: 'Evaluate a mathematical expression safely',
  parameters: [
    {
      name: 'expression',
      type: 'string',
      description: 'The mathematical expression to evaluate (e.g., "2 + 2 * 3")',
      required: true,
    },
  ],
  riskLevel: 'low',
  execute: async (params): Promise<ToolResult> => {
    const expression = params.expression as string;
    
    // Safe evaluation - only allow numbers and basic operators
    const safeExpression = expression.replace(/[^0-9+\-*/().%\s]/g, '');
    
    try {
      // Use Function constructor for safe evaluation
      const result = new Function(`return ${safeExpression}`)();
      
      if (typeof result !== 'number' || !isFinite(result)) {
        return { success: false, error: 'Invalid calculation result' };
      }
      
      return { success: true, data: { expression, result } };
    } catch {
      return { success: false, error: 'Failed to evaluate expression' };
    }
  },
});

// Read file from data directory
registerTool({
  name: 'read_file',
  description: 'Read a file from the agent memory directory',
  parameters: [
    {
      name: 'agentId',
      type: 'string',
      description: 'The agent ID',
      required: true,
    },
    {
      name: 'filename',
      type: 'string',
      description: 'The filename to read (without path)',
      required: true,
    },
  ],
  riskLevel: 'low',
  execute: async (params): Promise<ToolResult> => {
    const fs = await import('fs');
    const path = await import('path');
    
    const agentId = params.agentId as string;
    const filename = params.filename as string;
    
    // Sanitize filename to prevent path traversal
    const safeName = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '');
    
    const filePath = path.join(process.cwd(), 'data', 'memories', agentId, safeName);
    
    try {
      if (!fs.existsSync(filePath)) {
        return { success: false, error: 'File not found' };
      }
      
      const content = fs.readFileSync(filePath, 'utf-8');
      return { success: true, data: { filename: safeName, content } };
    } catch (error) {
      return { success: false, error: `Failed to read file: ${error}` };
    }
  },
});

// Write note to memory
registerTool({
  name: 'write_note',
  description: 'Write a note to the agent memory',
  parameters: [
    {
      name: 'agentId',
      type: 'string',
      description: 'The agent ID',
      required: true,
    },
    {
      name: 'title',
      type: 'string',
      description: 'The note title',
      required: true,
    },
    {
      name: 'content',
      type: 'string',
      description: 'The note content (markdown)',
      required: true,
    },
  ],
  riskLevel: 'low',
  execute: async (params): Promise<ToolResult> => {
    const fs = await import('fs');
    const path = await import('path');
    
    const agentId = params.agentId as string;
    const title = params.title as string;
    const content = params.content as string;
    
    // Sanitize title for filename
    const safeTitle = title.toLowerCase().replace(/[^a-z0-9]/g, '-').substring(0, 50);
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `note-${timestamp}-${safeTitle}.md`;
    
    const dir = path.join(process.cwd(), 'data', 'memories', agentId);
    
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      const filePath = path.join(dir, filename);
      const fullContent = `# ${title}\n\nCreated: ${new Date().toISOString()}\n\n${content}\n`;
      
      fs.writeFileSync(filePath, fullContent, 'utf-8');
      
      return { success: true, data: { filename, path: filePath } };
    } catch (error) {
      return { success: false, error: `Failed to write note: ${error}` };
    }
  },
});

// List files in memory
registerTool({
  name: 'list_files',
  description: 'List files in the agent memory directory',
  parameters: [
    {
      name: 'agentId',
      type: 'string',
      description: 'The agent ID',
      required: true,
    },
  ],
  riskLevel: 'low',
  execute: async (params): Promise<ToolResult> => {
    const fs = await import('fs');
    const path = await import('path');
    
    const agentId = params.agentId as string;
    const dir = path.join(process.cwd(), 'data', 'memories', agentId);
    
    try {
      if (!fs.existsSync(dir)) {
        return { success: true, data: { files: [] } };
      }
      
      const files = fs.readdirSync(dir).map((file) => {
        const stats = fs.statSync(path.join(dir, file));
        return {
          name: file,
          size: stats.size,
          modified: stats.mtime,
        };
      });
      
      return { success: true, data: { files } };
    } catch (error) {
      return { success: false, error: `Failed to list files: ${error}` };
    }
  },
});

// Web search using z-ai-web-dev-sdk
registerTool({
  name: 'web_search',
  description: 'Search the web for information',
  parameters: [
    {
      name: 'query',
      type: 'string',
      description: 'The search query',
      required: true,
    },
    {
      name: 'numResults',
      type: 'number',
      description: 'Number of results to return (default: 5)',
      required: false,
    },
  ],
  riskLevel: 'medium',
  execute: async (params): Promise<ToolResult> => {
    try {
      const ZAI = (await import('z-ai-web-dev-sdk')).default;
      const zai = await ZAI.create();
      
      const query = params.query as string;
      const num = (params.numResults as number) || 5;
      
      const results = await zai.functions.invoke('web_search', {
        query,
        num,
      });
      
      return { success: true, data: results };
    } catch (error) {
      return { success: false, error: `Web search failed: ${error}` };
    }
  },
});

// Wait/sleep
registerTool({
  name: 'wait',
  description: 'Wait for a specified number of seconds',
  parameters: [
    {
      name: 'seconds',
      type: 'number',
      description: 'Number of seconds to wait (max: 60)',
      required: true,
    },
  ],
  riskLevel: 'low',
  execute: async (params): Promise<ToolResult> => {
    const seconds = Math.min(Math.max(0, (params.seconds as number) || 0), 60);
    
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve({ success: true, data: { waited: seconds } });
      }, seconds * 1000);
    });
  },
});

// Generate random data
registerTool({
  name: 'random',
  description: 'Generate random data (number, UUID, string)',
  parameters: [
    {
      name: 'type',
      type: 'string',
      description: 'Type of random data: "number", "uuid", "string"',
      required: true,
    },
    {
      name: 'length',
      type: 'number',
      description: 'Length for string type (default: 16)',
      required: false,
    },
  ],
  riskLevel: 'low',
  execute: async (params): Promise<ToolResult> => {
    const type = params.type as string;
    const length = (params.length as number) || 16;
    
    switch (type) {
      case 'number':
        return { success: true, data: { value: Math.random() } };
      
      case 'uuid':
        const { v4: uuidv4 } = await import('uuid');
        return { success: true, data: { value: uuidv4() } };
      
      case 'string':
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let result = '';
        for (let i = 0; i < Math.min(length, 100); i++) {
          result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return { success: true, data: { value: result } };
      
      default:
        return { success: false, error: 'Invalid type. Use: number, uuid, or string' };
    }
  },
});

// Agent communication (A2A)
registerTool({
  name: 'send_message_to_agent',
  description: 'Send a message to another agent',
  parameters: [
    {
      name: 'fromAgentId',
      type: 'string',
      description: 'The sender agent ID',
      required: true,
    },
    {
      name: 'toAgentId',
      type: 'string',
      description: 'The recipient agent ID',
      required: true,
    },
    {
      name: 'message',
      type: 'string',
      description: 'The message to send',
      required: true,
    },
    {
      name: 'data',
      type: 'object',
      description: 'Optional data to include',
      required: false,
    },
  ],
  riskLevel: 'low',
  execute: async (params): Promise<ToolResult> => {
    const { fromAgentId, toAgentId, message, data } = params;
    
    try {
      const response = await fetch('http://localhost:3000/api/input', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: {
            type: 'a2a',
            fromAgentId,
            toAgentId,
            message,
            data,
          },
        }),
      });
      
      const result = await response.json();
      
      if (result.success) {
        return { success: true, data: { taskId: result.data.taskId } };
      } else {
        return { success: false, error: result.error };
      }
    } catch (error) {
      return { success: false, error: `Failed to send message: ${error}` };
    }
  },
});

// Log event
registerTool({
  name: 'log_event',
  description: 'Log an event to the agent history',
  parameters: [
    {
      name: 'agentId',
      type: 'string',
      description: 'The agent ID',
      required: true,
    },
    {
      name: 'event',
      type: 'string',
      description: 'The event description',
      required: true,
    },
    {
      name: 'category',
      type: 'string',
      description: 'Event category: info, warning, error',
      required: false,
    },
  ],
  riskLevel: 'low',
  execute: async (params): Promise<ToolResult> => {
    const agentId = params.agentId as string;
    const event = params.event as string;
    const category = (params.category as string) || 'info';
    
    try {
      const response = await fetch(`http://localhost:3000/api/agents/${agentId}/memory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: 'history',
          entry: `[${category.toUpperCase()}] ${event}`,
        }),
      });
      
      const result = await response.json();
      
      if (result.success) {
        return { success: true, data: { logged: true } };
      } else {
        return { success: false, error: result.error };
      }
    } catch (error) {
      return { success: false, error: `Failed to log event: ${error}` };
    }
  },
});

export { tools };
