import fs from 'fs';
import path from 'path';

export interface BootstrapConfig {
  workspaceDir: string;
  perFileCharCap: number;
  totalCharCap: number;
}

export interface WorkspaceFileSummary {
  name: string;
  size: number;
}

type BootstrapFileName = 'IDENTITY.md' | 'SOUL.md' | 'USER.md' | 'AGENTS.md' | 'TOOLS.md' | 'MEMORY.md';
type DefaultWorkspaceFileName = 'IDENTITY.md' | 'SOUL.md' | 'USER.md' | 'AGENTS.md' | 'TOOLS.md';

type BootstrapFileDefinition = {
  name: BootstrapFileName;
  title: string;
};

const DEFAULT_PER_FILE_CHAR_CAP = 20_000;
const DEFAULT_TOTAL_CHAR_CAP = 150_000;
const TRUNCATION_NOTICE = '[... truncated]';
const HEARTBEAT_FILE_NAME = 'HEARTBEAT.md';
const HEARTBEAT_SECTION_TITLE = 'Heartbeat Checklist';
const MINIMAL_BOOTSTRAP_PROMPT = [
  '## Identity',
  'You are an AI agent operating inside the OpenClaw runtime.',
  '',
  '## Persona & Tone',
  'Be concise, helpful, and focused on the current task.',
  '',
  '## Operating Instructions',
  'Use your available tools carefully, maintain context, and complete the task in front of you.',
].join('\n');

export const BOOTSTRAP_FILES: BootstrapFileDefinition[] = [
  { name: 'IDENTITY.md', title: 'Identity' },
  { name: 'SOUL.md', title: 'Persona & Tone' },
  { name: 'USER.md', title: 'User Profile' },
  { name: 'AGENTS.md', title: 'Operating Instructions' },
  { name: 'TOOLS.md', title: 'Tool Notes' },
  { name: 'MEMORY.md', title: 'Long-Term Memory' },
];

export const DEFAULT_WORKSPACE_FILES: Record<DefaultWorkspaceFileName, string> = {
  'IDENTITY.md': ['# OpenClaw Mini', '', 'You are the primary agent for this OpenClaw Mini workspace.'].join('\n'),
  'SOUL.md': [
    '# Persona & Tone',
    '',
    'You are calm, direct, and thoughtful.',
    'You prefer elegant solutions, clear trade-offs, and honest communication about risk.',
  ].join('\n'),
  'USER.md': [
    '# User Profile',
    '',
    'The user is the operator of this workspace.',
    'Adapt to their goals, preserve context, and help them move the system forward.',
  ].join('\n'),
  'AGENTS.md': [
    '# Operating Instructions',
    '',
    'Work step by step.',
    'Use tools when they reduce guesswork.',
    'Preserve important context and leave the system in a verifiable state.',
  ].join('\n'),
  'TOOLS.md': [
    '# Tool Notes',
    '',
    'Use available tools deliberately.',
    'Prefer safe reads before writes, and verify important changes after making them.',
  ].join('\n'),
};

function resolveConfig(config: Partial<BootstrapConfig> = {}): BootstrapConfig {
  return {
    workspaceDir: config.workspaceDir ?? process.env.OPENCLAW_WORKSPACE_DIR ?? path.join(process.cwd(), 'data', 'workspace'),
    perFileCharCap: config.perFileCharCap ?? DEFAULT_PER_FILE_CHAR_CAP,
    totalCharCap: config.totalCharCap ?? DEFAULT_TOTAL_CHAR_CAP,
  };
}

function formatSection(title: string, content: string): string {
  return `## ${title}\n${content.trim()}`;
}

function truncateContent(content: string, limit: number): string {
  if (content.length <= limit) {
    return content;
  }

  if (limit <= TRUNCATION_NOTICE.length) {
    return TRUNCATION_NOTICE.slice(0, limit);
  }

  const truncatedBodyLength = Math.max(limit - TRUNCATION_NOTICE.length - 2, 0);
  const truncatedBody = content.slice(0, truncatedBodyLength).trimEnd();
  return `${truncatedBody}\n\n${TRUNCATION_NOTICE}`;
}

function readWorkspaceSection(
  fileName: string,
  title: string,
  config: BootstrapConfig,
): string | null {
  const filePath = path.join(config.workspaceDir, fileName);
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const rawContent = fs.readFileSync(filePath, 'utf-8').trim();
  if (!rawContent) {
    return null;
  }

  const cappedContent = truncateContent(rawContent, config.perFileCharCap);
  return formatSection(title, cappedContent);
}

export function getWorkspaceDir(config: Partial<BootstrapConfig> = {}): string {
  return resolveConfig(config).workspaceDir;
}

export function loadBootstrapContext(config: Partial<BootstrapConfig> = {}): string {
  const resolvedConfig = resolveConfig(config);
  const sections: string[] = [];
  let totalLength = 0;

  for (const file of BOOTSTRAP_FILES) {
    const section = readWorkspaceSection(file.name, file.title, resolvedConfig);
    if (!section) {
      continue;
    }

    const sectionLength = section.length + (sections.length > 0 ? 2 : 0);
    if (totalLength + sectionLength > resolvedConfig.totalCharCap) {
      break;
    }

    sections.push(section);
    totalLength += sectionLength;
  }

  return sections.length > 0 ? sections.join('\n\n') : MINIMAL_BOOTSTRAP_PROMPT;
}

export function loadHeartbeatContext(config: Partial<BootstrapConfig> = {}): string {
  const resolvedConfig = resolveConfig(config);
  return readWorkspaceSection(HEARTBEAT_FILE_NAME, HEARTBEAT_SECTION_TITLE, resolvedConfig) ?? '';
}

export function initializeWorkspace(config: Partial<BootstrapConfig> = {}): {
  created: boolean;
  filesCreated: string[];
  workspaceDir: string;
} {
  const resolvedConfig = resolveConfig(config);
  const workspaceDir = resolvedConfig.workspaceDir;
  const existed = fs.existsSync(workspaceDir);

  if (!existed) {
    fs.mkdirSync(workspaceDir, { recursive: true });
  }

  const existingEntries = fs.readdirSync(workspaceDir);
  if (existingEntries.length > 0) {
    return {
      created: false,
      filesCreated: [],
      workspaceDir,
    };
  }

  const filesCreated = Object.entries(DEFAULT_WORKSPACE_FILES).map(([fileName, content]) => {
    const filePath = path.join(workspaceDir, fileName);
    fs.writeFileSync(filePath, `${content.trim()}\n`, 'utf-8');
    return fileName;
  });

  return {
    created: true,
    filesCreated,
    workspaceDir,
  };
}

export function isSafeWorkspaceFileName(fileName: string): boolean {
  return /^[A-Za-z0-9_-]+\.md$/.test(fileName);
}

export function listWorkspaceFiles(config: Partial<BootstrapConfig> = {}): WorkspaceFileSummary[] {
  const resolvedConfig = resolveConfig(config);
  if (!fs.existsSync(resolvedConfig.workspaceDir)) {
    return [];
  }

  return fs
    .readdirSync(resolvedConfig.workspaceDir)
    .filter(fileName => isSafeWorkspaceFileName(fileName))
    .map(fileName => {
      const filePath = path.join(resolvedConfig.workspaceDir, fileName);
      const stats = fs.statSync(filePath);
      return {
        name: fileName,
        isFile: stats.isFile(),
        size: stats.size,
      };
    })
    .filter(file => file.isFile)
    .map(({ isFile: _isFile, ...file }) => file)
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function readWorkspaceFile(fileName: string, config: Partial<BootstrapConfig> = {}): string | null {
  if (!isSafeWorkspaceFileName(fileName)) {
    throw new Error('Invalid workspace filename');
  }

  const resolvedConfig = resolveConfig(config);
  const filePath = path.join(resolvedConfig.workspaceDir, fileName);
  if (!fs.existsSync(filePath)) {
    return null;
  }

  return fs.readFileSync(filePath, 'utf-8');
}

export function writeWorkspaceFile(
  fileName: string,
  content: string,
  config: Partial<BootstrapConfig> = {},
): WorkspaceFileSummary {
  if (!isSafeWorkspaceFileName(fileName)) {
    throw new Error('Invalid workspace filename');
  }

  const resolvedConfig = resolveConfig(config);
  fs.mkdirSync(resolvedConfig.workspaceDir, { recursive: true });

  const filePath = path.join(resolvedConfig.workspaceDir, fileName);
  fs.writeFileSync(filePath, content, 'utf-8');

  return {
    name: fileName,
    size: Buffer.byteLength(content, 'utf-8'),
  };
}
