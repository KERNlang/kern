/**
 * @kernlang/vue — Vue 3 SFC + Nuxt 3 transpilers + Vue Tailwind + codegen + structure planning
 */

export type { StructuredResult } from './artifact-utils-vue.js';
export { buildVueStructuredArtifacts } from './artifact-utils-vue.js';
export {
  generateVueEffect,
  generateVueGroundNode,
  generateVueHook,
  generateVueNode,
  generateVueProvider,
  isVueGroundNode,
  isVueNode,
} from './codegen-vue.js';
export type {
  BarrelExport,
  ExtractedComposable,
  NodeRole,
  PlannedFile,
  StructurePlan,
} from './structure-vue.js';
export {
  adaptPlanForNuxt,
  classifyNode,
  extractComposables,
  generateBarrelCode,
  generateLogicComposableCode,
  generateStateComposableCode,
  generateTypesCode,
  planVueStructure,
} from './structure-vue.js';
export { transpileNuxt } from './transpiler-nuxt.js';
export { transpileTailwindVue } from './transpiler-tailwind-vue.js';
export { transpileVue } from './transpiler-vue.js';
