import { Cron } from 'croner';
import type { TriggerConfig, TriggerType } from '@/lib/types';

export class TriggerValidationError extends Error {
  readonly status = 400;

  constructor(message: string) {
    super(message);
    this.name = 'TriggerValidationError';
  }
}

export class TriggerFireError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'TriggerFireError';
    this.status = status;
  }
}

export function calculateNextTimeTrigger(
  type: TriggerType,
  config: TriggerConfig,
  referenceTime: Date = new Date(),
): Date | undefined {
  switch (type) {
    case 'heartbeat':
      return calculateHeartbeatNextTrigger(config, referenceTime);
    case 'cron':
      return calculateCronNextTrigger(config, referenceTime);
    default:
      return undefined;
  }
}

export function validateCronExpression(expression: string): void {
  void calculateCronNextTrigger({ cronExpression: expression }, new Date());
}

function calculateHeartbeatNextTrigger(config: TriggerConfig, referenceTime: Date): Date {
  const intervalMinutes = config.interval ?? 30;
  return new Date(referenceTime.getTime() + intervalMinutes * 60_000);
}

function calculateCronNextTrigger(config: TriggerConfig, referenceTime: Date): Date {
  const expression = config.cronExpression?.trim();
  if (!expression) {
    throw new TriggerValidationError('Cron triggers require a cronExpression');
  }

  try {
    const schedule = new Cron(expression, { timezone: 'UTC', paused: true });
    const nextRun = schedule.nextRun(referenceTime);

    if (!nextRun) {
      throw new Error('Cron schedule returned no next run');
    }

    return nextRun;
  } catch {
    throw new TriggerValidationError(`Invalid cron expression: ${expression}`);
  }
}
