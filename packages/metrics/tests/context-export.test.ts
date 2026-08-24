import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, test } from '../../../scripts/node-test-compat.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

describe('Context Export', () => {
  describe('scanKernProject', () => {
    test('finds .kern files in project', async () => {
      const { scanKernProject } = await import('../dist/context-export.js');
      const summary = scanKernProject(ROOT);

      expect(summary.kernFiles.length).toBeGreaterThanOrEqual(3);
      expect(summary.target).toBe('nextjs');
      expect(summary.metrics).not.toBeNull();
      expect(summary.metrics!.nodeCount).toBeGreaterThan(20);
    });

    test('returns null metrics for empty directory', async () => {
      const { scanKernProject } = await import('../dist/context-export.js');
      const directory = mkdtempSync(join(tmpdir(), 'kern-metrics-empty-'));
      try {
        const summary = scanKernProject(directory);
        expect(summary.kernFiles).toEqual([]);
        expect(summary.metrics).toBeNull();
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    });
  });

  describe('projectToKern', () => {
    test('produces Kern-format context block', async () => {
      const { scanKernProject, projectToKern } = await import('../dist/context-export.js');
      const summary = scanKernProject(ROOT);
      const output = projectToKern(summary);

      expect(output).toContain('kern-project');
      expect(output).toContain('target: "nextjs"');
      expect(output).toContain('escapeRatio');
      expect(output).toContain('nodeTypes');
      expect(output).toContain('colors');
      expect(output).not.toContain('undefined');
    });

    test('handles empty project gracefully', async () => {
      const { projectToKern } = await import('../dist/context-export.js');
      const summary: any = {
        cwd: '/tmp/empty',
        target: 'tailwind',
        kernFiles: [],
        colorPalette: {},
        metrics: null,
      };
      const output = projectToKern(summary);

      expect(output).toContain('kern-project');
      expect(output).toContain('files: 0');
      expect(output).not.toContain('undefined');
    });
  });
});
