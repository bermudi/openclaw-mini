// OpenClaw Agent Runtime - Init Types
// Type definitions for startup validation

export interface CheckResult {
  success: boolean;
  error?: string;
  guidance?: string;
}

export type HardRequirement = 'config-file' | 'provider-keys' | 'database' | 'provider-configured' | 'agent' | 'exec-runtime' | 'internal-auth';

export type SoftRequirement = 'telegram-adapter' | 'whatsapp-adapter' | 'workspace-dir' | 'hook-triggers' | 'browser-tool' | 'memory-index' | 'exec-runtime' | 'internal-auth' | 'backplane-client';

export interface HardRequirementCheck {
  type: HardRequirement;
  check: () => Promise<CheckResult> | CheckResult;
}

export interface SoftRequirementCheck {
  type: SoftRequirement;
  check: () => Promise<CheckResult> | CheckResult;
}

export interface InitResult {
  success: boolean;
  hardFailures: Array<{ type: HardRequirement; error: string; guidance: string }>;
  softWarnings: Array<{ type: SoftRequirement; warning: string }>;
}
