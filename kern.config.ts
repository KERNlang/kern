/**
 * Kern Configuration
 *
 * Customize how Kern transpiles for your project.
 * This file is auto-loaded by the CLI from the project root.
 */

import type { KernConfig } from './src/config.js';

const config: KernConfig = {
  // Target framework (default: nextjs)
  target: 'nextjs',

  // i18n configuration
  i18n: {
    enabled: true,
    hookName: 'useTranslation',
    importPath: 'react-i18next',
    // Set to false to output raw strings without t() wrapping
  },

  // Component import mappings
  components: {
    // UI library imports (Icon, Button, etc.)
    uiLibrary: '@components/ui',
    // Where to find project components
    componentRoot: '@/components',
    // Custom component mappings (optional)
    // mappings: { SettingsSection: '@features/settings/components/layout/SettingsSection' }
  },

  // Color palette — maps hex values to Tailwind classes
  // Extend this with your project's design system colors
  colors: {
    // Zinc scale (dark theme)
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
    // Brand colors
    '#f97316': 'orange-500',
    '#ea580c': 'orange-600',
    // Add your project colors here
  },

  // Output configuration
  output: {
    // Directory for generated .tsx files (relative to project root)
    outDir: 'src/generated',
    // Generate source map .map files
    sourceMaps: true,
  },
};

export default config;
