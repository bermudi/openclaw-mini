// OpenClaw Agent Runtime - Sandbox Service
// Provides per-agent working directories for file operations and command execution

import * as fs from 'fs';
import * as path from 'path';

const DEFAULT_SANDBOX_ROOT = 'data/sandbox';
let _sandboxRootOverride: string | null = null;

/**
 * Get the sandbox root directory (data/sandbox/)
 */
export function getSandboxRoot(): string {
  const root = _sandboxRootOverride ?? DEFAULT_SANDBOX_ROOT;
  return path.isAbsolute(root) ? root : path.join(process.cwd(), root);
}

/**
 * Validate that a resolved path does not escape the sandbox root.
 * Throws an error if path traversal is detected.
 */
export function validateSandboxPath(resolvedPath: string, sandboxRoot: string): void {
  const normalizedResolved = path.normalize(resolvedPath);
  const normalizedRoot = path.normalize(sandboxRoot);
  
  if (!normalizedResolved.startsWith(normalizedRoot + path.sep) && normalizedResolved !== normalizedRoot) {
    throw new Error(`Path traversal detected: path escapes sandbox root`);
  }
}

/**
 * Get the sandbox directory for a specific agent, creating it if needed.
 * Returns the absolute path to data/sandbox/{agentId}/
 */
export function getSandboxDir(agentId: string): string {
  // Sanitize agentId to prevent path traversal
  const safeAgentId = agentId.replace(/[^a-zA-Z0-9_-]/g, '');
  if (safeAgentId !== agentId || safeAgentId.length === 0) {
    throw new Error(`Invalid agentId: contains unsafe characters`);
  }
  
  const sandboxRoot = getSandboxRoot();
  const sandboxDir = path.join(sandboxRoot, safeAgentId);
  
  // Validate path doesn't escape sandbox root
  validateSandboxPath(sandboxDir, sandboxRoot);

  // mkdirSync with recursive:true is idempotent — no existsSync check needed
  fs.mkdirSync(sandboxDir, { recursive: true });

  return sandboxDir;
}

/**
 * Get the downloads subdirectory within an agent's sandbox.
 * Returns the absolute path to data/sandbox/{agentId}/downloads/
 */
export function getSandboxDownloadsDir(agentId: string): string {
  const sandboxDir = getSandboxDir(agentId);
  const downloadsDir = path.join(sandboxDir, 'downloads');
  
  // Validate path doesn't escape sandbox root
  validateSandboxPath(downloadsDir, getSandboxRoot());

  fs.mkdirSync(downloadsDir, { recursive: true });

  return downloadsDir;
}

/**
 * Get the output subdirectory within an agent's sandbox.
 * Returns the absolute path to data/sandbox/{agentId}/output/
 */
export function getSandboxOutputDir(agentId: string): string {
  const sandboxDir = getSandboxDir(agentId);
  const outputDir = path.join(sandboxDir, 'output');
  
  // Validate path doesn't escape sandbox root
  validateSandboxPath(outputDir, getSandboxRoot());

  fs.mkdirSync(outputDir, { recursive: true });

  return outputDir;
}

/**
 * Resolve a relative path within an agent's sandbox.
 * Validates that the resolved path stays within the sandbox.
 * Returns the absolute path (does NOT create the path).
 */
export function resolveSandboxPath(agentId: string, relativePath: string): string {
  const sandboxDir = getSandboxDir(agentId);
  const resolvedPath = path.resolve(sandboxDir, relativePath);
  
  // Validate path doesn't escape sandbox root
  validateSandboxPath(resolvedPath, getSandboxRoot());
  
  return resolvedPath;
}

/**
 * Override the sandbox root for testing purposes.
 * Pass null to reset to default.
 */
export function setSandboxRootForTests(root: string | null): void {
  _sandboxRootOverride = root;
}
