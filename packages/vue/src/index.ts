/**
 * @kern/vue — Vue 3 SFC + Nuxt 3 transpilers + Vue codegen
 */
export { transpileVue } from './transpiler-vue.js';
export { transpileNuxt } from './transpiler-nuxt.js';
export {
  generateVueProvider,
  generateVueEffect,
  generateVueHook,
  generateVueNode,
  isVueNode,
} from './codegen-vue.js';
