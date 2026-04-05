import { agentExecutor } from '@/lib/services/agent-executor';
import { taskQueue } from '@/lib/services/task-queue';
import { triggerService } from '@/lib/services/trigger-service';
import { runRuntimeMaintenance, type RuntimeMaintenanceOptions } from '@/lib/runtime/maintenance';

export async function executeTask(taskId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const result = await agentExecutor.executeTask(taskId);
    return result.success ? { success: true } : { success: false, error: result.error };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function createTask(input: {
  agentId: string;
  type: 'heartbeat' | 'cron';
  priority: number;
  payload: Record<string, unknown>;
  source: string;
}): Promise<{ success: boolean; data?: { id: string }; error?: string }> {
  try {
    const task = await taskQueue.createTask(input);
    return { success: true, data: { id: task.id } };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export const executeTaskViaApi = executeTask;
export const createTaskViaApi = createTask;
export const fireTriggerViaApi = fireTrigger;
export const runSchedulerMaintenanceViaApi = runMaintenance;

export async function fireTrigger(input: {
  triggerId: string;
  referenceTime?: string;
}): Promise<{ success: boolean; data?: { trigger: unknown; task: unknown }; error?: string }> {
  try {
    const result = await triggerService.fireTimeBasedTrigger(input.triggerId, {
      mode: 'scheduled',
      referenceTime: input.referenceTime ? new Date(input.referenceTime) : undefined,
    });
    return { success: true, data: result };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function recordTriggerFire(input: {
  triggerId: string;
  lastTriggered: string;
  nextTrigger: string;
}): Promise<{ success: boolean; error?: string }> {
  const result = await fireTrigger({
    triggerId: input.triggerId,
    referenceTime: input.lastTriggered,
  });

  return result.success ? { success: true } : { success: false, error: result.error };
}

export async function runMaintenance(input?: RuntimeMaintenanceOptions): Promise<{
  success: boolean;
  data?: {
    deliveries?: {
      sent: number;
      failed: number;
    } | null;
    staleBusyAgents?: {
      inspected: number;
      recovered: number;
      errored: number;
    } | null;
    tasksCleaned?: number;
    historyArchivesDeleted?: number;
    memoryDecay?: {
      decayed: number;
      archived: number;
    } | null;
  };
  error?: string;
}> {
  try {
    const result = await runRuntimeMaintenance(input);
    return {
      success: true,
      data: {
        deliveries: result.deliveries,
        staleBusyAgents: result.staleBusyAgents,
        tasksCleaned: result.tasksCleaned,
        historyArchivesDeleted: result.historyArchivesDeleted,
        memoryDecay: result.memoryDecay,
      },
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
