// OpenClaw Agent Runtime - Init Error Formatting
// Formatted error output for startup failures

import type { InitResult, HardRequirement, SoftRequirement } from './types';

const ERROR_PREFIX = '\n❌ OpenClaw startup failed!\n';
const WARNING_PREFIX = '\n⚠️  OpenClaw warnings:\n';
const DIVIDER = '─'.repeat(60);

function formatHardFailure(failure: { type: HardRequirement; error: string; guidance: string }): string {
  return [
    DIVIDER,
    `Requirement: ${failure.type}`,
    `Error: ${failure.error}`,
    '',
    `To fix: ${failure.guidance}`,
    DIVIDER,
  ].join('\n');
}

function formatSoftWarning(warning: { type: SoftRequirement; warning: string }): string {
  return `  • ${warning.type}: ${warning.warning}`;
}

export function formatInitError(result: InitResult): string {
  const parts: string[] = [];

  if (result.hardFailures.length > 0) {
    parts.push(ERROR_PREFIX);
    parts.push('The following hard requirements failed:\n');
    for (const failure of result.hardFailures) {
      parts.push(formatHardFailure(failure));
    }
    parts.push('\nFix the issues above and restart the server.');
  }

  if (result.softWarnings.length > 0) {
    parts.push(WARNING_PREFIX);
    for (const warning of result.softWarnings) {
      parts.push(formatSoftWarning(warning));
    }
  }

  return parts.join('\n');
}

export function printInitError(result: InitResult): void {
  console.error(formatInitError(result));
}

export function printInitSuccess(): void {
  console.log('\n✅ OpenClaw initialized successfully\n');
}
