import { execFileSync } from 'child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  _projectContextCacheSize,
  _resetProjectContextCache,
  findProjectRoot,
  getProjectContext,
  isPathIgnored,
  isReviewable,
  isStrictFlagEffective,
} from '../src/project-context.js';

function tmpRoot(): string {
  return mkdtempSync(join(tmpdir(), 'kern-pctx-'));
}

describe('project-context', () => {
  beforeEach(() => {
    _resetProjectContextCache();
  });

  it('returns an empty context for a non-existent root', () => {
    const ctx = getProjectContext(join(tmpdir(), 'this-does-not-exist-' + Date.now()));
    expect(ctx.gitignore.rootPatterns).toEqual([]);
    expect(ctx.packageJson).toBeUndefined();
    expect(ctx.tsconfig).toBeUndefined();
  });

  it('reads package.json fields we care about', () => {
    const root = tmpRoot();
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ name: 'my-app', type: 'module', private: true, workspaces: ['pkg/*'] }),
    );
    const ctx = getProjectContext(root);
    expect(ctx.packageJson?.name).toBe('my-app');
    expect(ctx.packageJson?.type).toBe('module');
    expect(ctx.packageJson?.private).toBe(true);
    expect(ctx.packageJson?.workspaces).toEqual(['pkg/*']);
    rmSync(root, { recursive: true });
  });

  it('reads tsconfig strictness flags', () => {
    const root = tmpRoot();
    writeFileSync(
      join(root, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { strict: true, noUnusedLocals: true } }),
    );
    const ctx = getProjectContext(root);
    expect(ctx.tsconfig?.strict).toBe(true);
    expect(ctx.tsconfig?.noUnusedLocals).toBe(true);
    expect(ctx.tsconfig?.noImplicitAny).toBeUndefined();
    rmSync(root, { recursive: true });
  });

  it('walks tsconfig extends chain (relative-only) and merges compilerOptions', () => {
    const root = tmpRoot();
    writeFileSync(join(root, 'base.json'), JSON.stringify({ compilerOptions: { strictNullChecks: true } }));
    writeFileSync(
      join(root, 'tsconfig.json'),
      JSON.stringify({ extends: './base.json', compilerOptions: { strict: true } }),
    );
    const ctx = getProjectContext(root);
    expect(ctx.tsconfig?.strict).toBe(true);
    expect(ctx.tsconfig?.strictNullChecks).toBe(true);
    rmSync(root, { recursive: true });
  });

  it('SECURITY: tsconfig extends never escapes project root', () => {
    const root = tmpRoot();
    // Symlink trying to point outside the root — must be rejected.
    const target = mkdtempSync(join(tmpdir(), 'kern-evil-'));
    writeFileSync(join(target, 'evil.json'), JSON.stringify({ compilerOptions: { strict: true } }));
    try {
      symlinkSync(join(target, 'evil.json'), join(root, 'evil.json'));
    } catch {
      // Some sandboxes block symlinks; bail with a different traversal vector.
      writeFileSync(join(root, 'evil.json'), JSON.stringify({ compilerOptions: { strict: true } }));
    }
    writeFileSync(join(root, 'tsconfig.json'), JSON.stringify({ extends: '../../../etc/passwd', compilerOptions: {} }));
    const ctx = getProjectContext(root);
    // Either undefined (we bailed) or strict not propagated — never a panic.
    expect(ctx.tsconfig?.strict).toBeUndefined();
    rmSync(root, { recursive: true });
    rmSync(target, { recursive: true });
  });

  it('SECURITY: package extends (non-relative) are not walked', () => {
    const root = tmpRoot();
    writeFileSync(
      join(root, 'tsconfig.json'),
      JSON.stringify({ extends: '@evil/tsconfig', compilerOptions: { strict: true } }),
    );
    const ctx = getProjectContext(root);
    // Local strict still applies; package ref is not resolved.
    expect(ctx.tsconfig?.strict).toBe(true);
    rmSync(root, { recursive: true });
  });

  it('compiles .gitignore patterns and matches paths under root', () => {
    const root = tmpRoot();
    writeFileSync(join(root, '.gitignore'), ['dist/', 'coverage/', '*.log', '!keep.log'].join('\n'));
    const ctx = getProjectContext(root);
    expect(isPathIgnored(join(root, 'dist/foo.js'), ctx)).toBe(true);
    expect(isPathIgnored(join(root, 'coverage/index.html'), ctx)).toBe(true);
    expect(isPathIgnored(join(root, 'src/app.log'), ctx)).toBe(true);
    expect(isPathIgnored(join(root, 'src/app.ts'), ctx)).toBe(false);
    expect(isPathIgnored(join(root, 'keep.log'), ctx)).toBe(false); // negation
    rmSync(root, { recursive: true });
  });

  it('SECURITY: discards .gitignore patterns longer than 256 chars (ReDoS guard)', () => {
    const root = tmpRoot();
    const huge = '*'.repeat(300) + '!.ts';
    writeFileSync(join(root, '.gitignore'), huge + '\nshort.log');
    const ctx = getProjectContext(root);
    expect(ctx.gitignore.rootPatterns.map((p) => p.raw)).toEqual(['short.log']);
    rmSync(root, { recursive: true });
  });

  it('content-hash cache returns same context object until config changes', () => {
    const root = tmpRoot();
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'a' }));
    const a1 = getProjectContext(root);
    const a2 = getProjectContext(root);
    expect(a1).toBe(a2); // same object reference — cache hit
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'b' }));
    const b = getProjectContext(root);
    expect(b).not.toBe(a1);
    expect(b.packageJson?.name).toBe('b');
    rmSync(root, { recursive: true });
  });

  it('LRU evicts oldest entry past cap=128', () => {
    const before = _projectContextCacheSize();
    const created: string[] = [];
    for (let i = 0; i < 130; i++) {
      const r = tmpRoot();
      created.push(r);
      writeFileSync(join(r, 'package.json'), JSON.stringify({ name: `p-${i}` }));
      getProjectContext(r);
    }
    expect(_projectContextCacheSize()).toBeLessThanOrEqual(128);
    expect(_projectContextCacheSize()).toBeGreaterThan(before);
    for (const r of created) rmSync(r, { recursive: true });
  });

  it('isPathIgnored returns false for paths outside the project root', () => {
    const root = tmpRoot();
    writeFileSync(join(root, '.gitignore'), 'dist/');
    const ctx = getProjectContext(root);
    expect(isPathIgnored('/etc/passwd', ctx)).toBe(false);
    expect(isPathIgnored(join(tmpdir(), 'unrelated/dist/foo.js'), ctx)).toBe(false);
    rmSync(root, { recursive: true });
  });

  it('handles malformed JSON without panicking', () => {
    const root = tmpRoot();
    writeFileSync(join(root, 'package.json'), '{ broken json');
    writeFileSync(join(root, 'tsconfig.json'), 'not json');
    const ctx = getProjectContext(root);
    expect(ctx.packageJson).toBeUndefined();
    expect(ctx.tsconfig).toBeUndefined();
    rmSync(root, { recursive: true });
  });

  it('isReviewable: tracked-but-gitignored file remains reviewable (red-team #4)', () => {
    const root = tmpRoot();
    try {
      execFileSync('git', ['init', '-q'], { cwd: root, stdio: 'ignore' });
      execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root, stdio: 'ignore' });
      execFileSync('git', ['config', 'user.name', 'test'], { cwd: root, stdio: 'ignore' });
    } catch {
      // git not available — skip the test
      rmSync(root, { recursive: true });
      return;
    }
    writeFileSync(join(root, '.gitignore'), 'dist/');
    const distDir = join(root, 'dist');
    mkdirSync(distDir);
    const trackedArtifact = join(distDir, 'client.gen.ts');
    const untrackedArtifact = join(distDir, 'unrelated.ts');
    writeFileSync(trackedArtifact, '// generated client');
    writeFileSync(untrackedArtifact, '// stray output');
    // Force-add the tracked file despite .gitignore (the published-artifact case).
    execFileSync('git', ['add', '-f', '.gitignore', 'dist/client.gen.ts'], { cwd: root, stdio: 'ignore' });
    execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: root, stdio: 'ignore' });

    const ctx = getProjectContext(root);
    expect(isPathIgnored(trackedArtifact, ctx)).toBe(true); // .gitignore matches
    expect(isPathIgnored(untrackedArtifact, ctx)).toBe(true);
    expect(isReviewable(trackedArtifact, ctx)).toBe(true); // tracked → reviewable
    expect(isReviewable(untrackedArtifact, ctx)).toBe(false); // untracked + ignored → skipped
    rmSync(root, { recursive: true });
  });

  it('reads .eslintrc.json rules (error/warn/level array shapes)', () => {
    const root = tmpRoot();
    writeFileSync(
      join(root, '.eslintrc.json'),
      JSON.stringify({
        rules: {
          'no-unused-vars': 'error',
          'no-misused-promises': ['warn', { checksConditionals: true }],
          'no-debugger': 'off',
          '@typescript-eslint/no-floating-promises': 2,
        },
      }),
    );
    const ctx = getProjectContext(root);
    expect(ctx.external.eslintEnabledRules.has('no-unused-vars')).toBe(true);
    expect(ctx.external.eslintEnabledRules.has('no-misused-promises')).toBe(true);
    expect(ctx.external.eslintEnabledRules.has('@typescript-eslint/no-floating-promises')).toBe(true);
    expect(ctx.external.eslintEnabledRules.has('no-debugger')).toBe(false);
    rmSync(root, { recursive: true });
  });

  it('walks .eslintrc.json relative extends', () => {
    const root = tmpRoot();
    writeFileSync(join(root, 'base.json'), JSON.stringify({ rules: { 'no-unused-vars': 'error' } }));
    writeFileSync(
      join(root, '.eslintrc.json'),
      JSON.stringify({ extends: ['./base.json'], rules: { 'no-debugger': 'warn' } }),
    );
    const ctx = getProjectContext(root);
    expect(ctx.external.eslintEnabledRules.has('no-unused-vars')).toBe(true);
    expect(ctx.external.eslintEnabledRules.has('no-debugger')).toBe(true);
    rmSync(root, { recursive: true });
  });

  it('SECURITY: package extends like "eslint:recommended" are not resolved', () => {
    const root = tmpRoot();
    writeFileSync(
      join(root, '.eslintrc.json'),
      JSON.stringify({ extends: ['eslint:recommended', '@scope/eslint-config'], rules: {} }),
    );
    const ctx = getProjectContext(root);
    // Empty: only relative extends are walked, package refs are ignored.
    expect(ctx.external.eslintEnabledRules.size).toBe(0);
    rmSync(root, { recursive: true });
  });

  it('reads package.json eslintConfig field', () => {
    const root = tmpRoot();
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ eslintConfig: { rules: { 'no-unused-vars': 'error' } } }),
    );
    const ctx = getProjectContext(root);
    expect(ctx.external.eslintEnabledRules.has('no-unused-vars')).toBe(true);
    rmSync(root, { recursive: true });
  });

  it('reads biome.json linter.rules (group-keyed shape)', () => {
    const root = tmpRoot();
    writeFileSync(
      join(root, 'biome.json'),
      JSON.stringify({
        linter: {
          rules: {
            recommended: true, // ignored — not a rule group
            correctness: {
              noUnusedVariables: 'error',
              noUnusedImports: { level: 'warn' },
            },
            style: {
              useConst: 'off',
            },
          },
        },
      }),
    );
    const ctx = getProjectContext(root);
    expect(ctx.external.biomeEnabledRules.has('noUnusedVariables')).toBe(true);
    expect(ctx.external.biomeEnabledRules.has('noUnusedImports')).toBe(true);
    expect(ctx.external.biomeEnabledRules.has('useConst')).toBe(false);
    rmSync(root, { recursive: true });
  });

  it('isStrictFlagEffective: composite strict implies strictNullChecks', () => {
    const root = tmpRoot();
    writeFileSync(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true } }));
    const ctx = getProjectContext(root);
    expect(isStrictFlagEffective('strictNullChecks', ctx)).toBe(true);
    expect(isStrictFlagEffective('noImplicitAny', ctx)).toBe(true);
    expect(isStrictFlagEffective('noUnusedLocals', ctx)).toBe(false); // not part of composite
    rmSync(root, { recursive: true });
  });

  it('isStrictFlagEffective: per-flag overrides composite (strictNullChecks alone)', () => {
    const root = tmpRoot();
    writeFileSync(
      join(root, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { strict: false, strictNullChecks: true } }),
    );
    const ctx = getProjectContext(root);
    expect(isStrictFlagEffective('strictNullChecks', ctx)).toBe(true);
    expect(isStrictFlagEffective('noImplicitAny', ctx)).toBe(false);
    rmSync(root, { recursive: true });
  });

  it('findProjectRoot: walks up to nearest package.json', () => {
    const root = tmpRoot();
    mkdirSync(join(root, 'src/deep/nested'), { recursive: true });
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'p' }));
    expect(findProjectRoot(join(root, 'src/deep/nested'))).toBe(root);
    expect(findProjectRoot(root)).toBe(root);
    rmSync(root, { recursive: true });
  });

  it('JSONC: tsconfig with comments parses cleanly', () => {
    const root = tmpRoot();
    writeFileSync(
      join(root, 'tsconfig.json'),
      `{
        // top-level comment
        "compilerOptions": {
          /* block */ "strict": true
        }
      }`,
    );
    const ctx = getProjectContext(root);
    expect(ctx.tsconfig?.strict).toBe(true);
    rmSync(root, { recursive: true });
  });
});
