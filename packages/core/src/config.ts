/**
 * Kern Configuration Types
 */

import { DEFAULT_COLORS } from './styles-tailwind.js';

export type KernTarget = 'nextjs' | 'tailwind' | 'web' | 'native' | 'express' | 'cli' | 'terminal' | 'vue' | 'nuxt';

export const VALID_TARGETS: KernTarget[] = ['nextjs', 'tailwind', 'web', 'native', 'express', 'cli', 'terminal', 'vue', 'nuxt'];

export type KernStructure = 'flat' | 'bulletproof' | 'atomic' | 'kern';

export const VALID_STRUCTURES: KernStructure[] = ['flat', 'bulletproof', 'atomic', 'kern'];

export interface FrameworkVersions {
  tailwind?: string;
  nextjs?: string;
}

export type ExpressSecurityLevel = 'strict' | 'relaxed';

export interface KernConfig {
  target?: KernTarget;
  structure?: KernStructure;
  frameworkVersions?: FrameworkVersions;
  templates?: string[];

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

  express?: {
    security?: ExpressSecurityLevel;
    helmet?: boolean;
    compression?: boolean;
  };
}

/** Fully resolved config — all fields required, no optionals */
export interface ResolvedKernConfig {
  target: KernTarget;
  structure: KernStructure;
  frameworkVersions: FrameworkVersions;
  templates: string[];

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

  express: {
    security: ExpressSecurityLevel;
    helmet: boolean;
    compression: boolean;
  };
}

export const DEFAULT_CONFIG: ResolvedKernConfig = {
  target: 'nextjs',
  structure: 'flat',
  frameworkVersions: {},
  templates: [],
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
  express: {
    security: 'strict',
    helmet: false,
    compression: false,
  },
};

export function resolveConfig(user?: Partial<KernConfig>): ResolvedKernConfig {
  if (!user) return { ...DEFAULT_CONFIG };

  // Validate target
  if (user.target && !VALID_TARGETS.includes(user.target)) {
    throw new Error(`Unknown target: '${user.target}'. Valid targets: ${VALID_TARGETS.join(', ')}`);
  }

  // Validate structure
  if (user.structure && !VALID_STRUCTURES.includes(user.structure)) {
    throw new Error(`Unknown structure: '${user.structure}'. Valid structures: ${VALID_STRUCTURES.join(', ')}`);
  }

  return {
    target: user.target || DEFAULT_CONFIG.target,
    structure: user.structure || DEFAULT_CONFIG.structure,
    frameworkVersions: {
      ...DEFAULT_CONFIG.frameworkVersions,
      ...user.frameworkVersions,
    },
    templates: user.templates ?? DEFAULT_CONFIG.templates,
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
    express: {
      security: user.express?.security ?? DEFAULT_CONFIG.express.security,
      helmet: user.express?.helmet ?? DEFAULT_CONFIG.express.helmet,
      compression: user.express?.compression ?? DEFAULT_CONFIG.express.compression,
    },
  };
}

/** @deprecated Use resolveConfig instead */
export function mergeConfig(user: Partial<KernConfig>): KernConfig {
  return resolveConfig(user);
}
