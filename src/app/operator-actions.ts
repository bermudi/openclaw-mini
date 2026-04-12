'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import {
  createOperatorAgentFromCommaList,
  createOperatorTrigger,
  deleteOperatorAgent,
  deleteOperatorTrigger,
  saveOperatorWorkspaceDocument,
  sendOperatorMessage,
  setOperatorDefaultAgent,
  toggleOperatorAgent,
  toggleOperatorTrigger,
} from '@/lib/operator-console';

type NoticeLevel = 'success' | 'error';

function toOptionalString(value: FormDataEntryValue | null): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function buildConsoleUrl(options: {
  notice: string;
  level: NoticeLevel;
  workspace?: string;
}): string {
  const params = new URLSearchParams({
    notice: options.notice,
    level: options.level,
  });

  if (options.workspace) {
    params.set('workspace', options.workspace);
  }

  return `/?${params.toString()}`;
}

function finishWithNotice(notice: string, level: NoticeLevel, workspace?: string): never {
  revalidatePath('/');
  redirect(buildConsoleUrl({ notice, level, workspace }));
}

export async function createAgentAction(formData: FormData): Promise<never> {
  try {
    const agent = await createOperatorAgentFromCommaList({
      name: String(formData.get('name') ?? ''),
      description: toOptionalString(formData.get('description')),
      skills: toOptionalString(formData.get('skills')),
    });

    return finishWithNotice(`Created agent ${agent.name}.`, 'success');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create agent';
    return finishWithNotice(message, 'error');
  }
}

export async function setDefaultAgentAction(formData: FormData): Promise<never> {
  try {
    const agentId = String(formData.get('agentId') ?? '');
    const agent = await setOperatorDefaultAgent(agentId);
    return finishWithNotice(`${agent.name} is now the default agent.`, 'success');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to set default agent';
    return finishWithNotice(message, 'error');
  }
}

export async function toggleAgentAction(formData: FormData): Promise<never> {
  try {
    const agentId = String(formData.get('agentId') ?? '');
    const agent = await toggleOperatorAgent(agentId);
    const verb = agent.status === 'disabled' ? 'Disabled' : 'Enabled';
    return finishWithNotice(`${verb} ${agent.name}.`, 'success');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update agent';
    return finishWithNotice(message, 'error');
  }
}

export async function deleteAgentAction(formData: FormData): Promise<never> {
  try {
    const agentId = String(formData.get('agentId') ?? '');
    await deleteOperatorAgent(agentId);
    return finishWithNotice('Deleted agent.', 'success');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete agent';
    return finishWithNotice(message, 'error');
  }
}

export async function sendMessageAction(formData: FormData): Promise<never> {
  try {
    const result = await sendOperatorMessage({
      agentId: String(formData.get('agentId') ?? ''),
      content: String(formData.get('content') ?? ''),
      channel: toOptionalString(formData.get('channel')) as undefined,
    });

    const taskNotice = result.taskId ? ` Queued task ${result.taskId}.` : '';
    return finishWithNotice(`Queued operator message.${taskNotice}`, 'success');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to send message';
    return finishWithNotice(message, 'error');
  }
}

export async function createTriggerAction(formData: FormData): Promise<never> {
  try {
    const trigger = await createOperatorTrigger({
      agentId: String(formData.get('agentId') ?? ''),
      name: String(formData.get('name') ?? ''),
      type: String(formData.get('type') ?? 'heartbeat') as 'heartbeat' | 'cron',
      schedule: String(formData.get('schedule') ?? ''),
    });

    return finishWithNotice(`Created ${trigger.type} trigger ${trigger.name}.`, 'success');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create trigger';
    return finishWithNotice(message, 'error');
  }
}

export async function toggleTriggerAction(formData: FormData): Promise<never> {
  try {
    const trigger = await toggleOperatorTrigger(String(formData.get('triggerId') ?? ''));
    const verb = trigger.enabled ? 'Enabled' : 'Disabled';
    return finishWithNotice(`${verb} trigger ${trigger.name}.`, 'success');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update trigger';
    return finishWithNotice(message, 'error');
  }
}

export async function deleteTriggerAction(formData: FormData): Promise<never> {
  try {
    await deleteOperatorTrigger(String(formData.get('triggerId') ?? ''));
    return finishWithNotice('Deleted trigger.', 'success');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete trigger';
    return finishWithNotice(message, 'error');
  }
}

export async function saveWorkspaceAction(formData: FormData): Promise<never> {
  const workspace = toOptionalString(formData.get('workspace'));

  try {
    const fileName = String(formData.get('fileName') ?? '');
    await saveOperatorWorkspaceDocument(fileName, String(formData.get('content') ?? ''));
    return finishWithNotice(`Saved ${fileName}.`, 'success', workspace ?? fileName);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to save workspace file';
    return finishWithNotice(message, 'error', workspace);
  }
}
