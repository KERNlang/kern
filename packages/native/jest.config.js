import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export default {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^@kernlang/core$': resolve(ROOT, 'packages/core/src/index.ts'),
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
  transformIgnorePatterns: [
    'node_modules/(?!@kernlang/)',
  ],
  testMatch: ['**/tests/**/*.test.ts'],
};
