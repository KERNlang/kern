/**
 * @kernlang/react — React transpilers (Tailwind, Next.js, Web) + React codegen
 */
export { transpileTailwind } from './transpiler-tailwind.js';
export { transpileNextjs } from './transpiler-nextjs.js';
export { transpileWeb } from './transpiler-web.js';
export { planStructure, classifyNode } from './structure.js';
export type { StructurePlan, PlannedFile, NodeRole, ExtractedHook } from './structure.js';
export { buildStructuredArtifacts } from './artifact-utils.js';
export { generateProvider, generateEffect, generateReactNode, isReactNode } from './codegen-react.js';
