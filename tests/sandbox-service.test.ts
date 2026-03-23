import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import {
  getSandboxRoot,
  getSandboxDir,
  getSandboxDownloadsDir,
  getSandboxOutputDir,
  resolveSandboxPath,
  validateSandboxPath,
  setSandboxRootForTests,
} from '@/lib/services/sandbox-service';

const TEST_AGENT_ID = 'test-agent-123';
let TEST_SANDBOX_ROOT: string;

describe('sandbox-service', () => {
  beforeEach(() => {
    TEST_SANDBOX_ROOT = fs.mkdtempSync(path.join(tmpdir(), 'openclaw-mini-sandbox-'));
    setSandboxRootForTests(TEST_SANDBOX_ROOT);
  });

  afterEach(() => {
    setSandboxRootForTests(null);
    if (TEST_SANDBOX_ROOT && fs.existsSync(TEST_SANDBOX_ROOT)) {
      fs.rmSync(TEST_SANDBOX_ROOT, { recursive: true, force: true });
    }
  });

  describe('getSandboxRoot', () => {
    it('returns the sandbox root path', () => {
      const root = getSandboxRoot();
      expect(root).toBe(TEST_SANDBOX_ROOT);
    });
  });

  describe('getSandboxDir', () => {
    it('creates sandbox directory for agent if it does not exist', () => {
      const sandboxDir = getSandboxDir(TEST_AGENT_ID);
      
      expect(sandboxDir).toBe(path.join(TEST_SANDBOX_ROOT, TEST_AGENT_ID));
      expect(fs.existsSync(sandboxDir)).toBe(true);
    });

    it('returns existing sandbox directory without modification', () => {
      // Create it first
      const firstCall = getSandboxDir(TEST_AGENT_ID);
      
      // Call again
      const secondCall = getSandboxDir(TEST_AGENT_ID);
      
      expect(firstCall).toBe(secondCall);
      expect(fs.existsSync(secondCall)).toBe(true);
    });

    it('is idempotent - multiple calls return same path', () => {
      const paths = [
        getSandboxDir(TEST_AGENT_ID),
        getSandboxDir(TEST_AGENT_ID),
        getSandboxDir(TEST_AGENT_ID),
      ];
      
      expect(paths[0]).toBe(paths[1]);
      expect(paths[1]).toBe(paths[2]);
    });

    it('rejects agentId with path traversal characters', () => {
      expect(() => getSandboxDir('test-../../etc')).toThrow('Invalid agentId');
      expect(() => getSandboxDir('test/../agent')).toThrow('Invalid agentId');
    });

    it('rejects empty agentId', () => {
      expect(() => getSandboxDir('')).toThrow('Invalid agentId');
    });

    it('rejects agentId with special characters', () => {
      expect(() => getSandboxDir('test$agent')).toThrow('Invalid agentId');
      expect(() => getSandboxDir('test agent')).toThrow('Invalid agentId');
    });

    it('accepts valid agentId characters', () => {
      expect(() => getSandboxDir('agent-123_ABC')).not.toThrow();
      expect(() => getSandboxDir('simple')).not.toThrow();
    });
  });

  describe('getSandboxDownloadsDir', () => {
    it('creates downloads subdirectory within sandbox', () => {
      const downloadsDir = getSandboxDownloadsDir(TEST_AGENT_ID);
      
      expect(downloadsDir).toBe(path.join(TEST_SANDBOX_ROOT, TEST_AGENT_ID, 'downloads'));
      expect(fs.existsSync(downloadsDir)).toBe(true);
    });

    it('ensures parent sandbox directory exists', () => {
      const downloadsDir = getSandboxDownloadsDir(TEST_AGENT_ID);
      const sandboxDir = path.dirname(downloadsDir);
      
      expect(fs.existsSync(sandboxDir)).toBe(true);
    });
  });

  describe('getSandboxOutputDir', () => {
    it('creates output subdirectory within sandbox', () => {
      const outputDir = getSandboxOutputDir(TEST_AGENT_ID);
      
      expect(outputDir).toBe(path.join(TEST_SANDBOX_ROOT, TEST_AGENT_ID, 'output'));
      expect(fs.existsSync(outputDir)).toBe(true);
    });

    it('ensures parent sandbox directory exists', () => {
      const outputDir = getSandboxOutputDir(TEST_AGENT_ID);
      const sandboxDir = path.dirname(outputDir);
      
      expect(fs.existsSync(sandboxDir)).toBe(true);
    });
  });

  describe('validateSandboxPath', () => {
    it('accepts paths within sandbox root', () => {
      const sandboxRoot = getSandboxRoot();
      const validPath = path.join(sandboxRoot, 'agent-123', 'file.txt');
      
      expect(() => validateSandboxPath(validPath, sandboxRoot)).not.toThrow();
    });

    it('rejects paths that escape sandbox root', () => {
      const sandboxRoot = getSandboxRoot();
      const escapingPath = path.join(sandboxRoot, '..', '..', 'etc', 'passwd');
      
      expect(() => validateSandboxPath(escapingPath, sandboxRoot)).toThrow('Path traversal detected');
    });

    it('rejects path pointing to sandbox root parent', () => {
      const sandboxRoot = getSandboxRoot();
      const parentPath = path.dirname(sandboxRoot);
      
      expect(() => validateSandboxPath(parentPath, sandboxRoot)).toThrow('Path traversal detected');
    });
  });

  describe('resolveSandboxPath', () => {
    it('resolves relative path within sandbox', () => {
      const resolved = resolveSandboxPath(TEST_AGENT_ID, 'myfile.txt');
      
      expect(resolved).toBe(path.join(TEST_SANDBOX_ROOT, TEST_AGENT_ID, 'myfile.txt'));
    });

    it('resolves nested relative path within sandbox', () => {
      const resolved = resolveSandboxPath(TEST_AGENT_ID, 'subdir/file.txt');
      
      expect(resolved).toBe(path.join(TEST_SANDBOX_ROOT, TEST_AGENT_ID, 'subdir', 'file.txt'));
    });

    it('rejects path traversal attempts', () => {
      expect(() => resolveSandboxPath(TEST_AGENT_ID, '../../../etc/passwd')).toThrow('Path traversal detected');
    });

    it('rejects path escaping sandbox via .. segments', () => {
      expect(() => resolveSandboxPath(TEST_AGENT_ID, '../../other-agent/file.txt')).toThrow('Path traversal detected');
    });

    it('accepts safe relative paths', () => {
      expect(() => resolveSandboxPath(TEST_AGENT_ID, 'output/result.json')).not.toThrow();
      expect(() => resolveSandboxPath(TEST_AGENT_ID, 'downloads/attachment.pdf')).not.toThrow();
    });
  });
});
