import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export default {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  // Avoid over-saturating ts-jest ESM workers on large hosts or package-level
  // concurrent test runs, which can trip Jest's graceful-exit watchdog after
  // the full review suite completes.
  maxWorkers: 4,
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      useESM: true,
      tsconfig: {
        module: 'es2022',
        moduleResolution: 'bundler',
        rootDir: ROOT,
      },
    }],
  },
  testMatch: ['**/tests/**/*.test.ts'],
};
