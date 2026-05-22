import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, test } from './node-test-compat.ts';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if ((specifier.startsWith('.') || specifier.startsWith('/')) && (specifier.endsWith('.js') || specifier.endsWith('.ts'))) {
      const parent = context.parentURL ? new URL(context.parentURL) : pathToFileURL(`${process.cwd()}/`);
      const candidate = specifier.startsWith('/')
        ? pathToFileURL(specifier).href
        : new URL(specifier, parent).href;

      const sourceFile = fileURLToPath(candidate);
      const sourceMatch = sourceFile.match(/^(.*\/packages\/[^/]+)\/src\/(.*)\.(?:js|ts)$/);
      if (sourceMatch && process.env.KERN_TEST_DIST === '1') {
        const distCandidate = pathToFileURL(`${sourceMatch[1]}/dist/${sourceMatch[2]}.js`).href;
        if (existsSync(fileURLToPath(distCandidate))) {
          return { shortCircuit: true, url: distCandidate };
        }
      }

      const tsCandidate = `${candidate.replace(/\.js$/, '.ts')}`;
      if (specifier.endsWith('.js') && existsSync(fileURLToPath(tsCandidate))) {
        return { shortCircuit: true, url: tsCandidate };
      }
    }

    return nextResolve(specifier, context);
  },
});

Object.assign(globalThis, {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  test,
});
