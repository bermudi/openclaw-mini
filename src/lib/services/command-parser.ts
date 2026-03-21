// OpenClaw Agent Runtime - Command Parser
// Parse inline slash commands from message content

export type ParsedCommand =
  | { type: 'switch-provider'; providerName: string }
  | { type: 'switch-model'; modelName: string }
  | { type: 'list-providers' }
  | { type: 'invalid-command'; error: string }
  | { type: 'not-command' };

export function parseCommand(content: string): ParsedCommand {
  const trimmed = content.trim();

  if (trimmed === '/providers') {
    return { type: 'list-providers' };
  }

  if (trimmed === '/provider' || trimmed.startsWith('/provider ')) {
    const rest = trimmed.slice('/provider'.length).trim();
    if (!rest) {
      return { type: 'invalid-command', error: 'Usage: /provider <name>' };
    }
    const providerName = rest.split(/\s+/)[0]!;
    return { type: 'switch-provider', providerName };
  }

  if (trimmed === '/model' || trimmed.startsWith('/model ')) {
    const rest = trimmed.slice('/model'.length).trim();
    if (!rest) {
      return { type: 'invalid-command', error: 'Usage: /model <name>' };
    }
    const modelName = rest.split(/\s+/)[0]!;
    return { type: 'switch-model', modelName };
  }

  return { type: 'not-command' };
}
