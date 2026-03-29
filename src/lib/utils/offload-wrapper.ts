import type { Tool as CoreTool } from 'ai';
import { countTokens } from '@/lib/utils/token-counter';
import { writeOffloadFile } from '@/lib/services/workspace-service';

export interface OffloadContext {
  taskId: string;
  threshold: number;
}

function buildCompactReference(
  filePath: string,
  lineCount: number,
  preview: string,
  hasMore: boolean,
): string {
  const truncationLine = hasMore ? `\n[... ${lineCount - 10} more lines]` : '';
  return [
    `Tool result offloaded to workspace file.`,
    `Path: ${filePath}`,
    `Lines: ${lineCount}`,
    `Preview (first ${Math.min(10, lineCount)} lines):`,
    `${preview}${truncationLine}`,
    `Use read_workspace_file to retrieve the full content if needed.`,
  ].join('\n');
}

export function wrapWithOffloading(toolName: string, coreTool: CoreTool, context: OffloadContext): CoreTool {
  const execute = coreTool.execute;
  if (!execute) {
    return coreTool;
  }

  let callIndex = 0;

  return {
    ...coreTool,
    execute: async (input: unknown, options: unknown) => {
      const result = await execute(input, options as never);
      const currentCallIndex = callIndex++;

      const content = typeof result === 'string' ? result : JSON.stringify(result, null, 2);

      let tokenCount: number;
      try {
        tokenCount = countTokens(content);
      } catch {
        tokenCount = Math.ceil(content.length / 4);
      }

      if (tokenCount <= context.threshold) {
        return result;
      }

      const filePath = writeOffloadFile(context.taskId, toolName, currentCallIndex, content);
      const lines = content.split('\n');
      const preview = lines.slice(0, 10).join('\n');
      const hasMore = lines.length > 10;

      return buildCompactReference(filePath, lines.length, preview, hasMore);
    },
  };
}
