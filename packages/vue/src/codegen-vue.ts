/**
 * Vue-specific codegen — generates Vue 3 Composition API code for
 * provider (provide/inject), effect (onMounted/watch), and hook (composable) nodes.
 *
 * Mirrors @kernlang/react/codegen-react.ts but outputs Vue instead of React/JSX.
 */

import type { IRNode } from '@kernlang/core';
import { parseParamList, getProps, getChildren, getFirstChild, dedent, handlerCode, emitIdentifier, emitTypeAnnotation, generateCoreNode } from '@kernlang/core';

// ── Provider → provide/inject ────────────────────────────────────────────
// provider name=Search type=UseSearchResult
//   prop name=initialQuery type=string
//   handler <<<
//     const value = useSearch({ query: initialQuery, category });
//   >>>
//
// Generates:
//   1. InjectionKey<UseSearchResult>
//   2. provide() composable wrapper (provideSearch)
//   3. inject() consumer composable (useSearchContext)

export function generateVueProvider(node: IRNode): string[] {
  const props = getProps(node);
  const name = emitIdentifier(props.name as string, 'Provider', node);
  const valueType = emitTypeAnnotation(props.type as string, 'unknown', node);
  const lines: string[] = [];

  lines.push("import type { InjectionKey } from 'vue';");
  lines.push("import { provide, inject } from 'vue';");
  lines.push('');

  // 1. Injection key
  lines.push(`export const ${name}Key: InjectionKey<${valueType}> = Symbol('${name}');`);
  lines.push('');

  // 2. Provider composable
  const propNodes = getChildren(node, 'prop');
  const paramParts: string[] = [];
  for (const prop of propNodes) {
    const pp = getProps(prop);
    const propName = emitIdentifier(pp.name as string, 'prop', prop);
    const propType = emitTypeAnnotation(pp.type as string, 'unknown', prop);
    const opt = pp.optional === 'true' || pp.optional === true ? '?' : '';
    paramParts.push(`${propName}${opt}: ${propType}`);
  }
  const paramStr = paramParts.length > 0 ? paramParts.join(', ') : '';

  lines.push(`export function provide${name}(${paramStr}): ${valueType} {`);
  const code = handlerCode(node);
  if (code) {
    for (const line of code.split('\n')) {
      lines.push(`  ${line}`);
    }
  }
  lines.push(`  provide(${name}Key, value);`);
  lines.push(`  return value;`);
  lines.push('}');
  lines.push('');

  // 3. Consumer composable
  lines.push(`export function use${name}Context(): ${valueType} {`);
  lines.push(`  const ctx = inject(${name}Key);`);
  lines.push(`  if (ctx === undefined) {`);
  lines.push(`    throw new Error('use${name}Context must be used within a component that calls provide${name}');`);
  lines.push(`  }`);
  lines.push(`  return ctx;`);
  lines.push('}');

  return lines;
}

// ── Effect → onMounted / watchEffect / watch ─────────────────────────────
// effect name=TrackingContainer once=true deps="entities,generator"
//   prop name=entities type="T[]"
//   handler <<<
//     generator(entities).then(event => trackPageLoadEvent(event));
//   >>>
//   cleanup <<<
//     abortCtrl.abort();
//   >>>
//
// Generates a composable function that uses onMounted or watch

export function generateVueEffect(node: IRNode): string[] {
  const props = getProps(node);
  const name = props.name as string;
  const generic = props.generic as string | undefined;
  const once = props.once === 'true' || props.once === true;
  const deps = props.deps as string || '';
  const lines: string[] = [];

  const cleanupNode = getFirstChild(node, 'cleanup');

  // Collect all imports upfront (no post-hoc mutation)
  const vueImports = new Set<string>();
  if (deps && !once) {
    vueImports.add('watch');
  } else {
    vueImports.add('onMounted');
    if (cleanupNode) vueImports.add('onUnmounted');
  }

  lines.push(`import { ${[...vueImports].sort().join(', ')} } from 'vue';`);
  lines.push('');

  // Generic type parameter
  const genericParam = generic ? `<${generic}>` : '';

  // Props interface
  const propNodes = getChildren(node, 'prop');
  lines.push(`export interface ${name}Props${genericParam} {`);
  for (const prop of propNodes) {
    const pp = getProps(prop);
    const opt = pp.optional === 'true' || pp.optional === true ? '?' : '';
    lines.push(`  ${pp.name}${opt}: ${pp.type};`);
  }
  lines.push('}');
  lines.push('');

  // Composable function
  const propNames = propNodes.map(pn => getProps(pn).name as string);
  const destructured = propNames.join(', ');
  lines.push(`export function use${name}${genericParam}({ ${destructured} }: ${name}Props${genericParam}) {`);

  const code = handlerCode(node);

  if (deps && !once) {
    // watch mode — immediate: true to match React useEffect behavior (run on mount)
    const depsArr = deps.split(',').map(d => d.trim());
    const watchSource = depsArr.length === 1 ? depsArr[0] : `[${depsArr.join(', ')}]`;

    // Vue watch cleanup uses onCleanup param, not return value
    const hasCleanup = !!cleanupNode;
    const cbParams = hasCleanup ? '_value, _oldValue, onCleanup' : '';
    lines.push(`  watch(${watchSource}, (${cbParams}) => {`);
    if (code) {
      for (const line of code.split('\n')) {
        lines.push(`    ${line}`);
      }
    }
    if (hasCleanup) {
      const cleanupCode = getProps(cleanupNode!).code as string || '';
      const cleanupDedented = dedent(cleanupCode);
      lines.push(`    onCleanup(() => {`);
      for (const line of cleanupDedented.split('\n')) {
        lines.push(`      ${line}`);
      }
      lines.push(`    });`);
    }
    lines.push(`  }, { immediate: true });`);
  } else {
    // onMounted mode
    lines.push(`  onMounted(() => {`);
    if (code) {
      for (const line of code.split('\n')) {
        lines.push(`    ${line}`);
      }
    }
    lines.push(`  });`);

    if (cleanupNode) {
      const cleanupCode = getProps(cleanupNode).code as string || '';
      const cleanupDedented = dedent(cleanupCode);
      lines.push(`  onUnmounted(() => {`);
      for (const line of cleanupDedented.split('\n')) {
        lines.push(`    ${line}`);
      }
      lines.push(`  });`);
    }
  }

  lines.push('}');

  return lines;
}

// ── Hook → Composable ────────────────────────────────────────────────────
// hook name=useSearch params="initialState:SearchState" returns=UseSearchResult
//   state name=query type=string init="initialState.query"
//   ref name=abortCtrl type=AbortController init="new AbortController()"
//   context name=env type=EnvConfig source=EnvContext
//   handler <<<
//     const { data } = useSWR(cacheKey, fetcher);
//   >>>
//   memo name=cacheKey deps="query,filters"
//   callback name=handleFilter params="field:string,value:string" deps="query"
//   effect deps="query"
//   returns names="articles:data?.articles,isLoading,handleFilter,cacheKey"
//
// → Vue 3 composable with ref, computed, watch instead of useState, useMemo, useCallback, useEffect

export function generateVueHook(node: IRNode): string[] {
  const props = getProps(node);
  const name = props.name as string;
  const params = props.params as string || '';
  const returnsType = props.returns as string | undefined;
  const lines: string[] = [];
  const vueImports = new Set<string>();

  const paramList = parseParamList(params);
  const retClause = returnsType ? `: ${returnsType}` : '';

  lines.push(`export function ${name}(${paramList})${retClause} {`);

  const children = getChildren(node);
  const returnsNode = children.find(c => c.type === 'returns');
  const ordered = children.filter(c => c.type !== 'returns');

  for (const child of ordered) {
    const cp = getProps(child);
    switch (child.type) {
      case 'state': {
        vueImports.add('ref');
        const sname = cp.name as string;
        const stype = cp.type as string || 'unknown';
        const sinit = cp.init as string || 'undefined';
        lines.push(`  const ${sname} = ref<${stype}>(${sinit});`);
        break;
      }
      case 'ref': {
        vueImports.add('ref');
        const rname = cp.name as string;
        const rtype = cp.type as string || 'unknown';
        const rinit = cp.init as string || 'null';
        lines.push(`  const ${rname} = ref<${rtype}>(${rinit});`);
        break;
      }
      case 'context': {
        vueImports.add('inject');
        const cname = cp.name as string;
        const csource = cp.source as string;
        lines.push(`  const ${cname} = inject(${csource});`);
        break;
      }
      case 'handler': {
        const hcode = cp.code as string || '';
        const hDedented = dedent(hcode);
        for (const line of hDedented.split('\n')) {
          lines.push(`  ${line}`);
        }
        break;
      }
      case 'memo': {
        vueImports.add('computed');
        const mname = cp.name as string;
        const mcode = handlerCode(child);
        lines.push(`  const ${mname} = computed(() => {`);
        if (mcode) {
          for (const line of mcode.split('\n')) {
            lines.push(`    ${line}`);
          }
        }
        lines.push(`  });`);
        break;
      }
      case 'callback': {
        // Vue doesn't need useCallback — just a plain function
        const cbname = cp.name as string;
        const cbparams = cp.params as string || '';
        const cbcode = handlerCode(child);
        const cbParamList = parseParamList(cbparams);
        lines.push(`  function ${cbname}(${cbParamList}) {`);
        if (cbcode) {
          for (const line of cbcode.split('\n')) {
            lines.push(`    ${line}`);
          }
        }
        lines.push(`  }`);
        break;
      }
      case 'effect': {
        const edeps = cp.deps as string || '';
        const ecode = handlerCode(child);
        const effectCleanup = getFirstChild(child, 'cleanup');
        if (edeps) {
          vueImports.add('watch');
          const depsArr = edeps.split(',').map(d => d.trim());
          const watchSource = depsArr.length === 1 ? depsArr[0] : `[${depsArr.join(', ')}]`;
          const watchCbParams = effectCleanup ? '_value, _oldValue, onCleanup' : '';
          lines.push(`  watch(${watchSource}, (${watchCbParams}) => {`);
        } else {
          vueImports.add('onMounted');
          lines.push(`  onMounted(() => {`);
        }
        if (ecode) {
          for (const line of ecode.split('\n')) {
            lines.push(`    ${line}`);
          }
        }
        // Cleanup — Vue watch uses onCleanup param, onMounted uses return
        if (effectCleanup) {
          const cleanupCode = getProps(effectCleanup).code as string || '';
          const cleanupDedented = dedent(cleanupCode);
          if (edeps) {
            // watch: use onCleanup()
            lines.push(`    onCleanup(() => {`);
          } else {
            // onMounted: use return
            lines.push(`    return () => {`);
          }
          for (const line of cleanupDedented.split('\n')) {
            lines.push(`      ${line}`);
          }
          lines.push(`    ${edeps ? '});' : '};'}`);
        }
        if (edeps) {
          lines.push(`  }, { immediate: true });`);
        } else {
          lines.push(`  });`);
        }
        break;
      }
    }
  }

  // Returns
  if (returnsNode) {
    const rnames = getProps(returnsNode).names as string || '';
    const entries = rnames.split(',').map(e => {
      const [key, ...valueParts] = e.split(':');
      const value = valueParts.join(':').trim();
      return value ? `${key.trim()}: ${value}` : key.trim();
    });
    lines.push(`  return { ${entries.join(', ')} };`);
  }

  lines.push('}');

  // Prepend Vue imports
  if (vueImports.size > 0) {
    const importLine = `import { ${[...vueImports].sort().join(', ')} } from 'vue';`;
    lines.unshift('');
    lines.unshift(importLine);
  }

  return lines;
}

// ── Ground Layer — Vue Overrides (Tier 2) ───────────────────────────────

const GROUND_NODE_TYPES = new Set([
  'derive', 'transform', 'action', 'guard', 'assume', 'invariant',
  'each', 'collect', 'branch', 'resolve', 'expect', 'recover',
  'pattern', 'apply',
]);

/** Check if a node is a ground-layer node that may have Vue-specific overrides. */
export function isVueGroundNode(type: string): boolean {
  return GROUND_NODE_TYPES.has(type);
}

/** Vue Tier 2 override for derive → computed(). */
function generateVueDerive(node: IRNode): string[] {
  const props = getProps(node);
  const name = props.name as string;
  const expr = props.expr as string;

  return [`const ${name} = computed(() => ${expr});`];
}

/** Vue Tier 2 override for each → v-for template rendering. */
function generateVueEach(node: IRNode): string[] {
  const props = getProps(node);
  const itemName = props.name as string || 'item';
  const collection = props.in as string;
  const index = props.index as string | undefined;

  const lines: string[] = [];
  const iterVar = index ? `(${itemName}, ${index})` : itemName;
  lines.push(`<template v-for="${iterVar} in ${collection}" :key="${itemName}.id ?? ${itemName}">`);
  for (const child of getChildren(node)) {
    // Try Vue-specific codegen first, fall back to core codegen
    const childLines = isVueNode(child.type)
      ? generateVueNode(child)
      : generateCoreNode(child);
    for (const line of childLines) {
      lines.push(`  ${line}`);
    }
  }
  lines.push(`</template>`);
  return lines;
}

/** Generate Vue-overridden ground-layer node. Returns null for non-overridden nodes (fall through to core). */
export function generateVueGroundNode(node: IRNode): string[] | null {
  switch (node.type) {
    case 'derive': return generateVueDerive(node);
    case 'each': return generateVueEach(node);
    default: return null; // No Vue override — fall through to core
  }
}

// ── Dispatcher ───────────────────────────────────────────────────────────

export function isVueNode(type: string): boolean {
  return type === 'provider' || type === 'effect' || type === 'hook';
}

export function generateVueNode(node: IRNode): string[] {
  switch (node.type) {
    case 'provider': return generateVueProvider(node);
    case 'effect': return generateVueEffect(node);
    case 'hook': return generateVueHook(node);
    default: return [];
  }
}
