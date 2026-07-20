import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import {
  FORBIDDEN_PUBLIC_EXPORTS,
  inspectPackageDirectory,
  runCheck,
} from './check-core-runtime-internalization.mjs';

function fixture(t, overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), 'kern-core-runtime-quarantine-fixture-'));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  mkdirSync(join(root, 'dist'));
  const packageJson = {
    exports: { '.': { default: './dist/index.js', types: './dist/index.d.ts' } },
    main: './dist/index.js',
    name: '@kernlang/fixture',
    types: './dist/index.d.ts',
    ...overrides.packageJson,
  };
  writeFileSync(join(root, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`);
  writeFileSync(join(root, 'dist/index.js'), overrides.javascript ?? 'export const safe = true;\n');
  writeFileSync(join(root, 'dist/index.d.ts'), overrides.declarations ?? 'export declare const safe: true;\n');
  for (const [path, content] of Object.entries(overrides.files ?? {})) {
    const destination = join(root, path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, content);
  }
  return root;
}

test('packed core and compatibility roots pass the quarantine guard', () => {
  assert.doesNotThrow(() => runCheck());
});

test('guard rejects an exported core-runtime subpath', (t) => {
  const root = fixture(t, {
    packageJson: {
      exports: {
        '.': { default: './dist/index.js', types: './dist/index.d.ts' },
        './core-runtime': './dist/core-runtime/index.js',
      },
    },
  });
  assert.throws(() => inspectPackageDirectory(root, '@kernlang/fixture'), /core-runtime module/u);
});

test('guard rejects a core-runtime export key even when its target is innocuous', (t) => {
  const root = fixture(t, {
    packageJson: {
      exports: {
        '.': { default: './dist/index.js', types: './dist/index.d.ts' },
        './core-runtime-alias': './dist/index.js',
      },
    },
  });
  assert.throws(() => inspectPackageDirectory(root, '@kernlang/fixture'), /exports map key exposes/u);
});

test('guard rejects a core-runtime reference from either root entry', (t) => {
  const root = fixture(t, { javascript: "export * from './core-runtime/index.js';\n" });
  assert.throws(() => inspectPackageDirectory(root, '@kernlang/fixture'), /references the quarantined/u);
});

test('guard rejects a nested conditional export that aliases a core-runtime target', (t) => {
  const root = fixture(t, {
    packageJson: {
      exports: {
        '.': { default: './dist/index.js', types: './dist/index.d.ts' },
        './innocent-alias': {
          node: { import: './dist/core-runtime/index.js' },
        },
      },
    },
  });
  assert.throws(() => inspectPackageDirectory(root, '@kernlang/fixture'), /exposes a core-runtime module path/u);
});

test('guard rejects a transitive re-export into the quarantined module family', (t) => {
  const root = fixture(t, {
    javascript: "export * from './bridge.js';\n",
    files: {
      'dist/bridge.js': "export * from './core-runtime/index.js';\n",
    },
  });
  assert.throws(() => inspectPackageDirectory(root, '@kernlang/fixture'), /references the quarantined/u);
});

test('guard rejects a namespace re-export into the quarantined module family', (t) => {
  const root = fixture(t, { javascript: "export * as runtime from './core-runtime/index.js';\n" });
  assert.throws(() => inspectPackageDirectory(root, '@kernlang/fixture'), /references the quarantined/u);
});

test('guard fails closed on wildcard exports that could expose internal files', (t) => {
  const root = fixture(t, {
    packageJson: {
      exports: {
        '.': { default: './dist/index.js', types: './dist/index.d.ts' },
        './*': './dist/*.js',
      },
    },
  });
  assert.throws(() => inspectPackageDirectory(root, '@kernlang/fixture'), /wildcard exports are forbidden/u);
});

test('guard rejects bare and self-referenced core-runtime module specifiers', async (t) => {
  for (const specifier of ['@kernlang/core/core-runtime', 'some-core-runtime-package']) {
    await t.test(specifier, (specifierTest) => {
      const root = fixture(specifierTest, { javascript: `export * from '${specifier}';\n` });
      assert.throws(() => inspectPackageDirectory(root, '@kernlang/fixture'), /references the quarantined/u);
    });
  }
});

test('guard resolves package import aliases used by the public graph', (t) => {
  const root = fixture(t, {
    javascript: "export * from '#runtime-bridge';\n",
    packageJson: {
      imports: { '#runtime-bridge': './dist/core-runtime/index.js' },
    },
  });
  assert.throws(() => inspectPackageDirectory(root, '@kernlang/fixture'), /import alias exposes a core-runtime/u);
});

test('guard rejects quarantined symbols from JavaScript-only public exports', (t) => {
  const root = fixture(t, { javascript: 'export const createCoreRuntimeEnv = () => ({});\n' });
  assert.throws(() => inspectPackageDirectory(root, '@kernlang/fixture'), /exposes quarantined symbol/u);
});

test('guard rejects quarantined symbols re-exported under safe aliases', (t) => {
  const root = fixture(t, {
    javascript: 'const createCoreRuntimeEnv = () => ({});\nexport { createCoreRuntimeEnv as safe };\n',
  });
  assert.throws(() => inspectPackageDirectory(root, '@kernlang/fixture'), /exposes quarantined symbol/u);
});

test('guard rejects quarantined bindings exposed through default exports', async (t) => {
  for (const source of [
    { javascript: 'const createCoreRuntimeEnv = () => ({});\nexport default createCoreRuntimeEnv;\n' },
    {
      declarations:
        'declare const createCoreRuntimeEnv: () => unknown;\nexport default createCoreRuntimeEnv;\n',
    },
  ]) {
    await t.test(Object.keys(source)[0], (sourceTest) => {
      const root = fixture(sourceTest, source);
      assert.throws(() => inspectPackageDirectory(root, '@kernlang/fixture'), /exposes quarantined symbol/u);
    });
  }
});

test('guard rejects directory-valued public entry targets explicitly', (t) => {
  const root = fixture(t, { packageJson: { main: './dist' } });
  assert.throws(() => inspectPackageDirectory(root, '@kernlang/fixture'), /is not a regular file/u);
});

test('guard ignores quarantined symbol names in comments and string literals', (t) => {
  const root = fixture(t, {
    declarations: '/** createCoreRuntimeEnv is not exported. */\nexport declare const safe: true;\n',
    javascript: "// runCoreRuntime is not exported.\nexport const safe = 'KernValue';\n",
  });
  assert.doesNotThrow(() => inspectPackageDirectory(root, '@kernlang/fixture'));
});

test('guard rejects every formerly exported runtime-coupled symbol', async (t) => {
  for (const symbol of FORBIDDEN_PUBLIC_EXPORTS) {
    await t.test(symbol, (symbolTest) => {
      const root = fixture(symbolTest, { declarations: `export declare const ${symbol}: unknown;\n` });
      assert.throws(
        () => inspectPackageDirectory(root, '@kernlang/fixture'),
        new RegExp(`exposes quarantined symbol: ${symbol}`, 'u'),
      );
    });
  }
});

test('guard fails closed when a declared root entry is missing', (t) => {
  const root = fixture(t, { packageJson: { main: './dist/missing.js' } });
  assert.throws(() => inspectPackageDirectory(root, '@kernlang/fixture'), /packed public entry is missing/u);
});
