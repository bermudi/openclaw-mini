#!/usr/bin/env bun
// OpenClaw Mini - Interactive setup TUI
// Usage: bun run setup            (full guided setup)
//        bun run setup --doctor   (read-only doctor check)

import React, { useState, useEffect, useCallback } from 'react';
import { render, Box, Text, useInput, useApp, Newline } from 'ink';
import TextInput from 'ink-text-input';
import { discoverSetup } from '@/lib/setup/discovery';
import { getStartupDiagnostics } from '@/lib/setup/doctor';
import { persistSetupPlan } from '@/lib/setup/persist';
import { buildInitialPlan } from '@/lib/setup/plan';
import type {
  SetupDiscovery,
  SetupPlan,
  DiagnosticsResult,
  Screen,
  ProviderRawEntry,
} from '@/lib/setup/types';

// ---------------------------------------------------------------------------
// Shared UI primitives
// ---------------------------------------------------------------------------

interface SelectItem {
  label: string;
  value: string;
}

interface SelectMenuProps {
  items: SelectItem[];
  onSelect: (value: string) => void;
  isActive?: boolean;
  initialIndex?: number;
}

function SelectMenu({ items, onSelect, isActive = true, initialIndex = 0 }: SelectMenuProps) {
  const [index, setIndex] = useState(initialIndex);

  useInput(
    (input, key) => {
      if (key.upArrow) setIndex(i => Math.max(0, i - 1));
      if (key.downArrow) setIndex(i => Math.min(items.length - 1, i + 1));
      if (key.return) onSelect(items[index]?.value ?? '');
    },
    { isActive },
  );

  return (
    <Box flexDirection="column">
      {items.map((item, i) => (
        <Text key={item.value} color={i === index ? 'cyan' : undefined} bold={i === index}>
          {i === index ? '▸ ' : '  '}
          {item.label}
        </Text>
      ))}
    </Box>
  );
}

interface HeaderProps {
  title: string;
  subtitle?: string;
}

function Header({ title, subtitle }: HeaderProps) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold color="cyan">
        ═══ {title} ═══
      </Text>
      {subtitle && <Text dimColor>{subtitle}</Text>}
    </Box>
  );
}

function HelpText({ text }: { text: string }) {
  return (
    <Text dimColor>
      {'\n'}
      {text}
    </Text>
  );
}

function FieldRow({ label, value, active }: { label: string; value: string; active: boolean }) {
  return (
    <Box>
      <Text color={active ? 'cyan' : 'gray'}>{label}: </Text>
      <Text color={active ? 'white' : 'gray'}>{value || '(empty)'}</Text>
    </Box>
  );
}

function DiagRow({
  type,
  message,
  kind,
}: {
  type: string;
  message: string;
  kind: 'pass' | 'fail' | 'warn';
}) {
  const icon = kind === 'pass' ? '✓' : kind === 'fail' ? '✗' : '⚠';
  const color = kind === 'pass' ? 'green' : kind === 'fail' ? 'red' : 'yellow';
  return (
    <Box gap={1}>
      <Text color={color} bold>
        {icon}
      </Text>
      <Text bold>{type}:</Text>
      <Text>{message}</Text>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Welcome screen
// ---------------------------------------------------------------------------

interface WelcomeScreenProps {
  discovery: SetupDiscovery;
  doctorMode: boolean;
  onSetup: () => void;
  onDoctor: () => void;
  onQuit: () => void;
}

function WelcomeScreen({ discovery, doctorMode, onSetup, onDoctor, onQuit }: WelcomeScreenProps) {
  const items = [
    { label: 'Guided setup (create / update configuration)', value: 'setup' },
    { label: 'Doctor check (read-only diagnostics)', value: 'doctor' },
    { label: 'Quit', value: 'quit' },
  ];

  function handleSelect(value: string) {
    if (value === 'setup') onSetup();
    else if (value === 'doctor') onDoctor();
    else onQuit();
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Header
        title="OpenClaw Mini Setup"
        subtitle="Configure your OpenClaw Mini installation"
      />
      <Box flexDirection="column" marginBottom={1}>
        <Text>
          Config: <Text color="cyan">{discovery.configPath}</Text>
          {discovery.configExists ? (
            <Text color="green"> (exists)</Text>
          ) : (
            <Text color="yellow"> (not found)</Text>
          )}
        </Text>
        <Text>
          Workspace: <Text color="cyan">{discovery.workspaceDir}</Text>
          {discovery.workspaceExists ? (
            <Text color="green"> ({discovery.workspaceFiles.length} files)</Text>
          ) : (
            <Text color="yellow"> (empty)</Text>
          )}
        </Text>
        <Text>
          Env file: <Text color="cyan">{discovery.envFilePath}</Text>
        </Text>
      </Box>
      {doctorMode ? (
        <Text color="yellow">Running in doctor mode (--doctor flag detected)…</Text>
      ) : (
        <SelectMenu items={items} onSelect={handleSelect} />
      )}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Database screen
// ---------------------------------------------------------------------------

interface DatabaseScreenProps {
  value: string;
  onChange: (v: string) => void;
  onNext: () => void;
  onBack: () => void;
}

function DatabaseScreen({ value, onChange, onNext, onBack }: DatabaseScreenProps) {
  useInput((input, key) => {
    if (key.escape) onBack();
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Header title="Database" subtitle="SQLite database path (required)" />
      <Text>DATABASE_URL:</Text>
      <TextInput
        value={value}
        onChange={onChange}
        placeholder="file:./db/local.db"
        onSubmit={v => {
          if (v.trim()) onNext();
        }}
      />
      <HelpText text="Format: file:./relative/path.db  •  Enter to continue  •  Esc to go back" />
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Provider list screen
// ---------------------------------------------------------------------------

interface ProviderListScreenProps {
  providers: ProviderRawEntry[];
  onAdd: () => void;
  onRemove: (id: string) => void;
  onNext: () => void;
  onBack: () => void;
}

function ProviderListScreen({
  providers,
  onAdd,
  onRemove,
  onNext,
  onBack,
}: ProviderListScreenProps) {
  // Start selection on "Continue" (last item) when providers exist, to avoid
  // accidental removal of newly added provider on Enter key.
  const initialIndex = providers.length > 0 ? providers.length + 1 : 0;

  const items: SelectItem[] = [
    ...providers.map(p => ({
      label: `${p.id}  (${p.apiType})  key: ${p.apiKey.startsWith('${') ? p.apiKey : '***'}`,
      value: `remove:${p.id}`,
    })),
    { label: '+ Add provider', value: 'add' },
    providers.length > 0
      ? { label: '→ Continue', value: 'next' }
      : { label: '← Back', value: 'back' },
  ];

  function handleSelect(value: string) {
    if (value === 'add') onAdd();
    else if (value === 'next') onNext();
    else if (value === 'back') onBack();
    else if (value.startsWith('remove:')) onRemove(value.slice(7));
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Header title="Providers" subtitle="AI provider credentials" />
      {providers.length === 0 && (
        <Text color="yellow">No providers configured. Add at least one to continue.</Text>
      )}
      <SelectMenu items={items} onSelect={handleSelect} initialIndex={initialIndex} />
      <HelpText text="Select a provider to remove it, or add a new one" />
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Provider add screen (sequential fields)
// ---------------------------------------------------------------------------

interface ProviderAddScreenProps {
  onAdd: (p: ProviderRawEntry) => void;
  onBack: () => void;
}

const API_TYPES = ['openai-chat', 'openai-responses', 'anthropic', 'gemini', 'poe'];

function ProviderAddScreen({ onAdd, onBack }: ProviderAddScreenProps) {
  const [step, setStep] = useState<'id' | 'type' | 'baseurl' | 'key'>('id');
  const [id, setId] = useState('');
  const [apiType, setApiType] = useState('openai-chat');
  const [baseURL, setBaseURL] = useState('');
  const [apiKey, setApiKey] = useState('');

  const typeItems: SelectItem[] = API_TYPES.map(t => ({ label: t, value: t }));

  useInput((input, key) => {
    if (key.escape) onBack();
  });

  function handleIdSubmit(v: string) {
    if (v.trim()) setStep('type');
  }

  function handleTypeSelect(value: string) {
    setApiType(value);
    setStep('baseurl');
  }

  function handleBaseURLSubmit() {
    setStep('key');
  }

  function handleKeySubmit(v: string) {
    if (v.trim()) {
      onAdd({ id: id.trim(), apiType, baseURL: baseURL.trim() || undefined, apiKey: v.trim() });
    }
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Header title="Add Provider" subtitle="Configure a new AI provider" />

      {step === 'id' && (
        <Box flexDirection="column">
          <Text>Provider ID (e.g. openai, anthropic, openrouter):</Text>
          <TextInput value={id} onChange={setId} onSubmit={handleIdSubmit} />
          <HelpText text="Enter a short unique identifier for this provider  •  Esc to cancel" />
        </Box>
      )}

      {step === 'type' && (
        <Box flexDirection="column">
          <Text>
            Provider: <Text color="cyan">{id}</Text>
          </Text>
          <Text>API type:</Text>
          <SelectMenu items={typeItems} onSelect={handleTypeSelect} />
          <HelpText text="Select the API protocol  •  Esc to cancel" />
        </Box>
      )}

      {step === 'baseurl' && (
        <Box flexDirection="column">
          <Text>
            Provider: <Text color="cyan">{id}</Text> / type: <Text color="cyan">{apiType}</Text>
          </Text>
          <Text>Base URL (optional, leave blank for default):</Text>
          <TextInput
            value={baseURL}
            onChange={setBaseURL}
            placeholder="https://openrouter.ai/api/v1"
            onSubmit={handleBaseURLSubmit}
          />
          <HelpText text="Press Enter to skip  •  Esc to cancel" />
        </Box>
      )}

      {step === 'key' && (
        <Box flexDirection="column">
          <Text>
            Provider: <Text color="cyan">{id}</Text>
          </Text>
          <Text>
            API key (use <Text color="yellow">${'{OPENAI_API_KEY}'}</Text> to reference an env var):
          </Text>
          <TextInput value={apiKey} onChange={setApiKey} mask="*" onSubmit={handleKeySubmit} />
          <HelpText text='E.g.  ${OPENAI_API_KEY}  or paste the raw key  •  Esc to cancel' />
        </Box>
      )}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Agent model screen
// ---------------------------------------------------------------------------

interface AgentModelScreenProps {
  providers: ProviderRawEntry[];
  provider: string;
  model: string;
  fallbackProvider: string;
  fallbackModel: string;
  onChange: (field: string, value: string) => void;
  onNext: () => void;
  onBack: () => void;
}

function AgentModelScreen({
  providers,
  provider,
  model,
  fallbackProvider,
  fallbackModel,
  onChange,
  onNext,
  onBack,
}: AgentModelScreenProps) {
  const [step, setStep] = useState<'provider' | 'model' | 'fallback-provider' | 'fallback-model'>(
    'provider',
  );

  const providerItems: SelectItem[] = providers.map(p => ({ label: p.id, value: p.id }));
  const fallbackItems: SelectItem[] = [
    { label: '(none)', value: '' },
    ...providers.filter(p => p.id !== provider).map(p => ({ label: p.id, value: p.id })),
  ];

  useInput((input, key) => {
    if (key.escape) onBack();
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Header title="Default Agent" subtitle="Primary model for the default agent" />

      {step === 'provider' && (
        <Box flexDirection="column">
          <Text>Select default provider:</Text>
          <SelectMenu
            items={providerItems}
            onSelect={v => {
              onChange('agentProvider', v);
              setStep('model');
            }}
          />
          <HelpText text="The provider used for the default agent  •  Esc to go back" />
        </Box>
      )}

      {step === 'model' && (
        <Box flexDirection="column">
          <Text>
            Provider: <Text color="cyan">{provider}</Text>
          </Text>
          <Text>Model name:</Text>
          <TextInput
            value={model}
            onChange={v => onChange('agentModel', v)}
            placeholder="gpt-4.1-mini"
            onSubmit={v => {
              if (v.trim()) setStep('fallback-provider');
            }}
          />
          <HelpText text="E.g. gpt-4.1-mini, claude-opus-4-5, gemini-2.5-pro  •  Esc to go back" />
        </Box>
      )}

      {step === 'fallback-provider' && (
        <Box flexDirection="column">
          <FieldRow label="Provider" value={provider} active={false} />
          <FieldRow label="Model" value={model} active={false} />
          <Text>Fallback provider (optional):</Text>
          <SelectMenu
            items={fallbackItems}
            onSelect={v => {
              onChange('agentFallbackProvider', v);
              if (!v) {
                onChange('agentFallbackModel', '');
                onNext();
              } else {
                setStep('fallback-model');
              }
            }}
          />
          <HelpText text="Used if primary provider fails  •  Esc to go back" />
        </Box>
      )}

      {step === 'fallback-model' && (
        <Box flexDirection="column">
          <FieldRow label="Provider" value={provider} active={false} />
          <FieldRow label="Model" value={model} active={false} />
          <FieldRow label="Fallback provider" value={fallbackProvider} active={false} />
          <Text>Fallback model name:</Text>
          <TextInput
            value={fallbackModel}
            onChange={v => onChange('agentFallbackModel', v)}
            placeholder="gpt-4.1-mini"
            onSubmit={v => {
              onChange('agentFallbackModel', v);
              onNext();
            }}
          />
          <HelpText text="Model to use on the fallback provider  •  Esc to go back" />
        </Box>
      )}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Auth screen
// ---------------------------------------------------------------------------

interface AuthScreenProps {
  apiKey: string;
  insecureLocal: boolean;
  onChange: (field: string, value: string | boolean) => void;
  onNext: () => void;
  onBack: () => void;
}

function AuthScreen({ apiKey, insecureLocal, onChange, onNext, onBack }: AuthScreenProps) {
  const [step, setStep] = useState<'mode' | 'key'>('mode');

  const modeItems: SelectItem[] = [
    { label: 'Set OPENCLAW_API_KEY (recommended)', value: 'key' },
    { label: 'Allow insecure local (local testing only)', value: 'insecure' },
  ];

  useInput((input, key) => {
    if (key.escape) onBack();
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Header title="Internal Auth" subtitle="Admin API bearer token configuration" />

      {step === 'mode' && (
        <Box flexDirection="column">
          <Text>Auth mode:</Text>
          <SelectMenu
            items={modeItems}
            onSelect={value => {
              if (value === 'insecure') {
                onChange('insecureLocal', true);
                onChange('openclawApiKey', '');
                onNext();
              } else {
                onChange('insecureLocal', false);
                setStep('key');
              }
            }}
          />
          <HelpText text="Protects admin APIs and service-to-service calls  •  Esc to go back" />
        </Box>
      )}

      {step === 'key' && (
        <Box flexDirection="column">
          <Text>
            OPENCLAW_API_KEY <Text dimColor>(min 16 chars recommended)</Text>:
          </Text>
          <TextInput
            value={apiKey}
            onChange={v => onChange('openclawApiKey', v)}
            mask="*"
            onSubmit={v => {
              if (v.trim()) {
                onChange('openclawApiKey', v.trim());
                onNext();
              }
            }}
          />
          <HelpText text="Used as Bearer token for admin routes  •  Esc to go back" />
        </Box>
      )}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Workspace screen
// ---------------------------------------------------------------------------

interface WorkspaceScreenProps {
  workspaceDir: string;
  workspaceExists: boolean;
  workspaceFiles: string[];
  onNext: () => void;
  onSkip: () => void;
  onBack: () => void;
}

function WorkspaceScreen({
  workspaceDir,
  workspaceExists,
  workspaceFiles,
  onNext,
  onSkip,
  onBack,
}: WorkspaceScreenProps) {
  const items: SelectItem[] = workspaceExists
    ? [
        { label: 'Keep existing workspace files (recommended)', value: 'keep' },
        { label: 'Seed any missing default files', value: 'seed' },
      ]
    : [
        { label: 'Create workspace with default bootstrap files', value: 'seed' },
        { label: 'Skip workspace setup', value: 'skip' },
      ];

  useInput((input, key) => {
    if (key.escape) onBack();
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Header title="Workspace" subtitle="Agent context and bootstrap files" />
      <Text>
        Directory: <Text color="cyan">{workspaceDir}</Text>
      </Text>
      {workspaceExists ? (
        <Text color="green">
          {workspaceFiles.length} file(s): {workspaceFiles.join(', ')}
        </Text>
      ) : (
        <Text color="yellow">Workspace directory is empty — defaults will be created on first boot.</Text>
      )}
      <Newline />
      <SelectMenu
        items={items}
        onSelect={value => {
          if (value === 'skip') onSkip();
          else onNext();
        }}
      />
      <HelpText text="Existing files are never overwritten unless you explicitly reset them  •  Esc to go back" />
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Channels screen
// ---------------------------------------------------------------------------

interface ChannelsScreenProps {
  telegramEnabled: boolean;
  whatsappEnabled: boolean;
  onTelegram: () => void;
  onWhatsApp: () => void;
  onNext: () => void;
  onBack: () => void;
}

function ChannelsScreen({
  telegramEnabled,
  whatsappEnabled,
  onTelegram,
  onWhatsApp,
  onNext,
  onBack,
}: ChannelsScreenProps) {
  // Start on Continue to avoid accidental channel config entry
  const initialIndex = 2;

  const items: SelectItem[] = [
    {
      label: `Telegram  ${telegramEnabled ? '✓ configured' : '(not set)'}`,
      value: 'telegram',
    },
    {
      label: `WhatsApp  ${whatsappEnabled ? '✓ enabled' : '(not set)'}`,
      value: 'whatsapp',
    },
    { label: '→ Continue', value: 'next' },
  ];

  useInput((input, key) => {
    if (key.escape) onBack();
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Header title="Channels" subtitle="Optional messaging integrations" />
      <SelectMenu
        items={items}
        initialIndex={initialIndex}
        onSelect={value => {
          if (value === 'telegram') onTelegram();
          else if (value === 'whatsapp') onWhatsApp();
          else onNext();
        }}
      />
      <HelpText text="Channels are optional — skip if not needed  •  Esc to go back" />
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Telegram screen
// ---------------------------------------------------------------------------

interface TelegramScreenProps {
  token: string;
  secret: string;
  transport: string;
  onChange: (field: string, value: string) => void;
  onNext: () => void;
  onBack: () => void;
}

function TelegramScreen({
  token,
  secret,
  transport,
  onChange,
  onNext,
  onBack,
}: TelegramScreenProps) {
  const [step, setStep] = useState<'token' | 'transport' | 'secret'>('token');

  const transportItems: SelectItem[] = [
    { label: 'webhook (default, recommended)', value: 'webhook' },
    { label: 'polling (local / single instance)', value: 'polling' },
  ];

  useInput((input, key) => {
    if (key.escape) onBack();
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Header title="Telegram" subtitle="Bot token and transport configuration" />

      {step === 'token' && (
        <Box flexDirection="column">
          <Text>TELEGRAM_BOT_TOKEN:</Text>
          <TextInput
            value={token}
            onChange={v => onChange('telegramBotToken', v)}
            mask="*"
            onSubmit={v => {
              if (v.trim()) setStep('transport');
              else onBack();
            }}
          />
          <HelpText text="From @BotFather on Telegram  •  Leave blank to skip  •  Esc to go back" />
        </Box>
      )}

      {step === 'transport' && (
        <Box flexDirection="column">
          <Text>Inbound transport:</Text>
          <SelectMenu
            items={transportItems}
            onSelect={value => {
              onChange('telegramTransport', value);
              if (value === 'webhook') setStep('secret');
              else onNext();
            }}
          />
          <HelpText text="Polling is single-consumer only  •  Esc to go back" />
        </Box>
      )}

      {step === 'secret' && (
        <Box flexDirection="column">
          <Text>TELEGRAM_WEBHOOK_SECRET (optional):</Text>
          <TextInput
            value={secret}
            onChange={v => onChange('telegramWebhookSecret', v)}
            mask="*"
            onSubmit={() => onNext()}
          />
          <HelpText text="Validates X-Telegram-Bot-Api-Secret-Token header  •  Press Enter to skip  •  Esc to go back" />
        </Box>
      )}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// WhatsApp screen
// ---------------------------------------------------------------------------

interface WhatsAppScreenProps {
  enabled: boolean;
  onToggle: (value: boolean) => void;
  onNext: () => void;
  onBack: () => void;
}

function WhatsAppScreen({ enabled, onToggle, onNext, onBack }: WhatsAppScreenProps) {
  // Start on Continue to avoid accidental toggle
  const initialIndex = 1;

  const items: SelectItem[] = [
    { label: `Enable WhatsApp  ${enabled ? '(currently: YES)' : '(currently: NO)'}`, value: 'toggle' },
    { label: '→ Continue', value: 'next' },
  ];

  useInput((input, key) => {
    if (key.escape) onBack();
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Header title="WhatsApp" subtitle="Baileys-based WhatsApp adapter" />
      <Text dimColor>
        When enabled, a QR code is generated at /api/channels/whatsapp/qr on first run.
        Auth state is stored in data/whatsapp-auth/.
      </Text>
      <Newline />
      <SelectMenu
        items={items}
        initialIndex={initialIndex}
        onSelect={value => {
          if (value === 'toggle') onToggle(!enabled);
          else onNext();
        }}
      />
      <HelpText text="Esc to go back" />
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Advanced menu screen
// ---------------------------------------------------------------------------

interface AdvancedMenuScreenProps {
  onSearch: () => void;
  onBrowser: () => void;
  onEnv: () => void;
  onExec: () => void;
  onNext: () => void;
  onBack: () => void;
}

function AdvancedMenuScreen({
  onSearch,
  onBrowser,
  onEnv,
  onExec,
  onNext,
  onBack,
}: AdvancedMenuScreenProps) {
  // Start on Continue to avoid accidental config entry
  const initialIndex = 4;

  const items: SelectItem[] = [
    { label: 'Search  (Brave / Tavily API keys)', value: 'search' },
    { label: 'Browser  (headless, viewport, timeout)', value: 'browser' },
    { label: 'Env overrides  (session, history, service URLs)', value: 'env' },
    { label: 'Exec  (command execution settings)', value: 'exec' },
    { label: '→ Continue (skip advanced)', value: 'next' },
  ];

  useInput((input, key) => {
    if (key.escape) onBack();
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Header title="Advanced Settings" subtitle="Optional runtime tuning (all can be skipped)" />
      <Text dimColor>For memory, MCP, and runtime section overrides, edit openclaw.json directly after setup.</Text>
      <Newline />
      <SelectMenu
        items={items}
        initialIndex={initialIndex}
        onSelect={value => {
          if (value === 'search') onSearch();
          else if (value === 'browser') onBrowser();
          else if (value === 'env') onEnv();
          else if (value === 'exec') onExec();
          else onNext();
        }}
      />
      <HelpText text="Esc to go back" />
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Advanced search screen
// ---------------------------------------------------------------------------

interface AdvancedSearchScreenProps {
  braveKey: string;
  tavilyKey: string;
  onChange: (field: string, value: string) => void;
  onBack: () => void;
}

function AdvancedSearchScreen({
  braveKey,
  tavilyKey,
  onChange,
  onBack,
}: AdvancedSearchScreenProps) {
  const [step, setStep] = useState<'brave' | 'tavily'>('brave');

  useInput((input, key) => {
    if (key.escape) onBack();
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Header title="Search" subtitle="Web search provider keys (optional)" />

      {step === 'brave' && (
        <Box flexDirection="column">
          <Text>
            Brave Search API key <Text dimColor>(leave blank to skip)</Text>:
          </Text>
          <TextInput
            value={braveKey}
            onChange={v => onChange('searchBraveApiKey', v)}
            mask="*"
            onSubmit={() => setStep('tavily')}
          />
          <HelpText text="Used by the web_search tool  •  Press Enter to skip  •  Esc to go back" />
        </Box>
      )}

      {step === 'tavily' && (
        <Box flexDirection="column">
          <Text>
            Tavily API key <Text dimColor>(leave blank to skip)</Text>:
          </Text>
          <TextInput
            value={tavilyKey}
            onChange={v => onChange('searchTavilyApiKey', v)}
            mask="*"
            onSubmit={() => onBack()}
          />
          <HelpText text="Alternative web search provider  •  Press Enter to finish  •  Esc to go back" />
        </Box>
      )}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Advanced browser screen
// ---------------------------------------------------------------------------

interface AdvancedBrowserScreenProps {
  headless: boolean;
  width: number;
  height: number;
  timeout: number;
  onToggleHeadless: () => void;
  onChange: (field: string, value: string) => void;
  onBack: () => void;
}

function AdvancedBrowserScreen({
  headless,
  width,
  height,
  timeout,
  onToggleHeadless,
  onChange,
  onBack,
}: AdvancedBrowserScreenProps) {
  const [step, setStep] = useState<'menu' | 'width' | 'height' | 'timeout'>('menu');
  const [widthStr, setWidthStr] = useState(String(width));
  const [heightStr, setHeightStr] = useState(String(height));
  const [timeoutStr, setTimeoutStr] = useState(String(timeout));

  // Start on Back to avoid accidental toggle
  const initialIndex = 4;

  const menuItems: SelectItem[] = [
    { label: `Headless mode: ${headless ? 'yes' : 'no'} (toggle)`, value: 'headless' },
    { label: `Viewport width: ${width}px`, value: 'width' },
    { label: `Viewport height: ${height}px`, value: 'height' },
    { label: `Navigation timeout: ${timeout}ms`, value: 'timeout' },
    { label: '← Back', value: 'back' },
  ];

  useInput((input, key) => {
    if (key.escape) onBack();
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Header title="Browser Config" subtitle="Playwright browser settings (optional)" />

      {step === 'menu' && (
        <SelectMenu
          items={menuItems}
          initialIndex={initialIndex}
          onSelect={value => {
            if (value === 'headless') onToggleHeadless();
            else if (value === 'width') setStep('width');
            else if (value === 'height') setStep('height');
            else if (value === 'timeout') setStep('timeout');
            else onBack();
          }}
        />
      )}

      {step === 'width' && (
        <Box flexDirection="column">
          <Text>Viewport width (px):</Text>
          <TextInput
            value={widthStr}
            onChange={setWidthStr}
            onSubmit={v => {
              const n = parseInt(v, 10);
              if (n > 0) onChange('browserViewportWidth', String(n));
              setStep('menu');
            }}
          />
          <HelpText text="Press Enter to save  •  Esc to go back" />
        </Box>
      )}

      {step === 'height' && (
        <Box flexDirection="column">
          <Text>Viewport height (px):</Text>
          <TextInput
            value={heightStr}
            onChange={setHeightStr}
            onSubmit={v => {
              const n = parseInt(v, 10);
              if (n > 0) onChange('browserViewportHeight', String(n));
              setStep('menu');
            }}
          />
          <HelpText text="Press Enter to save  •  Esc to go back" />
        </Box>
      )}

      {step === 'timeout' && (
        <Box flexDirection="column">
          <Text>Navigation timeout (ms):</Text>
          <TextInput
            value={timeoutStr}
            onChange={setTimeoutStr}
            onSubmit={v => {
              const n = parseInt(v, 10);
              if (n > 0) onChange('browserNavigationTimeout', String(n));
              setStep('menu');
            }}
          />
          <HelpText text="Press Enter to save  •  Esc to go back" />
        </Box>
      )}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Advanced env overrides screen
// ---------------------------------------------------------------------------

interface AdvancedEnvScreenProps {
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
  onBack: () => void;
}

const ENV_KNOBS: Array<{ key: string; label: string; hint: string }> = [
  { key: 'OPENCLAW_SESSION_COMPACTION_THRESHOLD', label: 'Session compaction threshold', hint: '0.0–1.0 float' },
  { key: 'OPENCLAW_SESSION_RETAIN_COUNT', label: 'Session retain count', hint: 'integer' },
  { key: 'OPENCLAW_HISTORY_CAP_BYTES', label: 'History cap bytes', hint: 'integer' },
  { key: 'OPENCLAW_HISTORY_RETENTION_DAYS', label: 'History retention days', hint: 'integer' },
  { key: 'OPENCLAW_APP_URL', label: 'App URL (scheduler callback)', hint: 'e.g. http://localhost:3000' },
  { key: 'OPENCLAW_WS_PORT', label: 'WebSocket port', hint: 'e.g. 3003' },
  { key: 'OPENCLAW_WS_URL', label: 'WebSocket URL', hint: 'e.g. http://localhost:3003' },
];

function AdvancedEnvScreen({ values, onChange, onBack }: AdvancedEnvScreenProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');

  // Start on Done to avoid accidental edit
  const initialIndex = ENV_KNOBS.length;

  const menuItems: SelectItem[] = [
    ...ENV_KNOBS.map((k, i) => ({
      label: `${k.label}: ${values[k.key] || '(default)'}`,
      value: String(i),
    })),
    { label: '← Done', value: 'back' },
  ];

  function handleSelect(value: string) {
    if (value === 'back') {
      onBack();
      return;
    }
    const i = parseInt(value, 10);
    setActiveIndex(i);
    setEditValue(values[ENV_KNOBS[i]!.key] ?? '');
  }

  function handleSubmit(v: string) {
    if (activeIndex !== null) {
      const knob = ENV_KNOBS[activeIndex];
      if (knob) {
        onChange(knob.key, v.trim());
      }
    }
    setActiveIndex(null);
  }

  useInput((input, key) => {
    if (key.escape) {
      if (activeIndex !== null) setActiveIndex(null);
      else onBack();
    }
  });

  const activeKnob = activeIndex !== null ? ENV_KNOBS[activeIndex] : null;

  return (
    <Box flexDirection="column" padding={1}>
      <Header title="Env Overrides" subtitle="Session, history, and service URL tuning" />

      {activeIndex === null ? (
        <SelectMenu items={menuItems} initialIndex={initialIndex} onSelect={handleSelect} />
      ) : (
        <Box flexDirection="column">
          <Text>
            {activeKnob?.label} <Text dimColor>({activeKnob?.hint})</Text>:
          </Text>
          <TextInput
            value={editValue}
            onChange={setEditValue}
            onSubmit={handleSubmit}
          />
          <HelpText text="Press Enter to save, leave blank to use default  •  Esc to cancel" />
        </Box>
      )}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Advanced exec screen
// ---------------------------------------------------------------------------

interface AdvancedExecScreenProps {
  enabled: boolean;
  defaultTier: 'host' | 'sandbox' | 'locked-down';
  maxTier: 'host' | 'sandbox' | 'locked-down';
  defaultLaunchMode: 'child' | 'pty';
  defaultBackground: boolean;
  onChange: (field: string, value: string | boolean) => void;
  onBack: () => void;
}

function AdvancedExecScreen({
  enabled,
  defaultTier,
  maxTier,
  defaultLaunchMode,
  defaultBackground,
  onChange,
  onBack,
}: AdvancedExecScreenProps) {
  const [step, setStep] = useState<'menu' | 'enabled' | 'tier' | 'maxTier' | 'launchMode' | 'background'>('menu');

  const tierItems: SelectItem[] = [
    { label: 'host (execute on host system)', value: 'host' },
    { label: 'sandbox (container isolation)', value: 'sandbox' },
    { label: 'locked-down (strict container)', value: 'locked-down' },
  ];

  const launchModeItems: SelectItem[] = [
    { label: 'child (non-interactive)', value: 'child' },
    { label: 'pty (interactive terminal)', value: 'pty' },
  ];

  useInput((input, key) => {
    if (key.escape) {
      if (step === 'menu') onBack();
      else setStep('menu');
    }
  });

  if (step === 'menu') {
    const menuItems: SelectItem[] = [
      { label: `Enabled: ${enabled ? 'yes' : 'no'} (toggle)`, value: 'enabled' },
      { label: `Default tier: ${defaultTier}`, value: 'tier' },
      { label: `Max tier: ${maxTier}`, value: 'maxTier' },
      { label: `Launch mode: ${defaultLaunchMode}`, value: 'launchMode' },
      { label: `Background: ${defaultBackground ? 'yes' : 'no'} (toggle)`, value: 'background' },
      { label: '← Back', value: 'back' },
    ];

    return (
      <Box flexDirection="column" padding={1}>
        <Header title="Command Execution" subtitle="Exec tool configuration (optional)" />
        <Text dimColor>
          Controls whether agents can run shell commands and how they are executed.
        </Text>
        <Newline />
        <SelectMenu
          items={menuItems}
          initialIndex={5}
          onSelect={value => {
            if (value === 'back') onBack();
            else if (value === 'enabled') onChange('execEnabled', !enabled);
            else if (value === 'background') onChange('execDefaultBackground', !defaultBackground);
            else setStep(value as typeof step);
          }}
        />
        <HelpText text="Esc to go back" />
      </Box>
    );
  }

  if (step === 'tier') {
    return (
      <Box flexDirection="column" padding={1}>
        <Header title="Default Tier" subtitle="Default execution tier for commands" />
        <SelectMenu
          items={tierItems}
          onSelect={value => {
            onChange('execDefaultTier', value);
            setStep('menu');
          }}
        />
        <HelpText text="Esc to go back" />
      </Box>
    );
  }

  if (step === 'maxTier') {
    return (
      <Box flexDirection="column" padding={1}>
        <Header title="Max Tier" subtitle="Maximum allowed execution tier" />
        <SelectMenu
          items={tierItems}
          onSelect={value => {
            onChange('execMaxTier', value);
            setStep('menu');
          }}
        />
        <HelpText text="Esc to go back" />
      </Box>
    );
  }

  if (step === 'launchMode') {
    return (
      <Box flexDirection="column" padding={1}>
        <Header title="Launch Mode" subtitle="Default launch mode for commands" />
        <SelectMenu
          items={launchModeItems}
          onSelect={value => {
            onChange('execDefaultLaunchMode', value);
            setStep('menu');
          }}
        />
        <HelpText text="Esc to go back" />
      </Box>
    );
  }

  return null;
}

// ---------------------------------------------------------------------------
// Summary screen
// ---------------------------------------------------------------------------

interface SummaryScreenProps {
  plan: SetupPlan;
  discovery: SetupDiscovery;
  onConfirm: () => void;
  onBack: () => void;
}

function SummaryScreen({ plan, discovery, onConfirm, onBack }: SummaryScreenProps) {
  const items: SelectItem[] = [
    { label: '✓ Save configuration', value: 'confirm' },
    { label: '← Go back and edit', value: 'back' },
  ];

  return (
    <Box flexDirection="column" padding={1}>
      <Header title="Summary" subtitle="Review changes before saving" />

      <Box flexDirection="column" gap={0}>
        <Text bold>Will write to:</Text>
        <Text>  • openclaw.json → <Text color="cyan">{plan.configPath}</Text></Text>
        <Text>  • env file     → <Text color="cyan">{plan.envFilePath}</Text></Text>
        <Text>  • workspace    → <Text color="cyan">{plan.workspaceDir}</Text></Text>
      </Box>

      <Newline />

      <Box flexDirection="column" gap={0}>
        <Text bold>Providers:</Text>
        {plan.providers.map(p => (
          <Text key={p.id}>
            {'  '}• {p.id} ({p.apiType})  key: {p.apiKey.startsWith('${') ? p.apiKey : '***'}
          </Text>
        ))}
      </Box>

      <Text>
        Default agent: <Text color="cyan">{plan.agentProvider}</Text> / <Text color="cyan">{plan.agentModel}</Text>
        {plan.agentFallbackProvider && (
          <Text dimColor>  (fallback: {plan.agentFallbackProvider}/{plan.agentFallbackModel})</Text>
        )}
      </Text>

      <Text>
        Auth:{' '}
        {plan.insecureLocal ? (
          <Text color="yellow">OPENCLAW_ALLOW_INSECURE_LOCAL=true (local testing)</Text>
        ) : plan.openclawApiKey ? (
          <Text color="green">OPENCLAW_API_KEY configured</Text>
        ) : (
          <Text color="red">Not configured</Text>
        )}
      </Text>

      {plan.telegramBotToken && (
        <Text>
          Telegram: <Text color="green">configured</Text>{' '}
          <Text dimColor>({plan.telegramTransport})</Text>
        </Text>
      )}

      {plan.whatsappEnabled && (
        <Text>
          WhatsApp: <Text color="green">enabled</Text>
        </Text>
      )}

      {(plan.searchBraveApiKey || plan.searchTavilyApiKey) && (
        <Text>
          Search:{' '}
          <Text dimColor>
            {[plan.searchBraveApiKey && 'Brave', plan.searchTavilyApiKey && 'Tavily']
              .filter(Boolean)
              .join(', ')}
          </Text>
        </Text>
      )}

      <Newline />
      <SelectMenu items={items} onSelect={v => (v === 'confirm' ? onConfirm() : onBack())} />
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Saving screen
// ---------------------------------------------------------------------------

interface SavingScreenProps {
  plan: SetupPlan;
  onDone: (errors: string[]) => void;
}

function SavingScreen({ plan, onDone }: SavingScreenProps) {
  const [status, setStatus] = useState('Saving configuration…');

  useEffect(() => {
    persistSetupPlan(plan)
      .then(result => {
        setStatus('Done!');
        onDone(result.errors);
      })
      .catch((err: unknown) => {
        onDone([err instanceof Error ? err.message : String(err)]);
      });
  }, []);

  return (
    <Box flexDirection="column" padding={1}>
      <Header title="Saving" />
      <Text color="cyan">{status}</Text>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Verification screen (post-save diagnostics)
// ---------------------------------------------------------------------------

interface VerificationScreenProps {
  saveErrors: string[];
  onDone: () => void;
}

function VerificationScreen({ saveErrors, onDone }: VerificationScreenProps) {
  const [result, setResult] = useState<DiagnosticsResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getStartupDiagnostics()
      .then(r => {
        setResult(r);
        setLoading(false);
      })
      .catch(() => {
        setResult({ hardFailures: [], softWarnings: [], ready: false });
        setLoading(false);
      });
  }, []);

  useInput((input, key) => {
    if (!loading && key.return) onDone();
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Header title="Verification" subtitle="Post-save startup readiness check" />

      {saveErrors.length > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          <Text color="red" bold>
            Save errors:
          </Text>
          {saveErrors.map((e, i) => (
            <Text key={i} color="red">
              {'  '}• {e}
            </Text>
          ))}
        </Box>
      )}

      {loading && <Text color="cyan">Running checks…</Text>}

      {result && (
        <Box flexDirection="column" gap={0}>
          {result.ready ? (
            <DiagRow type="startup" message="All hard requirements pass" kind="pass" />
          ) : (
            result.hardFailures.map((f, i) => (
              <Box key={i} flexDirection="column">
                <DiagRow type={f.type} message={f.error} kind="fail" />
                <Text dimColor>  Fix: {f.guidance}</Text>
              </Box>
            ))
          )}

          {result.softWarnings.map((w, i) => (
            <DiagRow key={i} type={w.type} message={w.warning} kind="warn" />
          ))}

          <Newline />
          {result.ready ? (
            <Text color="green" bold>
              ✓ Ready to start! Run: <Text color="cyan">bun run dev</Text>
            </Text>
          ) : (
            <Text color="yellow">Fix the issues above, then run: bun run dev</Text>
          )}

          {result.softWarnings.length > 0 && (
            <Text dimColor>
              {result.softWarnings.length} optional integration(s) not configured — that is fine.
            </Text>
          )}
        </Box>
      )}

      {!loading && (
        <HelpText text="Press Enter to exit" />
      )}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Doctor screen (read-only diagnostics, task 4.4)
// ---------------------------------------------------------------------------

interface DoctorScreenProps {
  onDone: () => void;
}

function DoctorScreen({ onDone }: DoctorScreenProps) {
  const [result, setResult] = useState<DiagnosticsResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getStartupDiagnostics()
      .then(r => {
        setResult(r);
        setLoading(false);
      })
      .catch(() => {
        setResult({ hardFailures: [], softWarnings: [], ready: false });
        setLoading(false);
      });
  }, []);

  useInput((input, key) => {
    if (!loading && key.return) onDone();
  });

  const HARD_CHECKS = ['config-file', 'provider-keys', 'exec-runtime', 'internal-auth', 'database'];

  return (
    <Box flexDirection="column" padding={1}>
      <Header title="Doctor" subtitle="Read-only startup diagnostics" />

      {loading && <Text color="cyan">Running checks…</Text>}

      {result && (
        <Box flexDirection="column" gap={0}>
          <Text bold>Hard requirements:</Text>
          {HARD_CHECKS.map(check => {
            const failure = result.hardFailures.find(f => f.type === check);
            if (failure) {
              return (
                <Box key={check} flexDirection="column">
                  <DiagRow type={check} message={failure.error} kind="fail" />
                  <Text dimColor>  Fix: {failure.guidance}</Text>
                </Box>
              );
            }
            return (
              <DiagRow
                key={check}
                type={check}
                message="OK"
                kind={result.ready || !result.hardFailures.some(f => f.type === check) ? 'pass' : 'fail'}
              />
            );
          })}

          <Newline />
          <Text bold>Optional capabilities:</Text>
          {result.softWarnings.map((w, i) => (
            <DiagRow key={i} type={w.type} message={w.warning} kind="warn" />
          ))}

          <Newline />
          {result.ready ? (
            <Text color="green" bold>
              ✓ All hard requirements pass. Run: <Text color="cyan">bun run dev</Text>
            </Text>
          ) : (
            <Text color="red" bold>
              ✗ {result.hardFailures.length} hard requirement(s) failing. Run{' '}
              <Text color="cyan">bun run setup</Text> to fix.
            </Text>
          )}
        </Box>
      )}

      {!loading && <HelpText text="Press Enter to exit" />}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Done screen
// ---------------------------------------------------------------------------

function DoneScreen({ onExit }: { onExit: () => void }) {
  useInput((input, key) => {
    if (key.return || input === 'q') onExit();
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Header title="Done" />
      <Text color="green" bold>
        ✓ Setup complete!
      </Text>
      <Newline />
      <Text bold>Next steps:</Text>
      <Text>  1. Start the app:  <Text color="cyan">bun run dev</Text></Text>
      <Text>  2. Open the dashboard:  <Text color="cyan">http://localhost:3000</Text></Text>
      <Text>  3. Re-run setup anytime:  <Text color="cyan">bun run setup</Text></Text>
      <Text>  4. Check install health:  <Text color="cyan">bun run setup --doctor</Text></Text>
      <Newline />
      <HelpText text="Press Enter or Q to exit" />
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Main App component
// ---------------------------------------------------------------------------

interface AppProps {
  discovery: SetupDiscovery;
  doctorMode: boolean;
}

function App({ discovery, doctorMode }: AppProps) {
  const { exit } = useApp();
  const [screen, setScreen] = useState<Screen>(doctorMode ? 'doctor' : 'welcome');
  const [plan, setPlan] = useState<SetupPlan>(() => buildInitialPlan(discovery));
  const [saveErrors, setSaveErrors] = useState<string[]>([]);

  const update = useCallback(
    (field: keyof SetupPlan, value: SetupPlan[keyof SetupPlan]) => {
      setPlan(prev => ({ ...prev, [field]: value }));
    },
    [],
  );

  const updateField = useCallback(
    (field: string, value: string | boolean | number) => {
      setPlan(prev => ({ ...prev, [field]: value }));
    },
    [],
  );

  const updateProvider = useCallback((p: ProviderRawEntry) => {
    setPlan(prev => ({
      ...prev,
      providers: [...prev.providers.filter(x => x.id !== p.id), p],
    }));
  }, []);

  const removeProvider = useCallback((id: string) => {
    setPlan(prev => ({
      ...prev,
      providers: prev.providers.filter(p => p.id !== id),
    }));
  }, []);

  const updateAdvancedEnv = useCallback((key: string, value: string) => {
    setPlan(prev => ({
      ...prev,
      advancedEnv: { ...prev.advancedEnv, [key]: value },
    }));
  }, []);

  if (screen === 'welcome') {
    return (
      <WelcomeScreen
        discovery={discovery}
        doctorMode={false}
        onSetup={() => setScreen('database')}
        onDoctor={() => setScreen('doctor')}
        onQuit={() => exit()}
      />
    );
  }

  if (screen === 'doctor') {
    return <DoctorScreen onDone={() => exit()} />;
  }

  if (screen === 'database') {
    return (
      <DatabaseScreen
        value={plan.databaseUrl}
        onChange={v => updateField('databaseUrl', v)}
        onNext={() => setScreen('provider-list')}
        onBack={() => setScreen('welcome')}
      />
    );
  }

  if (screen === 'provider-list') {
    return (
      <ProviderListScreen
        providers={plan.providers}
        onAdd={() => setScreen('provider-add')}
        onRemove={removeProvider}
        onNext={() => setScreen('agent-model')}
        onBack={() => setScreen('database')}
      />
    );
  }

  if (screen === 'provider-add') {
    return (
      <ProviderAddScreen
        onAdd={p => {
          updateProvider(p);
          setScreen('provider-list');
        }}
        onBack={() => setScreen('provider-list')}
      />
    );
  }

  if (screen === 'agent-model') {
    return (
      <AgentModelScreen
        providers={plan.providers}
        provider={plan.agentProvider}
        model={plan.agentModel}
        fallbackProvider={plan.agentFallbackProvider}
        fallbackModel={plan.agentFallbackModel}
        onChange={updateField}
        onNext={() => setScreen('auth')}
        onBack={() => setScreen('provider-list')}
      />
    );
  }

  if (screen === 'auth') {
    return (
      <AuthScreen
        apiKey={plan.openclawApiKey}
        insecureLocal={plan.insecureLocal}
        onChange={updateField}
        onNext={() => setScreen('workspace')}
        onBack={() => setScreen('agent-model')}
      />
    );
  }

  if (screen === 'workspace') {
    return (
      <WorkspaceScreen
        workspaceDir={plan.workspaceDir}
        workspaceExists={discovery.workspaceExists}
        workspaceFiles={discovery.workspaceFiles}
        onNext={() => setScreen('channels')}
        onSkip={() => setScreen('channels')}
        onBack={() => setScreen('auth')}
      />
    );
  }

  if (screen === 'channels') {
    return (
      <ChannelsScreen
        telegramEnabled={!!plan.telegramBotToken}
        whatsappEnabled={plan.whatsappEnabled}
        onTelegram={() => setScreen('telegram')}
        onWhatsApp={() => setScreen('whatsapp')}
        onNext={() => setScreen('advanced-menu')}
        onBack={() => setScreen('workspace')}
      />
    );
  }

  if (screen === 'telegram') {
    return (
      <TelegramScreen
        token={plan.telegramBotToken}
        secret={plan.telegramWebhookSecret}
        transport={plan.telegramTransport}
        onChange={updateField}
        onNext={() => setScreen('channels')}
        onBack={() => setScreen('channels')}
      />
    );
  }

  if (screen === 'whatsapp') {
    return (
      <WhatsAppScreen
        enabled={plan.whatsappEnabled}
        onToggle={v => updateField('whatsappEnabled', v)}
        onNext={() => setScreen('channels')}
        onBack={() => setScreen('channels')}
      />
    );
  }

  if (screen === 'advanced-menu') {
    return (
      <AdvancedMenuScreen
        onSearch={() => setScreen('advanced-search')}
        onBrowser={() => setScreen('advanced-browser')}
        onEnv={() => setScreen('advanced-env')}
        onExec={() => setScreen('advanced-exec')}
        onNext={() => setScreen('summary')}
        onBack={() => setScreen('channels')}
      />
    );
  }

  if (screen === 'advanced-search') {
    return (
      <AdvancedSearchScreen
        braveKey={plan.searchBraveApiKey}
        tavilyKey={plan.searchTavilyApiKey}
        onChange={updateField}
        onBack={() => setScreen('advanced-menu')}
      />
    );
  }

  if (screen === 'advanced-browser') {
    return (
      <AdvancedBrowserScreen
        headless={plan.browserHeadless}
        width={plan.browserViewportWidth}
        height={plan.browserViewportHeight}
        timeout={plan.browserNavigationTimeout}
        onToggleHeadless={() => updateField('browserHeadless', !plan.browserHeadless)}
        onChange={(field, value) => {
          const n = parseInt(value, 10);
          if (!isNaN(n)) updateField(field, n);
        }}
        onBack={() => setScreen('advanced-menu')}
      />
    );
  }

  if (screen === 'advanced-env') {
    return (
      <AdvancedEnvScreen
        values={plan.advancedEnv}
        onChange={updateAdvancedEnv}
        onBack={() => setScreen('advanced-menu')}
      />
    );
  }

  if (screen === 'advanced-exec') {
    return (
      <AdvancedExecScreen
        enabled={plan.execEnabled}
        defaultTier={plan.execDefaultTier}
        maxTier={plan.execMaxTier}
        defaultLaunchMode={plan.execDefaultLaunchMode}
        defaultBackground={plan.execDefaultBackground}
        onChange={updateField}
        onBack={() => setScreen('advanced-menu')}
      />
    );
  }

  if (screen === 'summary') {
    return (
      <SummaryScreen
        plan={plan}
        discovery={discovery}
        onConfirm={() => setScreen('saving')}
        onBack={() => setScreen('advanced-menu')}
      />
    );
  }

  if (screen === 'saving') {
    return (
      <SavingScreen
        plan={plan}
        onDone={errors => {
          setSaveErrors(errors);
          setScreen('verification');
        }}
      />
    );
  }

  if (screen === 'verification') {
    return (
      <VerificationScreen
        saveErrors={saveErrors}
        onDone={() => setScreen('done')}
      />
    );
  }

  if (screen === 'done') {
    return <DoneScreen onExit={() => exit()} />;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main() {
  const doctorMode = process.argv.includes('--doctor');

  const discovery = discoverSetup();

  const { waitUntilExit } = render(<App discovery={discovery} doctorMode={doctorMode} />);

  if (doctorMode) {
    // In doctor mode, jump straight to doctor screen — handled by App initial state
  }

  await waitUntilExit();
}

main().catch((error: unknown) => {
  console.error('Setup failed:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
