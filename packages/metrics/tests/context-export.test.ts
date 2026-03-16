import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

describe('Context Export', () => {
  describe('scanKernProject', () => {
    test('finds .kern files in project', async () => {
      const { scanKernProject } = await import('../src/context-export.js');
      const summary = scanKernProject(ROOT);

      expect(summary.kernFiles.length).toBeGreaterThanOrEqual(3);
      expect(summary.target).toBe('nextjs');
      expect(summary.metrics).not.toBeNull();
      expect(summary.metrics!.nodeCount).toBeGreaterThan(20);
    });

    test('returns null metrics for empty directory', async () => {
      const { scanKernProject } = await import('../src/context-export.js');
      const summary = scanKernProject(resolve(ROOT, 'packages/core/dist'));

      expect(summary.kernFiles).toEqual([]);
      expect(summary.metrics).toBeNull();
    });
  });

  describe('projectToKern', () => {
    test('produces Kern-format context block', async () => {
      const { scanKernProject, projectToKern } = await import('../src/context-export.js');
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
      const { projectToKern } = await import('../src/context-export.js');
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
