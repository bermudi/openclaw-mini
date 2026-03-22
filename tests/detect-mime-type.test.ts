/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test';

const MIME_TYPE_MAP: Record<string, string> = {
  '.txt': 'text/plain',
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.tar': 'application/x-tar',
  '.gz': 'application/gzip',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.avi': 'video/x-msvideo',
  '.mov': 'video/quicktime',
};

function detectMimeType(filename: string, fallback?: string): string {
  const lastDot = filename.lastIndexOf('.');
  const ext = lastDot === -1 ? '' : filename.slice(lastDot).toLowerCase();
  return MIME_TYPE_MAP[ext] ?? fallback ?? 'application/octet-stream';
}

describe('detectMimeType', () => {
  test('detects common extensions', () => {
    expect(detectMimeType('document.pdf')).toBe('application/pdf');
    expect(detectMimeType('image.png')).toBe('image/png');
    expect(detectMimeType('photo.jpg')).toBe('image/jpeg');
    expect(detectMimeType('archive.zip')).toBe('application/zip');
    expect(detectMimeType('data.json')).toBe('application/json');
  });

  test('handles uppercase extensions', () => {
    expect(detectMimeType('image.PNG')).toBe('image/png');
    expect(detectMimeType('document.PDF')).toBe('application/pdf');
  });

  test('returns fallback when provided and no extension match', () => {
    expect(detectMimeType('Makefile', 'text/plain')).toBe('text/plain');
  });

  test('returns application/octet-stream for extensionless files', () => {
    expect(detectMimeType('Makefile')).toBe('application/octet-stream');
    expect(detectMimeType('.gitignore')).toBe('application/octet-stream');
    expect(detectMimeType('README')).toBe('application/octet-stream');
    expect(detectMimeType('file.')).toBe('application/octet-stream');
  });

  test('returns application/octet-stream for unknown extensions', () => {
    expect(detectMimeType('file.xyz')).toBe('application/octet-stream');
    expect(detectMimeType('file.123')).toBe('application/octet-stream');
  });

  test('uses fallback when extension not in map', () => {
    expect(detectMimeType('file.xyz', 'custom/type')).toBe('custom/type');
  });
});
