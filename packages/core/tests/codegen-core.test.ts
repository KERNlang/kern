import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parse } from '../src/parser.js';
import {
  generateType, generateInterface, generateFunction,
  generateMachine, generateError, generateConfig,
  generateStore, generateTest, generateEvent, generateModule,
  generateCoreNode, isCoreNode, generateHook,
} from '../src/codegen-core.js';

// Helper: parse a .kern snippet and generate code for the root node
function gen(source: string): string {
  const root = parse(source);
  return generateCoreNode(root).join('\n');
}

// Helper: parse and return just the root's first child codegen
function genChild(source: string): string {
  const root = parse(source);
  const child = root.children?.[0];
  if (!child) return '';
  return generateCoreNode(child).join('\n');
}

describe('Core Language Codegen', () => {
  // ── type ──

  describe('type', () => {
    it('generates union type from values', () => {
      const code = gen('type name=PlanState values="draft|approved|running|paused|completed|failed|cancelled"');
      expect(code).toContain("export type PlanState = 'draft' | 'approved' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';");
    });

    it('generates alias type', () => {
      const code = gen('type name=StepEffect alias="string | number"');
      expect(code).toContain('export type StepEffect = string | number;');
    });

    it('respects export=false', () => {
      const code = gen('type name=Internal values="a|b" export=false');
      expect(code).not.toContain('export');
      expect(code).toContain("type Internal = 'a' | 'b';");
    });
  });

  // ── interface ──

  describe('interface', () => {
    it('generates interface with fields', () => {
      const code = gen([
        'interface name=ArtifactRef',
        '  field name=type type="\'patch\'|\'diff\'"',
        '  field name=path type=string',
        '  field name=engineId type=string optional=true',
      ].join('\n'));

      expect(code).toContain('export interface ArtifactRef {');
      expect(code).toContain("  type: 'patch'|'diff';");
      expect(code).toContain('  path: string;');
      expect(code).toContain('  engineId?: string;');
      expect(code).toContain('}');
    });

    it('generates interface with extends', () => {
      const code = gen('interface name=PlanStep extends=BaseStep');
      expect(code).toContain('export interface PlanStep extends BaseStep {');
    });
  });

  // ── fn ──

  describe('fn', () => {
    it('generates function with params and return type', () => {
      const code = gen([
        'fn name=createPlan params="action:PlanAction,ws:WorkspaceSnapshot" returns=Plan',
        '  handler <<<',
        '    return { id: "test" };',
        '  >>>',
      ].join('\n'));

      expect(code).toContain('export function createPlan(action: PlanAction, ws: WorkspaceSnapshot): Plan {');
      expect(code).toContain('return { id: "test" };');
      expect(code).toContain('}');
    });

    it('generates async function', () => {
      const code = gen('fn name=fetchData async=true returns="Promise<Data>"');
      expect(code).toContain('export async function fetchData(): Promise<Data> {');
    });
  });

  // ── machine (KERN's killer feature) ──

  describe('machine', () => {
    const machineSource = [
      'machine name=Plan',
      '  state name=draft',
      '  state name=approved',
      '  state name=running',
      '  state name=paused',
      '  state name=completed',
      '  state name=failed',
      '  state name=cancelled',
      '  transition name=approve from=draft to=approved',
      '  transition name=start from=approved to=running',
      '  transition name=cancel from="draft|approved|running|paused|failed" to=cancelled',
      '  transition name=fail from="running|paused" to=failed',
    ].join('\n');

    it('generates state type', () => {
      const code = gen(machineSource);
      expect(code).toContain("export type PlanState = 'draft' | 'approved' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';");
    });

    it('generates error class', () => {
      const code = gen(machineSource);
      expect(code).toContain('export class PlanStateError extends Error {');
      expect(code).toContain('public readonly expected: string | string[]');
      expect(code).toContain('public readonly actual: string');
    });

    it('generates single-source transition function', () => {
      const code = gen(machineSource);
      expect(code).toContain('export function approvePlan<T extends { state: PlanState }>(entity: T): T {');
      expect(code).toContain("if (entity.state !== 'draft') {");
      expect(code).toContain("throw new PlanStateError('draft', entity.state);");
      expect(code).toContain("return { ...entity, state: 'approved' as PlanState };");
    });

    it('generates multi-source transition function', () => {
      const code = gen(machineSource);
      expect(code).toContain('export function cancelPlan<T extends { state: PlanState }>(entity: T): T {');
      expect(code).toContain("const validStates: PlanState[] = ['draft', 'approved', 'running', 'paused', 'failed'];");
      expect(code).toContain('if (!validStates.includes(entity.state)) {');
    });

    it('generates all 4 transition functions', () => {
      const code = gen(machineSource);
      expect(code).toContain('function approvePlan');
      expect(code).toContain('function startPlan');
      expect(code).toContain('function cancelPlan');
      expect(code).toContain('function failPlan');
    });

    it('supports custom handler in transition', () => {
      const code = gen([
        'machine name=Plan',
        '  state name=draft',
        '  state name=running',
        '  transition name=start from=draft to=running',
        '    handler <<<',
        '      return { ...entity, state: "running", startedAt: Date.now() };',
        '    >>>',
      ].join('\n'));

      expect(code).toContain('return { ...entity, state: "running", startedAt: Date.now() };');
      // Should NOT contain the default return
      expect(code).not.toContain("return { ...entity, state: 'running' as PlanState };");
    });
  });

  // ── error ──

  describe('error', () => {
    it('generates simple error class', () => {
      const code = gen('error name=AgonError extends=Error');
      expect(code).toContain('export class AgonError extends Error {');
      expect(code).toContain("this.name = 'AgonError';");
    });

    it('generates error with fields and message', () => {
      const code = gen([
        'error name=PlanStateError extends=AgonError message="Invalid plan state: expected ${expectedStr}, got ${actual}"',
        '  field name=expected type="string | string[]"',
        '  field name=actual type=string',
      ].join('\n'));

      expect(code).toContain('export class PlanStateError extends AgonError {');
      expect(code).toContain('public readonly expected: string | string[]');
      expect(code).toContain('public readonly actual: string');
    });
  });

  // ── config ──

  describe('config', () => {
    it('generates interface and defaults', () => {
      const code = gen([
        'config name=AgonConfig',
        '  field name=timeout type=number default=120',
        '  field name=verbose type=boolean default=false',
        '  field name=approvalLevel type=string default=plan',
      ].join('\n'));

      expect(code).toContain('export interface AgonConfig {');
      expect(code).toContain('timeout?: number;');
      expect(code).toContain('verbose?: boolean;');
      expect(code).toContain('export const DEFAULT_AGON_CONFIG: Required<AgonConfig> = {');
      expect(code).toContain('timeout: 120,');
      expect(code).toContain('verbose: false,');
      expect(code).toContain("approvalLevel: 'plan',");
    });
  });

  // ── store ──

  describe('store', () => {
    it('generates CRUD functions', () => {
      const code = gen('store name=Plan path="~/.agon/plans" key=id model=Plan');
      expect(code).toContain('function savePlan(item: Plan): void');
      expect(code).toContain('function loadPlan(id: string): Plan | null');
      expect(code).toContain('function listPlans(limit = 20): Plan[]');
      expect(code).toContain('function deletePlan(id: string): boolean');
      expect(code).toContain("PLAN_DIR");
      // Path traversal protection
      expect(code).toContain('sanitized');
    });
  });

  // ── test ──

  describe('test', () => {
    it('generates vitest describe/it blocks', () => {
      const code = gen([
        'test name="Plan Transitions"',
        '  describe name=approvePlan',
        '    it name="transitions draft to approved"',
        '      handler <<<',
        '        expect(1).toBe(1);',
        '      >>>',
      ].join('\n'));

      expect(code).toContain("import { describe, it, expect } from 'vitest';");
      expect(code).toContain("describe('Plan Transitions', () => {");
      expect(code).toContain("describe('approvePlan', () => {");
      expect(code).toContain("it('transitions draft to approved', () => {");
      expect(code).toContain('expect(1).toBe(1);');
    });
  });

  // ── event ──

  describe('event', () => {
    it('generates typed event system', () => {
      const code = gen([
        'event name=ForgeEvent',
        '  type name="baseline:start"',
        '  type name="baseline:done" data="{ passes: boolean }"',
        '  type name="winner:determined" data="{ winner: string }"',
      ].join('\n'));

      expect(code).toContain("export type ForgeEventType = 'baseline:start' | 'baseline:done' | 'winner:determined';");
      expect(code).toContain('export interface ForgeEvent {');
      expect(code).toContain('export interface ForgeEventMap {');
      expect(code).toContain("'baseline:done': { passes: boolean };");
      expect(code).toContain('export type ForgeEventCallback = (event: ForgeEvent) => void;');
    });
  });

  // ── agon-plan.kern integration ──

  describe('agon-plan.kern example', () => {
    it('compiles the full Agon plan model', async () => {
      const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
      const source = readFileSync(resolve(root, 'examples/agon-plan.kern'), 'utf-8');
      const ast = parse(source);
      const { transpileTerminal } = await import(resolve(root, 'packages/terminal/src/transpiler-terminal.ts'));
      const result = transpileTerminal(ast);

      // Should produce substantial output
      expect(result.code.length).toBeGreaterThan(1000);

      // Should contain all the key generated constructs
      expect(result.code).toContain("type StepState = 'pending'");
      expect(result.code).toContain('interface ArtifactRef');
      expect(result.code).toContain('interface Plan');
      expect(result.code).toContain("type PlanState = 'draft'");
      expect(result.code).toContain('class PlanStateError');
      expect(result.code).toContain('function approvePlan');
      expect(result.code).toContain('function startPlan');
      expect(result.code).toContain('function cancelPlan');
      expect(result.code).toContain('function failPlan');
      expect(result.code).toContain('function savePlan');
      expect(result.code).toContain('function loadPlan');
      expect(result.code).toContain("type ForgeEventType =");
      expect(result.code).toContain('interface AgonConfig');
      expect(result.code).toContain('DEFAULT_AGON_CONFIG');
    });
  });

  // ── hook ──

  describe('hook', () => {
    it('generates useState from state children', () => {
      const code = gen([
        'hook name=useCounter',
        '  state name=count type=number init=0',
      ].join('\n'));

      expect(code).toContain("import { useState } from 'react';");
      expect(code).toContain('const [count, setCount] = useState<number>(0);');
      expect(code).toContain('export function useCounter()');
    });

    it('generates useRef from ref children', () => {
      const code = gen([
        'hook name=useAbort',
        '  ref name=abortCtrl type=AbortController init="new AbortController()"',
      ].join('\n'));

      expect(code).toContain("useRef } from 'react'");
      expect(code).toContain('const abortCtrl = useRef<AbortController>(new AbortController());');
    });

    it('generates useContext from context children', () => {
      const code = gen([
        'hook name=useTheme',
        '  context name=theme type=ThemeConfig source=ThemeContext',
      ].join('\n'));

      expect(code).toContain("useContext } from 'react'");
      expect(code).toContain('const theme = useContext(ThemeContext);');
    });

    it('generates useMemo with handler and deps', () => {
      const code = gen([
        'hook name=useSearch',
        '  memo name=cacheKey deps="query,filters"',
        '    handler <<<',
        '      return buildCacheKey(query, filters);',
        '    >>>',
      ].join('\n'));

      expect(code).toContain("useMemo } from 'react'");
      expect(code).toContain('const cacheKey = useMemo(() => {');
      expect(code).toContain('return buildCacheKey(query, filters);');
      expect(code).toContain('}, [query,filters]);');
    });

    it('generates useCallback with params and deps', () => {
      const code = gen([
        'hook name=useSearch',
        '  callback name=handleFilter params="field:string,value:string" deps="query"',
        '    handler <<<',
        '      setQuery(prev => updateFilter(prev, field, value));',
        '    >>>',
      ].join('\n'));

      expect(code).toContain("useCallback } from 'react'");
      expect(code).toContain('const handleFilter = useCallback((field: string, value: string) => {');
      expect(code).toContain('setQuery(prev => updateFilter(prev, field, value));');
      expect(code).toContain('}, [query]);');
    });

    it('generates useEffect with deps', () => {
      const code = gen([
        'hook name=useTracker',
        '  effect deps="query"',
        '    handler <<<',
        '      trackSearch(query);',
        '    >>>',
      ].join('\n'));

      expect(code).toContain("useEffect } from 'react'");
      expect(code).toContain('useEffect(() => {');
      expect(code).toContain('trackSearch(query);');
      expect(code).toContain('}, [query]);');
    });

    it('generates useEffect with cleanup block', () => {
      const code = gen([
        'hook name=useSubscribe',
        '  effect deps="channel"',
        '    handler <<<',
        '      const sub = subscribe(channel);',
        '    >>>',
        '    cleanup <<<',
        '      sub.unsubscribe();',
        '    >>>',
      ].join('\n'));

      expect(code).toContain('const sub = subscribe(channel);');
      expect(code).toContain('return () => {');
      expect(code).toContain('sub.unsubscribe();');
    });

    it('emits children in source order', () => {
      const code = gen([
        'hook name=useSearch',
        '  state name=query type=string init=""',
        '  memo name=cacheKey deps="query"',
        '    handler <<<',
        '      return buildKey(query);',
        '    >>>',
        '  state name=isLoading type=boolean init=false',
      ].join('\n'));

      // Search for body-specific patterns (not imports)
      const queryIdx = code.indexOf('useState<string>');
      const memoIdx = code.indexOf('const cacheKey = useMemo');
      const loadingIdx = code.indexOf('useState<boolean>');
      expect(queryIdx).toBeLessThan(memoIdx);
      expect(memoIdx).toBeLessThan(loadingIdx);
    });

    it('emits returns always last', () => {
      const code = gen([
        'hook name=useSearch',
        '  returns names="query,isLoading"',
        '  state name=query type=string init=""',
        '  state name=isLoading type=boolean init=false',
      ].join('\n'));

      const stateIdx = code.indexOf('useState');
      const returnIdx = code.indexOf('return {');
      expect(stateIdx).toBeLessThan(returnIdx);
    });

    it('auto-imports only needed React hooks', () => {
      const code = gen([
        'hook name=useSimple',
        '  state name=val type=string init=""',
      ].join('\n'));

      expect(code).toContain("import { useState } from 'react';");
      expect(code).not.toContain('useCallback');
      expect(code).not.toContain('useMemo');
      expect(code).not.toContain('useEffect');
      expect(code).not.toContain('useRef');
    });

    it('handles params and return type', () => {
      const code = gen('hook name=useSearch params="initial:SearchState" returns=SearchResult');
      expect(code).toContain('export function useSearch(initial: SearchState): SearchResult {');
    });

    it('generates inline handler code', () => {
      const code = gen([
        'hook name=useData',
        '  handler <<<',
        '    const { data } = useSWR("/api", fetcher);',
        '  >>>',
      ].join('\n'));

      expect(code).toContain('const { data } = useSWR("/api", fetcher);');
    });

    it('returns mapped values', () => {
      const code = gen([
        'hook name=useSearch',
        '  returns names="products:data?.products,isLoading,handleFilter"',
      ].join('\n'));

      expect(code).toContain('return { products: data?.products, isLoading, handleFilter };');
    });
  });

  // ── isCoreNode ──

  describe('isCoreNode', () => {
    it('identifies core nodes', () => {
      expect(isCoreNode('type')).toBe(true);
      expect(isCoreNode('interface')).toBe(true);
      expect(isCoreNode('machine')).toBe(true);
      expect(isCoreNode('fn')).toBe(true);
      expect(isCoreNode('error')).toBe(true);
      expect(isCoreNode('config')).toBe(true);
      expect(isCoreNode('store')).toBe(true);
      expect(isCoreNode('test')).toBe(true);
      expect(isCoreNode('event')).toBe(true);
      expect(isCoreNode('hook')).toBe(true);
    });

    it('rejects non-core nodes', () => {
      expect(isCoreNode('screen')).toBe(false);
      expect(isCoreNode('button')).toBe(false);
      expect(isCoreNode('route')).toBe(false);
    });
  });
});
