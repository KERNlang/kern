import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { resolve } from 'path';
import type { ScanResult } from '../src/index.js';
import { formatScanSummary, generateConfigSource, scanProject } from '../src/index.js';

// ── Test Helpers ─────────────────────────────────────────────────────────

let testDir: string;
let testCounter = 0;

function createTestDir(): string {
  testCounter++;
  const dir = resolve(tmpdir(), `kern-scan-test-${process.pid}-${testCounter}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeJson(dir: string, name: string, data: unknown): void {
  writeFileSync(resolve(dir, name), JSON.stringify(data, null, 2));
}

function writeFile(dir: string, name: string, content: string): void {
  writeFileSync(resolve(dir, name), content);
}

afterEach(() => {
  if (testDir) {
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {}
  }
});

// ── Target Detection ─────────────────────────────────────────────────────

describe('scanProject — target detection', () => {
  it('detects Next.js → nextjs', () => {
    testDir = createTestDir();
    writeJson(testDir, 'package.json', { dependencies: { next: '^15.2.0', react: '^19.0.0' } });
    const result = scanProject(testDir);
    expect(result.config.target).toBe('nextjs');
  });

  it('detects Express → express', () => {
    testDir = createTestDir();
    writeJson(testDir, 'package.json', { dependencies: { express: '^4.18.0' } });
    const result = scanProject(testDir);
    expect(result.config.target).toBe('express');
  });

  it('detects React Native → native', () => {
    testDir = createTestDir();
    writeJson(testDir, 'package.json', { dependencies: { 'react-native': '^0.73.0', react: '^18.0.0' } });
    const result = scanProject(testDir);
    expect(result.config.target).toBe('native');
  });

  it('detects Tailwind (without Next.js) → tailwind', () => {
    testDir = createTestDir();
    writeJson(testDir, 'package.json', {
      dependencies: { react: '^18.0.0' },
      devDependencies: { tailwindcss: '^4.0.0' },
    });
    const result = scanProject(testDir);
    expect(result.config.target).toBe('tailwind');
  });

  it('detects React alone → web', () => {
    testDir = createTestDir();
    writeJson(testDir, 'package.json', { dependencies: { react: '^18.0.0' } });
    const result = scanProject(testDir);
    expect(result.config.target).toBe('web');
  });

  it('Next.js with Tailwind → nextjs (Next takes priority)', () => {
    testDir = createTestDir();
    writeJson(testDir, 'package.json', {
      dependencies: { next: '^15.0.0', react: '^19.0.0' },
      devDependencies: { tailwindcss: '^4.0.0' },
    });
    const result = scanProject(testDir);
    expect(result.config.target).toBe('nextjs');
  });

  it('detects Ink → ink (not web, even though react is a dep)', () => {
    testDir = createTestDir();
    writeJson(testDir, 'package.json', {
      dependencies: { ink: '^5.0.0', react: '^18.0.0' },
    });
    const result = scanProject(testDir);
    expect(result.config.target).toBe('ink');
  });

  it('detects Vue → vue', () => {
    testDir = createTestDir();
    writeJson(testDir, 'package.json', { dependencies: { vue: '^3.4.0' } });
    const result = scanProject(testDir);
    expect(result.config.target).toBe('vue');
  });

  it('detects Nuxt → nuxt (not vue, even though vue is a dep)', () => {
    testDir = createTestDir();
    writeJson(testDir, 'package.json', {
      dependencies: { nuxt: '^3.10.0', vue: '^3.4.0' },
    });
    const result = scanProject(testDir);
    expect(result.config.target).toBe('nuxt');
  });

  it('detects FastAPI from pyproject.toml', () => {
    testDir = createTestDir();
    writeJson(testDir, 'package.json', { dependencies: {} });
    writeFile(
      testDir,
      'pyproject.toml',
      `[project]\nname = "my-api"\ndependencies = ["fastapi>=0.110.0", "uvicorn"]\n`,
    );
    const result = scanProject(testDir);
    expect(result.config.target).toBe('fastapi');
  });

  it('detects FastAPI from requirements.txt', () => {
    testDir = createTestDir();
    writeJson(testDir, 'package.json', { dependencies: {} });
    writeFile(testDir, 'requirements.txt', 'fastapi>=0.110.0\nuvicorn\npydantic\n');
    const result = scanProject(testDir);
    expect(result.config.target).toBe('fastapi');
  });

  it('Node.js target takes priority over Python (mixed project)', () => {
    testDir = createTestDir();
    writeJson(testDir, 'package.json', { dependencies: { express: '^4.18.0' } });
    writeFile(testDir, 'requirements.txt', 'fastapi>=0.110.0\n');
    const result = scanProject(testDir);
    expect(result.config.target).toBe('express');
  });
});

// ── Framework Versions ───────────────────────────────────────────────────

describe('scanProject — framework versions', () => {
  it('extracts exact semver from deps', () => {
    testDir = createTestDir();
    writeJson(testDir, 'package.json', {
      dependencies: { next: '^15.2.0' },
      devDependencies: { tailwindcss: '^4.0.0' },
    });
    const result = scanProject(testDir);
    expect(result.config.frameworkVersions?.nextjs).toBe('^15.2.0');
    expect(result.config.frameworkVersions?.tailwind).toBe('^4.0.0');
  });
});

// ── i18n Detection ───────────────────────────────────────────────────────

describe('scanProject — i18n', () => {
  it('detects react-i18next → useTranslation', () => {
    testDir = createTestDir();
    writeJson(testDir, 'package.json', {
      dependencies: { react: '^18.0.0', 'react-i18next': '^14.0.0' },
    });
    const result = scanProject(testDir);
    expect(result.config.i18n).toEqual({ enabled: true, hookName: 'useTranslation', importPath: 'react-i18next' });
  });

  it('detects next-intl → useTranslations', () => {
    testDir = createTestDir();
    writeJson(testDir, 'package.json', {
      dependencies: { next: '^15.0.0', 'next-intl': '^3.0.0' },
    });
    const result = scanProject(testDir);
    expect(result.config.i18n).toEqual({ enabled: true, hookName: 'useTranslations', importPath: 'next-intl' });
  });

  it('sets i18n disabled when no i18n library found', () => {
    testDir = createTestDir();
    writeJson(testDir, 'package.json', { dependencies: { react: '^18.0.0' } });
    const result = scanProject(testDir);
    expect(result.config.i18n).toEqual({ enabled: false });
  });
});

// ── UI Library Detection ─────────────────────────────────────────────────

describe('scanProject — UI library', () => {
  it('detects shadcn via components.json', () => {
    testDir = createTestDir();
    writeJson(testDir, 'package.json', { dependencies: { react: '^18.0.0' } });
    writeJson(testDir, 'components.json', { style: 'default' });
    const result = scanProject(testDir);
    expect(result.config.components?.uiLibrary).toBe('@/components/ui');
  });

  it('detects MUI', () => {
    testDir = createTestDir();
    writeJson(testDir, 'package.json', { dependencies: { react: '^18.0.0', '@mui/material': '^5.0.0' } });
    const result = scanProject(testDir);
    expect(result.config.components?.uiLibrary).toBe('@mui/material');
  });

  it('detects Chakra UI', () => {
    testDir = createTestDir();
    writeJson(testDir, 'package.json', { dependencies: { react: '^18.0.0', '@chakra-ui/react': '^2.0.0' } });
    const result = scanProject(testDir);
    expect(result.config.components?.uiLibrary).toBe('@chakra-ui/react');
  });
});

// ── tsconfig.json ────────────────────────────────────────────────────────

describe('scanProject — tsconfig', () => {
  it('extracts strict mode and path aliases', () => {
    testDir = createTestDir();
    writeJson(testDir, 'package.json', { dependencies: { react: '^18.0.0' } });
    writeJson(testDir, 'tsconfig.json', {
      compilerOptions: {
        strict: true,
        paths: { '@/*': ['./src/*'] },
      },
    });
    const result = scanProject(testDir);
    expect(result.info.typescript?.strict).toBe(true);
    expect(result.info.typescript?.pathAliases).toEqual({ '@/*': ['./src/*'] });
    expect(result.config.components?.componentRoot).toBe('@/components');
  });

  it('handles tsconfig with comments', () => {
    testDir = createTestDir();
    writeJson(testDir, 'package.json', { dependencies: {} });
    writeFile(
      testDir,
      'tsconfig.json',
      `{
      // This is a comment
      "compilerOptions": {
        "strict": true,
        "module": "es2022",
      }
    }`,
    );
    const result = scanProject(testDir);
    expect(result.info.typescript?.strict).toBe(true);
    expect(result.info.typescript?.module).toBe('es2022');
  });

  it('follows extends one level', () => {
    testDir = createTestDir();
    writeJson(testDir, 'package.json', { dependencies: {} });
    writeJson(testDir, 'tsconfig.base.json', {
      compilerOptions: { strict: true, module: 'es2022' },
    });
    writeJson(testDir, 'tsconfig.json', {
      extends: './tsconfig.base.json',
      compilerOptions: { paths: { '@/*': ['./src/*'] } },
    });
    const result = scanProject(testDir);
    expect(result.info.typescript?.strict).toBe(true);
    expect(result.info.typescript?.module).toBe('es2022');
    expect(result.info.typescript?.pathAliases).toEqual({ '@/*': ['./src/*'] });
  });
});

// ── Prettier ─────────────────────────────────────────────────────────────

describe('scanProject — prettier', () => {
  it('extracts formatting config from .prettierrc', () => {
    testDir = createTestDir();
    writeJson(testDir, 'package.json', { dependencies: {} });
    writeJson(testDir, '.prettierrc', { semi: false, singleQuote: true, tabWidth: 4, trailingComma: 'all' });
    const result = scanProject(testDir);
    expect(result.info.formatting).toEqual({
      semicolons: false,
      singleQuote: true,
      tabWidth: 4,
      trailingComma: 'all',
    });
  });
});

// ── EditorConfig ─────────────────────────────────────────────────────────

describe('scanProject — editorconfig', () => {
  it('extracts indent style and size', () => {
    testDir = createTestDir();
    writeJson(testDir, 'package.json', { dependencies: {} });
    writeFile(
      testDir,
      '.editorconfig',
      `root = true

[*]
indent_style = tab
indent_size = 4

[*.md]
indent_style = space
indent_size = 2
`,
    );
    const result = scanProject(testDir);
    expect(result.info.editorConfig).toEqual({ indentStyle: 'tab', indentSize: 4 });
  });
});

// ── Express Extras ───────────────────────────────────────────────────────

describe('scanProject — express extras', () => {
  it('detects helmet and compression', () => {
    testDir = createTestDir();
    writeJson(testDir, 'package.json', {
      dependencies: { express: '^4.18.0', helmet: '^7.0.0', compression: '^1.7.0' },
    });
    const result = scanProject(testDir);
    expect(result.config.express?.helmet).toBe(true);
    expect(result.config.express?.compression).toBe(true);
  });
});

// ── Package Manager Detection ────────────────────────────────────────────

describe('scanProject — package manager', () => {
  it('detects pnpm from lockfile', () => {
    testDir = createTestDir();
    writeJson(testDir, 'package.json', { dependencies: {} });
    writeFile(testDir, 'pnpm-lock.yaml', 'lockfileVersion: 9');
    const result = scanProject(testDir);
    expect(result.info.packageManager).toBe('pnpm');
  });

  it('detects yarn from lockfile', () => {
    testDir = createTestDir();
    writeJson(testDir, 'package.json', { dependencies: {} });
    writeFile(testDir, 'yarn.lock', '# yarn lockfile v1');
    const result = scanProject(testDir);
    expect(result.info.packageManager).toBe('yarn');
  });

  it('detects npm from lockfile', () => {
    testDir = createTestDir();
    writeJson(testDir, 'package.json', { dependencies: {} });
    writeJson(testDir, 'package-lock.json', { lockfileVersion: 3 });
    const result = scanProject(testDir);
    expect(result.info.packageManager).toBe('npm');
  });
});

// ── Config Generation ────────────────────────────────────────────────────

describe('generateConfigSource', () => {
  it('produces valid TypeScript with non-default fields only', () => {
    const result: ScanResult = {
      config: {
        target: 'nextjs',
        frameworkVersions: { nextjs: '^15.2.0', tailwind: '^4.0.0' },
        i18n: { enabled: false },
      },
      info: { packageManager: 'pnpm', typescript: null, formatting: null, editorConfig: null, typeLibraries: [] },
      detections: [],
    };
    const source = generateConfigSource(result);
    expect(source).toContain("import type { KernConfig } from '@kernlang/core'");
    expect(source).toContain("target: 'nextjs'");
    expect(source).toContain("nextjs: '^15.2.0'");
    expect(source).toContain("tailwind: '^4.0.0'");
    expect(source).toContain('i18n: { enabled: false }');
    expect(source).toContain('export default config');
  });

  it('emits next-intl i18n config correctly', () => {
    const result: ScanResult = {
      config: { target: 'nextjs', i18n: { enabled: true, hookName: 'useTranslations', importPath: 'next-intl' } },
      info: { packageManager: null, typescript: null, formatting: null, editorConfig: null, typeLibraries: [] },
      detections: [],
    };
    const source = generateConfigSource(result);
    expect(source).toContain("hookName: 'useTranslations'");
    expect(source).toContain("importPath: 'next-intl'");
  });

  it('emits express config', () => {
    const result: ScanResult = {
      config: { target: 'express', express: { helmet: true, compression: true } },
      info: { packageManager: null, typescript: null, formatting: null, editorConfig: null, typeLibraries: [] },
      detections: [],
    };
    const source = generateConfigSource(result);
    expect(source).toContain('helmet: true');
    expect(source).toContain('compression: true');
  });
});

// ── Summary Formatter ────────────────────────────────────────────────────

describe('formatScanSummary', () => {
  it('groups detections by source and uses markers', () => {
    const result: ScanResult = {
      config: { target: 'nextjs' },
      info: { packageManager: 'pnpm', typescript: null, formatting: null, editorConfig: null, typeLibraries: [] },
      detections: [
        { source: 'package.json', field: 'target', value: 'nextjs', confidence: 'high' },
        { source: 'pnpm-lock.yaml', field: 'info.packageManager', value: 'pnpm', confidence: 'high' },
      ],
    };
    const summary = formatScanSummary(result);
    expect(summary).toContain('package.json');
    expect(summary).toContain('target: nextjs');
    expect(summary).toContain('pnpm-lock.yaml');
  });

  it('shows empty state when no detections', () => {
    const result: ScanResult = {
      config: {},
      info: { packageManager: null, typescript: null, formatting: null, editorConfig: null, typeLibraries: [] },
      detections: [],
    };
    const summary = formatScanSummary(result);
    expect(summary).toContain('No project configuration detected');
  });
});

// ── Graceful Failure ─────────────────────────────────────────────────────

describe('scanProject — graceful failure', () => {
  it('handles missing package.json', () => {
    testDir = createTestDir();
    const result = scanProject(testDir);
    expect(result.config.target).toBeUndefined();
    expect(result.detections).toEqual([]);
  });

  it('handles invalid JSON in package.json', () => {
    testDir = createTestDir();
    writeFile(testDir, 'package.json', '{ invalid json }');
    const result = scanProject(testDir);
    expect(result.config.target).toBeUndefined();
  });

  it('handles invalid tsconfig.json', () => {
    testDir = createTestDir();
    writeJson(testDir, 'package.json', { dependencies: {} });
    writeFile(testDir, 'tsconfig.json', 'not valid json at all');
    const result = scanProject(testDir);
    expect(result.info.typescript).toBeNull();
  });
});

// ── Type Libraries (report only) ─────────────────────────────────────────

describe('scanProject — type libraries', () => {
  it('reports zod and prisma', () => {
    testDir = createTestDir();
    writeJson(testDir, 'package.json', {
      dependencies: { react: '^18.0.0', zod: '^3.22.0', '@prisma/client': '^5.0.0' },
    });
    const result = scanProject(testDir);
    expect(result.info.typeLibraries).toContain('zod');
    expect(result.info.typeLibraries).toContain('@prisma/client');
  });
});
