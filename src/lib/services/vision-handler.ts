// OpenClaw Agent Runtime - Vision Handler
// Handles vision input processing for agent tasks

import * as fs from 'fs';
import type { Task, VisionInput, DeliveryTarget, ChannelType } from '@/lib/types';

export interface VisionHandlerContext {
  modelId: string;
  canDoVision: boolean;
  hasVisionInputs: boolean;
  hasTextContent: boolean;
  prompt: string;
}

export interface VisionHandlerResult {
  /** Multi-modal messages for vision-capable models */
  multiModalMessages?: Array<{
    role: 'user';
    content: Array<{ type: 'text'; text: string } | { type: 'image'; image: Uint8Array }>;
  }>;
  /** If true, skip LLM execution (error was already delivered) */
  skipLlm?: boolean;
  /** Warning message to include in response */
  warning?: string;
  /** Error response that was already delivered */
  errorResponse?: string;
}

/**
 * Handle vision inputs for a task.
 * 
 * This function processes vision inputs and returns:
 * - multiModalMessages: For vision-capable models, the multimodal message array
 * - skipLlm: If true, the caller should skip LLM execution (error was delivered)
 * - warning: A warning message to append to the response
 * - errorResponse: The error message if one was delivered
 */
export async function handleVisionInput(
  task: Task,
  visionInputs: VisionInput[] | undefined,
  context: VisionHandlerContext,
  deliveryTarget?: DeliveryTarget,
  enqueueDelivery?: (taskId: string, target: DeliveryTarget, message: string, key: string) => Promise<void>,
): Promise<VisionHandlerResult> {
  const { canDoVision, hasVisionInputs, hasTextContent, prompt } = context;

  // No vision inputs - nothing to handle
  if (!hasVisionInputs || !visionInputs || visionInputs.length === 0) {
    return {};
  }

  // Case 1: Vision inputs but model doesn't support vision and no text content
  if (!canDoVision && !hasTextContent) {
    const errorResponse = 'Your current model doesn\'t support vision. Send images as file attachments, or switch to a vision-capable model.';

    if (deliveryTarget && enqueueDelivery && task.type === 'message') {
      await enqueueDelivery(task.id, deliveryTarget, errorResponse, `task:${task.id}`);
    }

    return { skipLlm: true, errorResponse };
  }

  // Case 2: Vision inputs but model doesn't support vision, but has text content
  if (!canDoVision && hasTextContent) {
    const warning = '⚠️ Your current model doesn\'t support vision. I\'ll respond to your message but cannot see the images. Send images as file attachments, or switch to a vision-capable model.';
    return { warning };
  }

  // Case 3: Vision inputs with vision-capable model - build multimodal messages
  const contentParts: Array<{ type: 'text'; text: string } | { type: 'image'; image: Uint8Array }> = [
    { type: 'text', text: prompt },
  ];

  for (const visionInput of visionInputs) {
    try {
      const imageBuffer = fs.readFileSync(visionInput.localPath);
      contentParts.push({ type: 'image', image: imageBuffer });
    } catch {
      console.error(`[VisionHandler] Failed to read vision input file: ${visionInput.localPath}`);
    }
  }

  return {
    multiModalMessages: [{ role: 'user', content: contentParts }],
  };
}

/**
 * Build a fallback delivery target from message payload.
 */
export function buildFallbackDeliveryTarget(payload: {
  channel?: ChannelType;
  channelKey?: string;
}): DeliveryTarget | undefined {
  if (!payload.channel || !payload.channelKey) {
    return undefined;
  }

  return {
    channel: payload.channel,
    channelKey: payload.channelKey,
    metadata: {},
  };
}
