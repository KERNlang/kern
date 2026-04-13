import {
  applyTailwindTokenRules,
  buildNextjsProfile,
  buildTailwindProfile,
  buildVersionProfile,
  detectVersionsFromPackageJson,
  parseMajorVersion,
  resolveConfig,
  resolveNextjsMajor,
  resolveTailwindMajor,
} from '../src/index.js';

// ── Version Detection ────────────────────────────────────────────────────

describe('parseMajorVersion', () => {
  it('parses clean semver', () => {
    expect(parseMajorVersion('3.4.1')).toBe(3);
    expect(parseMajorVersion('4.0.0')).toBe(4);
    expect(parseMajorVersion('15.2.3')).toBe(15);
  });

  it('handles caret/tilde ranges', () => {
    expect(parseMajorVersion('^3.4.1')).toBe(3);
    expect(parseMajorVersion('~4.0.0')).toBe(4);
    expect(parseMajorVersion('>=14.0.0')).toBe(14);
  });

  it('returns 0 for invalid input', () => {
    expect(parseMajorVersion('latest')).toBe(0);
    expect(parseMajorVersion('')).toBe(0);
  });
});

describe('detectVersionsFromPackageJson', () => {
  it('detects tailwindcss from devDependencies', () => {
    const pkg = { devDependencies: { tailwindcss: '^3.4.1' } };
    const v = detectVersionsFromPackageJson(pkg);
    expect(v.tailwind).toBe('^3.4.1');
  });

  it('detects next from dependencies', () => {
    const pkg = { dependencies: { next: '^14.2.0' } };
    const v = detectVersionsFromPackageJson(pkg);
    expect(v.nextjs).toBe('^14.2.0');
  });

  it('detects both frameworks', () => {
    const pkg = {
      dependencies: { next: '15.0.0' },
      devDependencies: { tailwindcss: '4.0.0' },
    };
    const v = detectVersionsFromPackageJson(pkg);
    expect(v.tailwind).toBe('4.0.0');
    expect(v.nextjs).toBe('15.0.0');
  });

  it('returns empty for missing frameworks', () => {
    const pkg = { dependencies: { react: '^18.0.0' } };
    const v = detectVersionsFromPackageJson(pkg);
    expect(v.tailwind).toBeUndefined();
    expect(v.nextjs).toBeUndefined();
  });
});

describe('resolveTailwindMajor', () => {
  it('defaults to 3 when no version', () => {
    expect(resolveTailwindMajor({})).toBe(3);
  });
  it('resolves v3 for 3.x', () => {
    expect(resolveTailwindMajor({ tailwind: '^3.4.1' })).toBe(3);
  });
  it('resolves v4 for 4.x', () => {
    expect(resolveTailwindMajor({ tailwind: '4.0.0' })).toBe(4);
  });
});

describe('resolveNextjsMajor', () => {
  it('defaults to 14 when no version', () => {
    expect(resolveNextjsMajor({})).toBe(14);
  });
  it('resolves 13 for 13.x', () => {
    expect(resolveNextjsMajor({ nextjs: '^13.5.0' })).toBe(13);
  });
  it('resolves 14 for 14.x', () => {
    expect(resolveNextjsMajor({ nextjs: '14.2.0' })).toBe(14);
  });
  it('resolves 15 for 15.x', () => {
    expect(resolveNextjsMajor({ nextjs: '~15.0.0' })).toBe(15);
  });
  it('resolves 16 for 16.x', () => {
    expect(resolveNextjsMajor({ nextjs: '16.1.6' })).toBe(16);
  });
  it('resolves 16 for future versions', () => {
    expect(resolveNextjsMajor({ nextjs: '^16.2.2' })).toBe(16);
  });
});

// ── Version Adapters ─────────────────────────────────────────────────────

describe('buildTailwindProfile', () => {
  it('builds v3 profile with no token rules', () => {
    const profile = buildTailwindProfile({ tailwind: '^3.4.0' });
    expect(profile.major).toBe(3);
    expect(profile.tokenRules).toHaveLength(0);
    expect(profile.outputRules.useAtImport).toBe(false);
  });
  it('builds v4 profile with token rules', () => {
    const profile = buildTailwindProfile({ tailwind: '4.0.0' });
    expect(profile.major).toBe(4);
    expect(profile.tokenRules.length).toBeGreaterThan(0);
    expect(profile.outputRules.useAtImport).toBe(true);
  });
});

describe('applyTailwindTokenRules', () => {
  it('passes through classes in v3', () => {
    const profile = buildTailwindProfile({ tailwind: '3.4.0' });
    expect(applyTailwindTokenRules('bg-red-500 text-white flex-shrink-0', profile)).toBe(
      'bg-red-500 text-white flex-shrink-0',
    );
  });
  it('transforms flex-shrink to shrink in v4', () => {
    const profile = buildTailwindProfile({ tailwind: '4.0.0' });
    expect(applyTailwindTokenRules('flex-shrink-0', profile)).toBe('shrink-0');
  });
  it('transforms flex-grow to grow in v4', () => {
    const profile = buildTailwindProfile({ tailwind: '4.0.0' });
    expect(applyTailwindTokenRules('flex-grow', profile)).toBe('grow');
  });
  it('transforms overflow-ellipsis to text-ellipsis in v4', () => {
    const profile = buildTailwindProfile({ tailwind: '4.0.0' });
    expect(applyTailwindTokenRules('overflow-ellipsis', profile)).toBe('text-ellipsis');
  });
  it('transforms decoration-slice to box-decoration-slice in v4', () => {
    const profile = buildTailwindProfile({ tailwind: '4.0.0' });
    expect(applyTailwindTokenRules('decoration-slice', profile)).toBe('box-decoration-slice');
  });
  it('merges bg-opacity classes into slash syntax in v4', () => {
    const profile = buildTailwindProfile({ tailwind: '4.0.0' });
    expect(applyTailwindTokenRules('bg-red-500 bg-opacity-50', profile)).toBe('bg-red-500/50');
  });
  it('removes filter classes in v4', () => {
    const profile = buildTailwindProfile({ tailwind: '4.0.0' });
    expect(applyTailwindTokenRules('filter blur-lg', profile)).toBe('blur-lg');
  });
});

describe('buildNextjsProfile', () => {
  it('builds v13 profile', () => {
    const profile = buildNextjsProfile({ nextjs: '^13.5.0' });
    expect(profile.major).toBe(13);
    expect(profile.outputRules.metadataStyle).toBe('typed');
    expect(profile.outputRules.asyncServerComponents).toBe(false);
  });
  it('builds v14 profile', () => {
    const profile = buildNextjsProfile({ nextjs: '14.2.0' });
    expect(profile.major).toBe(14);
    expect(profile.outputRules.metadataStyle).toBe('typed');
    expect(profile.outputRules.asyncServerComponents).toBe(true);
  });
  it('builds v15 profile with satisfies metadata', () => {
    const profile = buildNextjsProfile({ nextjs: '15.0.0' });
    expect(profile.major).toBe(15);
    expect(profile.outputRules.metadataStyle).toBe('satisfies');
    expect(profile.outputRules.asyncServerComponents).toBe(true);
  });
  it('builds v16 profile with satisfies metadata and async server components', () => {
    const profile = buildNextjsProfile({ nextjs: '16.1.6' });
    expect(profile.major).toBe(16);
    expect(profile.outputRules.metadataStyle).toBe('satisfies');
    expect(profile.outputRules.asyncServerComponents).toBe(true);
    expect(profile.outputRules.useAppRouter).toBe(true);
  });
});

describe('buildVersionProfile', () => {
  it('builds combined profile', () => {
    const profile = buildVersionProfile({ tailwind: '4.0.0', nextjs: '15.0.0' });
    expect(profile.tailwind.major).toBe(4);
    expect(profile.nextjs.major).toBe(15);
  });
});

// ── Config Integration ───────────────────────────────────────────────────

describe('resolveConfig with frameworkVersions', () => {
  it('defaults to empty frameworkVersions', () => {
    const config = resolveConfig();
    expect(config.frameworkVersions).toEqual({});
  });
  it('passes through user frameworkVersions', () => {
    const config = resolveConfig({
      frameworkVersions: { tailwind: '4.0.0', nextjs: '15.0.0' },
    });
    expect(config.frameworkVersions.tailwind).toBe('4.0.0');
    expect(config.frameworkVersions.nextjs).toBe('15.0.0');
  });
});
