// Phase 5c: SmartReadTool's large-file branch gained two structure-aware
// strategies (CodeCompressor, Kompress) tried before the pre-existing
// blunt `truncateContent` fallback — see `smart-read.ts`'s `read()` method
// for exactly where each sits. These tests exercise the REAL modules (no
// mocks), matching this codebase's own testing convention for the native
// compression layer (`src/native/*.test.ts`).
//
// Deliberately constructs `SmartReadTool` directly (not via
// `getSmartReadTool()`/`runSmartRead()`) — `server.test.ts`'s own header
// comment documents that `getSmartReadTool()` is a real module-level
// singleton that ignores later `cache` arguments, which would leak state
// across these tests if used here too.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CacheEngine } from '../../core/cache-engine.js';
import { TokenCounter } from '../../core/token-counter.js';
import { MetricsCollector } from '../../core/metrics.js';
import { SmartReadTool } from './smart-read.js';

let workDir: string;
let optiflowHome: string;
let previousOptiflowHome: string | undefined;
let cache: CacheEngine;
let tool: SmartReadTool;

beforeEach(() => {
  workDir = mkdtempSync(path.join(tmpdir(), 'optiflow-smart-read-test-work-'));
  optiflowHome = mkdtempSync(path.join(tmpdir(), 'optiflow-smart-read-test-home-'));
  previousOptiflowHome = process.env.OPTIFLOW_HOME;
  process.env.OPTIFLOW_HOME = optiflowHome;

  cache = new CacheEngine(path.join(optiflowHome, 'cache.db'), 100);
  tool = new SmartReadTool(cache, new TokenCounter(), new MetricsCollector());
});

afterEach(() => {
  try {
    cache.close();
  } catch {
    // Best-effort; matches server.test.ts's own Windows sqlite-cleanup note.
  }
  rmSync(workDir, { recursive: true, force: true });
  try {
    rmSync(optiflowHome, { recursive: true, force: true });
  } catch {
    // Best-effort (Windows can briefly hold sqlite WAL/shm files open).
  }
  if (previousOptiflowHome === undefined) {
    delete process.env.OPTIFLOW_HOME;
  } else {
    process.env.OPTIFLOW_HOME = previousOptiflowHome;
  }
});

/** A real, recognizable Python source file, well past both CodeCompressor's
 * `minTokensForCompression` (100) and whatever small `maxSize` a test below
 * passes, with function bodies long enough to actually get elided. */
function buildPythonFixture(functionCount: number): string {
  const parts = [
    'import os',
    'import sys',
    '',
    'class Widget:',
    '    """A widget."""',
    '',
  ];
  for (let i = 0; i < functionCount; i++) {
    parts.push(`    def compute_${i}(self, value):`);
    parts.push(`        """Computes something for ${i}."""`);
    parts.push(`        total = 0`);
    parts.push(`        for j in range(value):`);
    parts.push(`            total += j * ${i}`);
    parts.push(`            if total > 1000:`);
    parts.push(`                total -= 500`);
    parts.push(`        print(f"computed {total} for iteration ${i}")`);
    parts.push(`        return total`);
    parts.push('');
  }
  return parts.join('\n');
}

describe('SmartReadTool.read() — CodeCompressor wiring (large recognized-language files)', () => {
  it('uses CodeCompressor (not blunt truncation) for a large Python file, preserving imports/signatures', async () => {
    const filePath = path.join(workDir, 'widget.py');
    const content = buildPythonFixture(30);
    writeFileSync(filePath, content, 'utf8');

    // maxSize is chosen between CodeCompressor's real compressed output
    // size for this fixture (~4KB, verified empirically before writing
    // this test) and the raw file's size (~8.5KB) — large enough that the
    // code-compressed result fits WITHOUT a second truncation pass on top,
    // so this test isolates CodeCompressor's own behavior specifically.
    const result = await tool.read(filePath, { maxSize: 4500, enableCache: false, diffMode: false });

    expect(result.metadata.truncated).toBe(true);
    expect(result.metadata.compressionStrategy).toBe('code-compressed');
    // Real structural compression, not a mid-body byte cut: imports and the
    // first function's signature survive verbatim.
    expect(result.content).toContain('import os');
    expect(result.content).toContain('def compute_0');
    expect(result.content).toContain('lines omitted');
    expect(result.content.length).toBeLessThan(content.length);
    expect(result.metadata.tokensSaved).toBeGreaterThan(0);
  });

  it('falls back to the pre-existing head+tail truncation for a large file with NO recognizable language (unchanged behavior)', async () => {
    const filePath = path.join(workDir, 'notes.txt');
    // Plain prose — CodeCompressor's own `detectLanguage` genuinely returns
    // "unknown" for this (no code-like patterns at all), and Kompress is
    // disabled by default (`kompress.enabled: false`), so this must land
    // on EXACTLY the same truncation path as before Phase 5c.
    const line = 'This is a plain log/notes line with ordinary prose content, nothing code-like at all. ';
    const content = Array.from({ length: 200 }, (_, i) => `${i}: ${line}`).join('\n');
    writeFileSync(filePath, content, 'utf8');

    const result = await tool.read(filePath, { maxSize: 500, enableCache: false, diffMode: false });

    expect(result.metadata.truncated).toBe(true);
    expect(result.metadata.compressionStrategy).toBe('truncated');
    // `truncateContent`'s keepTop/keepBottom are LINE counts, not a strict
    // byte bound (pre-existing behavior, unrelated to this wiring) — so the
    // real assertion here is "substantially smaller than the original and
    // clearly not the AST-aware/kompressed path," not an exact byte cap.
    expect(result.content.length).toBeLessThan(content.length);
  });

  it('falls back to truncation (never crashes) when Kompress is explicitly enabled but its model is not cached and downloads are not allowed', async () => {
    // Real integration exercise of the fail-open path end to end: no
    // mocking of compressWithKompress — this hits the real module, which
    // (per src/native/kompress-model.ts's own contract) returns
    // `available: false` without any network access since allowDownload
    // defaults to false. Requires a project config enabling kompress;
    // written directly since this test doesn't otherwise touch config
    // loading.
    writeFileSync(
      path.join(workDir, 'optiflow.config.json'),
      JSON.stringify({ kompress: { enabled: true, allowDownload: false } }),
      'utf8'
    );
    // loadConfig() resolves the project root by walking up from cwd via a
    // `.git`/`optiflow.config.json` marker — creating one right in workDir
    // (which has neither ambient) makes workDir itself the resolved root.
    const originalCwd = process.cwd();
    process.chdir(workDir);
    try {
      const filePath = path.join(workDir, 'notes.txt');
      const line = 'Plain prose content for the kompress-declines-gracefully case. ';
      const content = Array.from({ length: 200 }, (_, i) => `${i}: ${line}`).join('\n');
      writeFileSync(filePath, content, 'utf8');

      await expect(
        tool.read(filePath, { maxSize: 500, enableCache: false, diffMode: false })
      ).resolves.not.toThrow();

      const result = await tool.read(filePath, { maxSize: 500, enableCache: false, diffMode: false });
      expect(result.metadata.truncated).toBe(true);
      expect(result.metadata.compressionStrategy).toBe('truncated');
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('still chunks (not truncates) a medium-sized file within maxSize but above chunkSize — pre-existing behavior untouched', async () => {
    const filePath = path.join(workDir, 'medium.txt');
    const content = 'x'.repeat(6000);
    writeFileSync(filePath, content, 'utf8');

    const result = await tool.read(filePath, {
      maxSize: 100000,
      chunkSize: 4000,
      enableCache: false,
      diffMode: false,
    });

    expect(result.metadata.chunked).toBe(true);
    expect(result.metadata.truncated).toBe(false);
    expect(result.metadata.compressionStrategy).toBeUndefined();
  });

  it('leaves a small recognizable-language file completely unaffected (below maxSize, never enters the large-file branch)', async () => {
    const filePath = path.join(workDir, 'tiny.py');
    const content = 'import os\n\ndef f():\n    return 1\n';
    writeFileSync(filePath, content, 'utf8');

    const result = await tool.read(filePath, { enableCache: false, diffMode: false });
    expect(result.content).toBe(content);
    expect(result.metadata.truncated).toBe(false);
    expect(result.metadata.compressionStrategy).toBeUndefined();
  });
});
