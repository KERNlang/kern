/**
 * Kern Configuration Types
 */

import { DEFAULT_COLORS } from './styles-tailwind.js';

export type KernTarget = 'nextjs' | 'tailwind' | 'web' | 'native';

export const VALID_TARGETS: KernTarget[] = ['nextjs', 'tailwind', 'web', 'native'];

export interface KernConfig {
  target?: KernTarget;

  i18n?: {
    enabled?: boolean;
    hookName?: string;
    importPath?: string;
  };

  components?: {
    uiLibrary?: string;
    componentRoot?: string;
    mappings?: Record<string, string>;
  };

  colors?: Record<string, string>;

  output?: {
    outDir?: string;
    sourceMaps?: boolean;
  };
}

/** Fully resolved config — all fields required, no optionals */
export interface ResolvedKernConfig {
  target: KernTarget;

  i18n: {
    enabled: boolean;
    hookName: string;
    importPath: string;
  };

  components: {
    uiLibrary: string;
    componentRoot: string;
    mappings: Record<string, string>;
  };

  colors: Record<string, string>;

  output: {
    outDir: string;
    sourceMaps: boolean;
  };
}

export const DEFAULT_CONFIG: ResolvedKernConfig = {
  target: 'nextjs',
  i18n: {
    enabled: true,
    hookName: 'useTranslation',
    importPath: 'react-i18next',
  },
  components: {
    uiLibrary: '@components/ui',
    componentRoot: '@/components',
    mappings: {},
  },
  colors: { ...DEFAULT_COLORS },
  output: {
    outDir: '.',
    sourceMaps: false,
  },
};

export function resolveConfig(user?: Partial<KernConfig>): ResolvedKernConfig {
  if (!user) return { ...DEFAULT_CONFIG };

  // Validate target
  if (user.target && !VALID_TARGETS.includes(user.target)) {
    throw new Error(`Unknown target: '${user.target}'. Valid targets: ${VALID_TARGETS.join(', ')}`);
  }

  return {
    target: user.target || DEFAULT_CONFIG.target,
    i18n: {
      enabled: user.i18n?.enabled ?? DEFAULT_CONFIG.i18n.enabled,
      hookName: user.i18n?.hookName ?? DEFAULT_CONFIG.i18n.hookName,
      importPath: user.i18n?.importPath ?? DEFAULT_CONFIG.i18n.importPath,
    },
    components: {
      uiLibrary: user.components?.uiLibrary ?? DEFAULT_CONFIG.components.uiLibrary,
      componentRoot: user.components?.componentRoot ?? DEFAULT_CONFIG.components.componentRoot,
      mappings: { ...DEFAULT_CONFIG.components.mappings, ...user.components?.mappings },
    },
    colors: { ...DEFAULT_CONFIG.colors, ...user.colors },
    output: {
      outDir: user.output?.outDir ?? DEFAULT_CONFIG.output.outDir,
      sourceMaps: user.output?.sourceMaps ?? DEFAULT_CONFIG.output.sourceMaps,
    },
  };
}

/** @deprecated Use resolveConfig instead */
export function mergeConfig(user: Partial<KernConfig>): KernConfig {
  return resolveConfig(user);
}
