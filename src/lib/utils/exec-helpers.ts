// OpenClaw Agent Runtime - Exec Command Helpers
// Pure utility functions for exec_command tool; isolated for testability

const SHELL_OPERATORS = ['|', '&&', '||', ';', '>', '<', '`', '$(', '&'];

export type ParseCommandResult =
  | { binary: string; args: string[] }
  | { error: string };

/**
 * Parse a command string into binary name and arguments.
 * Rejects commands containing shell operators.
 */
export function parseCommand(command: string): ParseCommandResult {
  for (const op of SHELL_OPERATORS) {
    if (command.includes(op)) {
      return { error: `Shell operators are not supported (found: '${op}')` };
    }
  }

  const tokens: string[] = [];
  let current = '';
  let inQuote = false;
  let quoteChar = '';

  for (let i = 0; i < command.length; i++) {
    const char = command[i];

    if ((char === '"' || char === "'") && !inQuote) {
      inQuote = true;
      quoteChar = char;
    } else if (char === quoteChar && inQuote) {
      inQuote = false;
      quoteChar = '';
    } else if (char === ' ' && !inQuote) {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
    } else {
      current += char;
    }
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  if (tokens.length === 0) {
    return { error: 'Empty command' };
  }

  const binary = tokens[0];
  const args = tokens.slice(1);

  return { binary, args };
}

/**
 * Get the basename of a binary path (for allowlist matching).
 * Handles both simple names ('cat') and full paths ('/usr/bin/cat').
 */
export function getBinaryBasename(binary: string): string {
  const lastSlash = Math.max(binary.lastIndexOf('/'), binary.lastIndexOf('\\'));
  return lastSlash >= 0 ? binary.slice(lastSlash + 1) : binary;
}

/**
 * Truncate output from the beginning, keeping the tail.
 * Prepends a truncation notice if truncation occurred.
 */
export function truncateOutput(output: string, maxSize: number): string {
  if (maxSize <= 0 || output.length <= maxSize) {
    return output;
  }

  const tail = output.slice(-maxSize);
  return `[output truncated, showing last ${maxSize} characters]\n${tail}`;
}

/**
 * Truncate stdout and stderr proportionally so their combined length does not
 * exceed maxOutputSize. Returns the capped strings and whether truncation occurred.
 */
export function capCombinedOutput(
  stdout: string,
  stderr: string,
  maxOutputSize: number,
): { stdout: string; stderr: string; truncated: boolean } {
  const combinedLength = stdout.length + stderr.length;

  if (combinedLength <= maxOutputSize) {
    return { stdout, stderr, truncated: false };
  }

  if (combinedLength === 0) {
    return { stdout: '', stderr: '', truncated: false };
  }

  // Allocate budget proportionally
  const stdoutRatio = stdout.length / combinedLength;
  const stdoutBudget = Math.floor(maxOutputSize * stdoutRatio);
  const stderrBudget = maxOutputSize - stdoutBudget;

  return {
    stdout: truncateOutput(stdout, stdoutBudget),
    stderr: truncateOutput(stderr, stderrBudget),
    truncated: true,
  };
}
