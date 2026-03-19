/** Client-safe target definitions — no @kernlang/core import to avoid Node.js fs dependency */

export type PlaygroundTarget =
  | 'nextjs' | 'tailwind' | 'web' | 'native'
  | 'express' | 'fastapi' | 'terminal' | 'ink'
  | 'vue' | 'nuxt';

export const PLAYGROUND_TARGETS: PlaygroundTarget[] = [
  'nextjs', 'tailwind', 'web', 'native',
  'express', 'fastapi', 'terminal', 'ink',
  'vue', 'nuxt',
];

export const TARGET_LABELS: Record<PlaygroundTarget, string> = {
  nextjs: 'Next.js',
  tailwind: 'React + Tailwind',
  web: 'React Web',
  native: 'React Native',
  express: 'Express',
  fastapi: 'FastAPI',
  terminal: 'Terminal',
  ink: 'Ink',
  vue: 'Vue 3',
  nuxt: 'Nuxt 3',
};

export const TARGET_LANGUAGE: Record<PlaygroundTarget, string> = {
  nextjs: 'typescript',
  tailwind: 'typescript',
  web: 'typescript',
  native: 'typescript',
  express: 'typescript',
  fastapi: 'python',
  terminal: 'typescript',
  ink: 'typescript',
  vue: 'html',
  nuxt: 'html',
};
