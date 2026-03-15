/**
 * Kern Configuration Types
 */

export interface KernConfig {
  target?: 'nextjs' | 'tailwind' | 'web' | 'native';

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

export const DEFAULT_CONFIG: KernConfig = {
  target: 'nextjs',
  i18n: {
    enabled: true,
    hookName: 'useTranslation',
    importPath: 'react-i18next',
  },
  components: {
    uiLibrary: '@components/ui',
    componentRoot: '@/components',
  },
  colors: {
    '#09090b': 'zinc-950',
    '#18181b': 'zinc-900',
    '#27272a': 'zinc-800',
    '#3f3f46': 'zinc-700',
    '#52525b': 'zinc-600',
    '#71717a': 'zinc-500',
    '#a1a1aa': 'zinc-400',
    '#d4d4d8': 'zinc-300',
    '#e4e4e7': 'zinc-200',
    '#f4f4f5': 'zinc-100',
    '#fafafa': 'zinc-50',
    '#ffffff': 'white',
    '#fff': 'white',
    '#FFF': 'white',
    '#f97316': 'orange-500',
    '#ea580c': 'orange-600',
    '#F8F9FA': 'gray-50',
  },
  output: {
    outDir: '.',
    sourceMaps: false,
  },
};

export function mergeConfig(user: Partial<KernConfig>): KernConfig {
  return {
    target: user.target || DEFAULT_CONFIG.target,
    i18n: { ...DEFAULT_CONFIG.i18n, ...user.i18n },
    components: { ...DEFAULT_CONFIG.components, ...user.components },
    colors: { ...DEFAULT_CONFIG.colors, ...user.colors },
    output: { ...DEFAULT_CONFIG.output, ...user.output },
  };
}
