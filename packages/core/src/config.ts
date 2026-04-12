/**
 * Kern Configuration Types
 */

import { KernConfigError } from './errors.js';
import { DEFAULT_COLORS } from './styles-tailwind.js';
import type { IRNode } from './types.js';

export type KernTarget =
  | 'auto'
  | 'lib'
  | 'nextjs'
  | 'tailwind'
  | 'web'
  | 'native'
  | 'express'
  | 'cli'
  | 'terminal'
  | 'ink'
  | 'vue'
  | 'nuxt'
  | 'fastapi'
  | 'mcp';

/** Concrete transpiler targets (displayed to users). */
export const VALID_TARGETS: KernTarget[] = [
  'lib',
  'nextjs',
  'tailwind',
  'web',
  'native',
  'express',
  'cli',
  'terminal',
  'ink',
  'vue',
  'nuxt',
  'fastapi',
  'mcp',
];

/** All accepted target values including meta-targets like 'auto'. */
export const ALL_TARGETS: KernTarget[] = ['auto', ...VALID_TARGETS];

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
    prisma?: {
      provider?: 'postgresql' | 'mysql' | 'sqlite' | 'sqlserver' | 'mongodb';
    };
  };

  fastapi?: {
    security?: 'strict' | 'relaxed';
    cors?: boolean;
    gzip?: boolean;
    uvicorn?: { host?: string; reload?: boolean; workers?: number };
  };

  review?: {
    /** Show confidence scores in review output (default: false) */
    showConfidence?: boolean;
    /** Minimum confidence for findings to count in enforcement (default: 0) */
    minConfidence?: number;
    /** Maximum cognitive complexity allowed (default: 15) */
    maxComplexity?: number;
    /** Rule IDs to disable project-wide */
    disabledRules?: string[];
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
    prisma: {
      provider: 'postgresql' | 'mysql' | 'sqlite' | 'sqlserver' | 'mongodb';
    };
  };

  fastapi: {
    security: 'strict' | 'relaxed';
    cors: boolean;
    gzip: boolean;
    uvicorn: { host: string; reload: boolean; workers?: number };
  };

  review: {
    showConfidence: boolean;
    minConfidence: number;
    maxComplexity: number;
    disabledRules: string[];
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
    prisma: {
      provider: 'postgresql',
    },
  },
  fastapi: {
    security: 'strict',
    cors: false,
    gzip: false,
    uvicorn: { host: '0.0.0.0', reload: false },
  },
  review: {
    showConfidence: false,
    minConfidence: 0,
    maxComplexity: 15,
    disabledRules: [],
  },
};

/**
 * Merge a partial user config with defaults to produce a fully resolved config.
 *
 * @param user - Partial config overrides. Omit for defaults.
 * @returns A deep-cloned {@link ResolvedKernConfig} with all fields populated.
 * @throws {KernConfigError} If `target` or `structure` values are not in the valid set.
 *
 * @example
 * ```ts
 * const cfg = resolveConfig({ target: 'express', express: { helmet: true } });
 * // cfg.target === 'express', cfg.i18n.enabled === true (default)
 * ```
 */
export function resolveConfig(user?: Partial<KernConfig>): ResolvedKernConfig {
  if (!user) return JSON.parse(JSON.stringify(DEFAULT_CONFIG));

  // Validate target
  if (user.target && !ALL_TARGETS.includes(user.target)) {
    throw new KernConfigError(`Valid targets: ${ALL_TARGETS.join(', ')}`, 'target', user.target);
  }

  // Validate structure
  if (user.structure && !VALID_STRUCTURES.includes(user.structure)) {
    throw new KernConfigError(`Valid structures: ${VALID_STRUCTURES.join(', ')}`, 'structure', user.structure);
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
      prisma: {
        provider: user.express?.prisma?.provider ?? DEFAULT_CONFIG.express.prisma.provider,
      },
    },
    fastapi: {
      security: user.fastapi?.security ?? DEFAULT_CONFIG.fastapi.security,
      cors: user.fastapi?.cors ?? DEFAULT_CONFIG.fastapi.cors,
      gzip: user.fastapi?.gzip ?? DEFAULT_CONFIG.fastapi.gzip,
      uvicorn: {
        host: user.fastapi?.uvicorn?.host ?? DEFAULT_CONFIG.fastapi.uvicorn.host,
        reload: user.fastapi?.uvicorn?.reload ?? DEFAULT_CONFIG.fastapi.uvicorn.reload,
        ...(user.fastapi?.uvicorn?.workers !== undefined ? { workers: user.fastapi.uvicorn.workers } : {}),
      },
    },
    review: {
      showConfidence: user.review?.showConfidence ?? DEFAULT_CONFIG.review.showConfidence,
      minConfidence: user.review?.minConfidence ?? DEFAULT_CONFIG.review.minConfidence,
      maxComplexity: user.review?.maxComplexity ?? DEFAULT_CONFIG.review.maxComplexity,
      disabledRules: user.review?.disabledRules ?? DEFAULT_CONFIG.review.disabledRules,
    },
  };
}

/**
 * Auto-detect the appropriate transpiler target from AST content.
 *
 * Inspects top-level node types to determine the best target:
 * - screen nodes → 'ink' (terminal UI)
 * - server/route/middleware → 'express'
 * - mcp/tool/resource → 'mcp'
 * - cli/command → 'cli'
 * - Otherwise → 'nextjs' (default)
 *
 * Examines screen target= props for explicit overrides.
 */
export function detectTarget(ast: IRNode): KernTarget {
  let hasScreen = false;
  let hasServer = false;
  let hasMcp = false;
  let hasCli = false;
  let screenTarget: string | undefined;

  // Walk the full tree — parse() may return a single node or a document wrapper,
  // and screen nodes may be nested or siblings. Check everything.
  function walk(node: IRNode): void {
    switch (node.type) {
      case 'screen': {
        hasScreen = true;
        const t = node.props?.target;
        if (typeof t === 'string') screenTarget = t;
        break;
      }
      case 'server':
      case 'route':
      case 'middleware':
        hasServer = true;
        break;
      case 'mcp':
      case 'tool':
      case 'resource':
        hasMcp = true;
        break;
      case 'cli':
      case 'command':
        hasCli = true;
        break;
    }
    for (const child of node.children || []) {
      walk(child);
    }
  }
  walk(ast);

  // Explicit screen target= takes priority
  if (screenTarget && VALID_TARGETS.includes(screenTarget as KernTarget)) {
    return screenTarget as KernTarget;
  }

  // Infer from content
  if (hasScreen) return 'ink';
  if (hasMcp) return 'mcp';
  if (hasServer) return 'express';
  if (hasCli) return 'cli';

  // No framework-specific nodes → plain TypeScript library output.
  // 'native' is React Native, 'nextjs' is a page scaffold — neither fits pure lib code.
  return 'lib';
}

/** @deprecated Use resolveConfig instead */
export function mergeConfig(user: Partial<KernConfig>): KernConfig {
  return resolveConfig(user);
}
