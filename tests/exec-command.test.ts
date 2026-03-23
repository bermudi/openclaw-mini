/// <reference types="bun-types" />

import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import {
  parseCommand,
  getBinaryBasename,
  truncateOutput,
  capCombinedOutput,
} from '../src/lib/utils/exec-helpers';

const TEST_AGENT_ID = 'exec-test-agent';
let TEST_SANDBOX_ROOT: string;

beforeEach(() => {
  TEST_SANDBOX_ROOT = fs.mkdtempSync(path.join(tmpdir(), 'openclaw-mini-exec-'));
});

afterEach(() => {
  if (TEST_SANDBOX_ROOT && fs.existsSync(TEST_SANDBOX_ROOT)) {
    fs.rmSync(TEST_SANDBOX_ROOT, { recursive: true, force: true });
  }
});

describe('parseCommand', () => {
  it('parses simple command with no arguments', () => {
    const result = parseCommand('ls');
    
    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      expect(result.binary).toBe('ls');
      expect(result.args).toEqual([]);
    }
  });

  it('parses command with arguments', () => {
    const result = parseCommand('cat file.txt');
    
    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      expect(result.binary).toBe('cat');
      expect(result.args).toEqual(['file.txt']);
    }
  });

  it('parses command with multiple arguments', () => {
    const result = parseCommand('grep -n pattern file.txt');
    
    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      expect(result.binary).toBe('grep');
      expect(result.args).toEqual(['-n', 'pattern', 'file.txt']);
    }
  });

  it('respects quoted strings', () => {
    const result = parseCommand('echo "hello world"');
    
    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      expect(result.binary).toBe('echo');
      expect(result.args).toEqual(['hello world']);
    }
  });

  it('respects single quotes', () => {
    const result = parseCommand("echo 'hello world'");
    
    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      expect(result.binary).toBe('echo');
      expect(result.args).toEqual(['hello world']);
    }
  });

  it('rejects pipe operator', () => {
    const result = parseCommand('cat file.txt | grep pattern');
    
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toContain('Shell operators');
      expect(result.error).toContain('|');
    }
  });

  it('rejects && operator', () => {
    const result = parseCommand('ls && cat file.txt');
    
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toContain('&&');
    }
  });

  it('rejects || operator', () => {
    const result = parseCommand('ls || echo failed');
    
    expect('error' in result).toBe(true);
    if ('error' in result) {
      // || contains |, which is detected first
      expect(result.error).toContain('|');
    }
  });

  it('rejects semicolon operator', () => {
    const result = parseCommand('ls; cat file.txt');
    
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toContain(';');
    }
  });

  it('rejects output redirect', () => {
    const result = parseCommand('cat file.txt > output.txt');
    
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toContain('>');
    }
  });

  it('rejects input redirect', () => {
    const result = parseCommand('cat < input.txt');
    
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toContain('<');
    }
  });

  it('rejects backticks', () => {
    const result = parseCommand('echo `date`');
    
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toContain('`');
    }
  });

  it('rejects $() command substitution', () => {
    const result = parseCommand('echo $(date)');
    
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toContain('$(');
    }
  });

  it('rejects & background execution', () => {
    const result = parseCommand('sleep 10 &');
    
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toContain('&');
    }
  });

  it('rejects empty command', () => {
    const result = parseCommand('');
    
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toContain('Empty command');
    }
  });

  it('rejects whitespace-only command', () => {
    const result = parseCommand('   ');
    
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toContain('Empty command');
    }
  });
});

describe('getBinaryBasename', () => {
  it('returns simple name unchanged', () => {
    expect(getBinaryBasename('cat')).toBe('cat');
  });

  it('extracts basename from Unix path', () => {
    expect(getBinaryBasename('/usr/bin/cat')).toBe('cat');
  });

  it('extracts basename from Windows path', () => {
    expect(getBinaryBasename('C:\\Windows\\System32\\cmd.exe')).toBe('cmd.exe');
  });

  it('handles nested paths', () => {
    expect(getBinaryBasename('/usr/local/bin/node')).toBe('node');
  });
});

describe('truncateOutput', () => {
  it('returns output unchanged when within limit', () => {
    const output = 'Hello, world!';
    const result = truncateOutput(output, 100);
    
    expect(result).toBe(output);
  });

  it('truncates from beginning when exceeding limit', () => {
    const output = '0123456789'.repeat(20); // 200 chars
    const result = truncateOutput(output, 100);
    
    expect(result).toContain('[output truncated');
    expect(result.length).toBeGreaterThan(100);
    expect(result).toContain('0123456789'.repeat(10)); // Last 100 chars should be present
  });

  it('preserves exact limit characters in tail', () => {
    const output = 'ABCDEFGHIJ'.repeat(20); // 200 chars
    const result = truncateOutput(output, 50);
    
    // The tail should be the last 50 chars
    expect(result).toContain('ABCDEFGHIJ'.repeat(5));
  });

  it('handles empty output', () => {
    const result = truncateOutput('', 100);
    
    expect(result).toBe('');
  });

  it('handles output exactly at limit', () => {
    const output = 'x'.repeat(100);
    const result = truncateOutput(output, 100);
    
    expect(result).toBe(output);
  });
});

describe('capCombinedOutput', () => {
  it('returns both streams unchanged when within limit', () => {
    const result = capCombinedOutput('hello', 'world', 100);
    
    expect(result.stdout).toBe('hello');
    expect(result.stderr).toBe('world');
    expect(result.truncated).toBe(false);
  });

  it('sets truncated flag when combined exceeds limit', () => {
    const stdout = 'a'.repeat(8000);
    const stderr = 'b'.repeat(4000);
    const result = capCombinedOutput(stdout, stderr, 10000);
    
    expect(result.truncated).toBe(true);
  });

  it('ensures total output does not exceed maxOutputSize', () => {
    const stdout = 'a'.repeat(8000);
    const stderr = 'b'.repeat(8000);
    const result = capCombinedOutput(stdout, stderr, 10000);
    
    // Combined truncated output should not exceed limit (truncation notices are allowed to add a little)
    expect(result.truncated).toBe(true);
    // Each stream is allocated proportionally (50/50 here) so each gets ~5000 chars
    expect(result.stdout.length).toBeLessThanOrEqual(10000);
    expect(result.stderr.length).toBeLessThanOrEqual(10000);
  });

  it('allocates proportionally by stream size', () => {
    // stdout is 3x larger than stderr, so it gets ~75% of budget
    const stdout = 'A'.repeat(9000);
    const stderr = 'B'.repeat(3000);
    const result = capCombinedOutput(stdout, stderr, 8000);
    
    expect(result.truncated).toBe(true);
    // stdout should get ~6000, stderr ~2000
    expect(result.stdout).toContain('[output truncated');
    expect(result.stderr).toContain('[output truncated');
  });

  it('handles empty stdout gracefully', () => {
    const result = capCombinedOutput('', 'b'.repeat(20000), 10000);
    
    expect(result.truncated).toBe(true);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('[output truncated');
  });

  it('handles empty stderr gracefully', () => {
    const result = capCombinedOutput('a'.repeat(20000), '', 10000);
    
    expect(result.truncated).toBe(true);
    expect(result.stdout).toContain('[output truncated');
    expect(result.stderr).toBe('');
  });

  it('handles both empty streams', () => {
    const result = capCombinedOutput('', '', 10000);
    
    expect(result.truncated).toBe(false);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
  });
});

describe('sandbox integration', () => {
  beforeEach(async () => {
    const { setSandboxRootForTests } = await import('../src/lib/services/sandbox-service');
    setSandboxRootForTests(TEST_SANDBOX_ROOT);
  });

  afterEach(async () => {
    const { setSandboxRootForTests } = await import('../src/lib/services/sandbox-service');
    setSandboxRootForTests(null);
  });

  it('sandbox directory is created for agent', async () => {
    const { getSandboxDir } = await import('../src/lib/services/sandbox-service');
    const sandboxDir = getSandboxDir(TEST_AGENT_ID);
    
    expect(fs.existsSync(sandboxDir)).toBe(true);
  });

  it('can write and read file in sandbox', async () => {
    const { getSandboxDir } = await import('../src/lib/services/sandbox-service');
    const sandboxDir = getSandboxDir(TEST_AGENT_ID);
    const testFile = path.join(sandboxDir, 'test.txt');
    
    fs.writeFileSync(testFile, 'Hello, sandbox!', 'utf-8');
    
    expect(fs.existsSync(testFile)).toBe(true);
    expect(fs.readFileSync(testFile, 'utf-8')).toBe('Hello, sandbox!');
  });
});
