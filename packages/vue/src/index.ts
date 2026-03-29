/**
 * @kernlang/vue — Vue 3 SFC + Nuxt 3 transpilers + Vue Tailwind + codegen + structure planning
 */
export { transpileVue } from './transpiler-vue.js';
export { transpileNuxt } from './transpiler-nuxt.js';
export { transpileTailwindVue } from './transpiler-tailwind-vue.js';
export {
  generateVueProvider,
  generateVueEffect,
  generateVueHook,
  generateVueNode,
  isVueNode,
  isVueGroundNode,
  generateVueGroundNode,
} from './codegen-vue.js';
export {
  classifyNode,
  planVueStructure,
  adaptPlanForNuxt,
  extractComposables,
  generateStateComposableCode,
  generateLogicComposableCode,
  generateTypesCode,
  generateBarrelCode,
} from './structure-vue.js';
export type {
  NodeRole,
  PlannedFile,
  StructurePlan,
  BarrelExport,
  ExtractedComposable,
} from './structure-vue.js';
export { buildVueStructuredArtifacts } from './artifact-utils-vue.js';
export type { StructuredResult } from './artifact-utils-vue.js';
