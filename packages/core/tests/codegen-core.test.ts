import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parse } from '../src/parser.js';
import {
  generateType, generateInterface, generateFunction,
  generateMachine, generateError, generateConfig,
  generateStore, generateTest, generateEvent, generateModule,
  generateCoreNode, isCoreNode,
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

  // Hook tests moved to @kernlang/react — hook codegen is React-specific

  // ── Gap 5: Default params ──

  describe('default params', () => {
    it('generates function with default parameter values', () => {
      const source = [
        'fn name=determineWinner params="results:StageResult[],spread:number=8" returns=string',
        '  handler <<<',
        '    return results[0];',
        '  >>>',
      ].join('\n');
      const code = gen(source);

      expect(code).toContain('spread: number = 8');
      expect(code).toContain('results: StageResult[]');
    });

    it('handles arrow function types in params without splitting on =>', () => {
      const source = 'fn name=apply params="cb:(x:number) => void,value:number=42" returns=void';
      const code = gen(source);

      expect(code).toContain('cb: (x:number) => void');
      expect(code).toContain('value: number = 42');
    });

    it('handles generic types with commas inside angle brackets', () => {
      const source = 'fn name=merge params="a:Record<string,number>,b:Record<string,number>" returns=void';
      const code = gen(source);

      expect(code).toContain('a: Record<string,number>');
      expect(code).toContain('b: Record<string,number>');
    });
  });

  // ── Gap 6: Discriminated unions ──

  describe('union', () => {
    it('generates discriminated union with variants', () => {
      const source = [
        'union name=ContentSegment discriminant=type',
        '  variant name=prose',
        '    field name=text type=string',
        '  variant name=code',
        '    field name=language type=string',
        '    field name=code type=string',
      ].join('\n');
      const code = gen(source);

      expect(code).toContain("export type ContentSegment =");
      expect(code).toContain("type: 'prose'; text: string");
      expect(code).toContain("type: 'code'; language: string; code: string");
    });

    it('uses custom discriminant field', () => {
      const source = [
        'union name=Action discriminant=kind',
        '  variant name=click',
        '    field name=x type=number',
        '  variant name=scroll',
        '    field name=delta type=number',
      ].join('\n');
      const code = gen(source);

      expect(code).toContain("kind: 'click'");
      expect(code).toContain("kind: 'scroll'");
    });

    it('handles optional fields in variants', () => {
      const source = [
        'union name=Event discriminant=type',
        '  variant name=error',
        '    field name=message type=string',
        '    field name=stack type=string optional=true',
      ].join('\n');
      const code = gen(source);

      expect(code).toContain('message: string');
      expect(code).toContain('stack?: string');
    });
  });

  // ── Gap 1: Service (class) ──

  describe('service', () => {
    it('generates class with fields and methods', () => {
      const source = [
        'service name=TokenTracker',
        '  field name=entries type="TokenUsage[]" default="[]" private=true',
        '  method name=record params="usage:TokenUsage" returns=void',
        '    handler <<<',
        '      this.entries.push(usage);',
        '    >>>',
        '  method name=getStats returns=SessionStats',
        '    handler <<<',
        '      return { calls: this.entries.length };',
        '    >>>',
        '  method name=reset returns=void',
        '    handler <<<',
        '      this.entries = [];',
        '    >>>',
      ].join('\n');
      const code = gen(source);

      expect(code).toContain('export class TokenTracker {');
      expect(code).toContain('private entries: TokenUsage[] = [];');
      expect(code).toContain('record(usage: TokenUsage): void {');
      expect(code).toContain('this.entries.push(usage)');
      expect(code).toContain('getStats(): SessionStats {');
      expect(code).toContain('reset(): void {');
    });

    it('generates class with implements clause', () => {
      const source = [
        'service name=CliAdapter implements=EngineAdapter',
        '  method name=dispatch params="input:string" returns="Promise<void>" async=true',
        '    handler <<<',
        '      await this.engine.run(input);',
        '    >>>',
      ].join('\n');
      const code = gen(source);

      expect(code).toContain('export class CliAdapter implements EngineAdapter {');
      expect(code).toContain('async dispatch(input: string): Promise<void> {');
    });

    it('generates async generator method with stream=true', () => {
      const source = [
        'service name=Adapter implements=EngineAdapter',
        '  method name=dispatchStream params="prompt:string,opts:StreamOpts" returns=StreamChunk stream=true',
        '    handler <<<',
        '      const response = await this.client.stream(prompt, opts);',
        '      for await (const chunk of response) {',
        '        yield { text: chunk.text };',
        '      }',
        '    >>>',
      ].join('\n');
      const code = gen(source);

      expect(code).toContain('async *dispatchStream(prompt: string, opts: StreamOpts): AsyncGenerator<StreamChunk> {');
      expect(code).toContain('yield { text: chunk.text }');
    });

    it('generates singleton instance', () => {
      const source = [
        'service name=TokenTracker',
        '  field name=entries type="TokenUsage[]" default="[]"',
        '  singleton name=tracker',
      ].join('\n');
      const code = gen(source);

      expect(code).toContain('export class TokenTracker {');
      expect(code).toContain('export const tracker = new TokenTracker();');
    });

    it('generates constructor', () => {
      const source = [
        'service name=Registry',
        '  field name=items type="Map<string,any>"',
        '  constructor params="initialItems:string[]"',
        '    handler <<<',
        '      this.items = new Map();',
        '      initialItems.forEach(i => this.items.set(i, null));',
        '    >>>',
      ].join('\n');
      const code = gen(source);

      expect(code).toContain('constructor(initialItems: string[]) {');
      expect(code).toContain('this.items = new Map()');
    });
  });

  // ── Gap 3: Signal + cleanup ──

  describe('signal and cleanup', () => {
    it('generates AbortController from signal node', () => {
      const source = [
        'fn name=handleChat params="input:string" returns="Promise<void>" async=true',
        '  signal name=abort',
        '  handler <<<',
        '    const stream = fetch(url, { signal: abort.signal });',
        '  >>>',
      ].join('\n');
      const code = gen(source);

      expect(code).toContain('const abort = new AbortController();');
      expect(code).toContain('signal: abort.signal');
    });

    it('generates try/finally from cleanup node', () => {
      const source = [
        'fn name=handleStream params="ctx:Context" returns="Promise<void>" async=true',
        '  handler <<<',
        '    for await (const chunk of stream) {',
        '      process(chunk);',
        '    }',
        '  >>>',
        '  cleanup <<<',
        '    ctx.setActiveAbort(null);',
        '  >>>',
      ].join('\n');
      const code = gen(source);

      expect(code).toContain('try {');
      expect(code).toContain('for await (const chunk of stream)');
      expect(code).toContain('} finally {');
      expect(code).toContain('ctx.setActiveAbort(null)');
    });

    it('generates signal + cleanup together', () => {
      const source = [
        'fn name=fetchData params="url:string" returns="Promise<void>" async=true',
        '  signal name=abort',
        '  handler <<<',
        '    const res = await fetch(url, { signal: abort.signal });',
        '  >>>',
        '  cleanup <<<',
        '    abort.abort();',
        '  >>>',
      ].join('\n');
      const code = gen(source);

      expect(code).toContain('const abort = new AbortController();');
      expect(code).toContain('try {');
      expect(code).toContain('} finally {');
      expect(code).toContain('abort.abort()');
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

    it('identifies graduated screen node', () => {
      expect(isCoreNode('screen')).toBe(true);
    });

    it('rejects non-core nodes', () => {
      expect(isCoreNode('button')).toBe(false);
      expect(isCoreNode('route')).toBe(false);
    });
  });
});
