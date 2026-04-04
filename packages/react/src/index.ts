/**
 * @kernlang/react — React transpilers (Tailwind, Next.js, Web) + React codegen
 */

export { buildStructuredArtifacts } from './artifact-utils.js';
export { generateEffect, generateProvider, generateReactNode, isReactNode } from './codegen-react.js';
export type { ExtractedHook, NodeRole, PlannedFile, StructurePlan } from './structure.js';
export { classifyNode, planStructure } from './structure.js';
export { transpileNextjs } from './transpiler-nextjs.js';
export { transpileTailwind } from './transpiler-tailwind.js';
export { transpileWeb } from './transpiler-web.js';
