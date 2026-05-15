/**
 * PR-5a — drift gate for `generated/contracts/registry.json`.
 *
 * Belt-and-suspenders. CI also runs `pnpm docs:contracts:check` adjacent to
 * `check:rule-coverage`, but jest catches the drift earlier (pre-push hook
 * runs `pnpm lint`, but a contributor who skipped the hook still sees the
 * failure in `pnpm test`). Two paths to red is cheap insurance.
 *
 * The test does not invoke the script — it reproduces the serializer's
 * output in-process and compares against the committed file. That keeps
 * the test independent of `dist/` freshness.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONTRACT_REGISTRY, registerAllContracts, serializeJson } from '../src/index.js';
import { _resetEachContractForTest } from '../src/ir/semantics/each.js';
import { _resetPrimitivesForTest } from '../src/ir/semantics/primitives.js';

// Jest is configured with ESM transforms (`--experimental-vm-modules`) so
// `__dirname` is not defined; derive it from `import.meta.url`.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REGISTRY_PATH = path.resolve(__dirname, '../../../generated/contracts/registry.json');

beforeEach(() => {
  CONTRACT_REGISTRY.clear();
  _resetEachContractForTest();
  _resetPrimitivesForTest();
});

afterEach(() => {
  CONTRACT_REGISTRY.clear();
  _resetEachContractForTest();
  _resetPrimitivesForTest();
});

describe('IR-semantics contract docs — drift', () => {
  it('generated/contracts/registry.json matches in-process serializer output', () => {
    registerAllContracts();
    const fresh = serializeJson(CONTRACT_REGISTRY);
    const onDisk = readFileSync(REGISTRY_PATH, 'utf-8');
    if (onDisk !== fresh) {
      throw new Error(
        `generated/contracts/registry.json is out of date. ` +
          `Run \`pnpm docs:contracts:check --fix\` and commit the result.`,
      );
    }
    expect(onDisk).toBe(fresh);
  });
});
