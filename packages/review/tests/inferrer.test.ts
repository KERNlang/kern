import { inferFromSource } from '../src/inferrer.js';

describe('TS → KERN Inferrer', () => {
  // ── Phase 1: Type Aliases ──

  describe('type inference', () => {
    it('infers string literal union type', () => {
      const results = inferFromSource(`export type PlanState = 'draft' | 'approved' | 'running';`);
      const typeResult = results.find(r => r.node.type === 'type');
      expect(typeResult).toBeDefined();
      expect(typeResult!.node.props?.name).toBe('PlanState');
      expect(typeResult!.node.props?.values).toBe('draft|approved|running');
      expect(typeResult!.confidencePct).toBeGreaterThanOrEqual(95);
    });

    it('infers type alias (non-literal union)', () => {
      const results = inferFromSource(`export type Result = Success | Failure;`);
      const typeResult = results.find(r => r.node.type === 'type');
      expect(typeResult).toBeDefined();
      expect(typeResult!.node.props?.name).toBe('Result');
      expect(typeResult!.node.props?.alias).toBe('Success | Failure');
    });

    it('infers simple type alias', () => {
      const results = inferFromSource(`export type ID = string;`);
      const typeResult = results.find(r => r.node.type === 'type');
      expect(typeResult).toBeDefined();
      expect(typeResult!.node.props?.alias).toBe('string');
    });
  });

  // ── Phase 1: Interfaces ──

  describe('interface inference', () => {
    it('infers interface with fields', () => {
      const source = `
export interface Plan {
  id: string;
  state: PlanState;
  steps: PlanStep[];
  engineId?: string;
}`;
      const results = inferFromSource(source);
      const iface = results.find(r => r.node.type === 'interface');
      expect(iface).toBeDefined();
      expect(iface!.node.props?.name).toBe('Plan');
      expect(iface!.node.children?.length).toBe(4);

      // Check optional field
      const engineId = iface!.node.children!.find(c => c.props?.name === 'engineId');
      expect(engineId?.props?.optional).toBe('true');
    });

    it('infers interface with extends', () => {
      const source = `
export interface PlanStep extends BaseStep {
  action: string;
}`;
      const results = inferFromSource(source);
      const iface = results.find(r => r.node.type === 'interface');
      expect(iface).toBeDefined();
      expect(iface!.node.props?.extends).toBe('BaseStep');
    });
  });

  // ── Phase 1: Functions ──

  describe('function inference', () => {
    it('infers function with params and return type', () => {
      const source = `
export function createPlan(action: PlanAction, ws: WorkspaceSnapshot): Plan {
  return { id: nanoid(), action, ws, state: 'draft', steps: [] };
}`;
      const results = inferFromSource(source);
      const fn = results.find(r => r.node.type === 'fn');
      expect(fn).toBeDefined();
      expect(fn!.node.props?.name).toBe('createPlan');
      expect(fn!.node.props?.params).toContain('action:PlanAction');
      expect(fn!.node.props?.returns).toBe('Plan');
    });

    it('infers async function', () => {
      const source = `
export async function fetchData(url: string): Promise<Data> {
  const res = await fetch(url);
  return res.json();
}`;
      const results = inferFromSource(source);
      const fn = results.find(r => r.node.type === 'fn');
      expect(fn).toBeDefined();
      expect(fn!.node.props?.async).toBe('true');
    });

    it('preserves function body in handler', () => {
      const source = `
export function greet(name: string): string {
  return \`Hello, \${name}!\`;
}`;
      const results = inferFromSource(source);
      const fn = results.find(r => r.node.type === 'fn');
      expect(fn!.node.children?.length).toBe(1);
      expect(fn!.node.children![0].type).toBe('handler');
    });
  });

  // ── Phase 1: Error Classes ──

  describe('error inference', () => {
    it('infers error class extending Error', () => {
      const source = `
export class PlanStateError extends Error {
  constructor(
    public readonly expected: string | string[],
    public readonly actual: string,
  ) {
    super(\`Invalid state: expected \${expected}, got \${actual}\`);
    this.name = 'PlanStateError';
  }
}`;
      const results = inferFromSource(source);
      const error = results.find(r => r.node.type === 'error');
      expect(error).toBeDefined();
      expect(error!.node.props?.name).toBe('PlanStateError');
      expect(error!.node.props?.extends).toBe('Error');
      expect(error!.node.children?.length).toBeGreaterThan(0);
    });

    it('infers error extending custom error class', () => {
      const source = `
export class ApiError extends BaseError {
  constructor(message: string) {
    super(message);
  }
}`;
      const results = inferFromSource(source);
      const error = results.find(r => r.node.type === 'error');
      expect(error).toBeDefined();
      expect(error!.node.props?.extends).toBe('BaseError');
    });
  });

  // ── Phase 1: Imports ──

  describe('import inference', () => {
    it('infers named imports', () => {
      const source = `import { readFileSync, writeFileSync } from 'node:fs';`;
      const results = inferFromSource(source);
      const imp = results.find(r => r.node.type === 'import');
      expect(imp).toBeDefined();
      expect(imp!.node.props?.from).toBe('node:fs');
      expect(imp!.node.props?.names).toBe('readFileSync,writeFileSync');
    });

    it('infers type-only imports', () => {
      const source = `import type { Plan } from './types.js';`;
      const results = inferFromSource(source);
      const imp = results.find(r => r.node.type === 'import');
      expect(imp).toBeDefined();
      expect(imp!.node.props?.types).toBe('true');
    });

    it('infers default imports', () => {
      const source = `import path from 'node:path';`;
      const results = inferFromSource(source);
      const imp = results.find(r => r.node.type === 'import');
      expect(imp).toBeDefined();
      expect(imp!.node.props?.default).toBe('path');
    });
  });

  // ── Phase 1: Constants ──

  describe('const inference', () => {
    it('infers typed constant', () => {
      const source = `export const MAX_RETRIES: number = 3;`;
      const results = inferFromSource(source);
      const c = results.find(r => r.node.type === 'const');
      expect(c).toBeDefined();
      expect(c!.node.props?.name).toBe('MAX_RETRIES');
      expect(c!.node.props?.type).toBe('number');
      expect(c!.node.props?.value).toBe('3');
    });

    it('skips function expressions', () => {
      const source = `export const greet = (name: string) => \`Hello \${name}\`;`;
      const results = inferFromSource(source);
      const consts = results.filter(r => r.node.type === 'const');
      expect(consts.length).toBe(0);
    });

    it('skips arrow functions without parentheses', () => {
      const source = `export const fetcher = url => fetch(url);`;
      const results = inferFromSource(source);
      const consts = results.filter(r => r.node.type === 'const');
      expect(consts.length).toBe(0);
    });
  });

  // ── Phase 2: Machine Detection ──

  describe('machine inference', () => {
    it('detects state machine from triple pattern', () => {
      const source = `
export type PlanState = 'draft' | 'approved' | 'running' | 'completed';

export class PlanStateError extends Error {
  constructor(
    public readonly expected: string | string[],
    public readonly actual: string,
  ) {
    super(\`Invalid state\`);
    this.name = 'PlanStateError';
  }
}

export function approvePlan<T extends { state: PlanState }>(entity: T): T {
  if (entity.state !== 'draft') throw new PlanStateError('draft', entity.state);
  return { ...entity, state: 'approved' as PlanState };
}

export function startPlan<T extends { state: PlanState }>(entity: T): T {
  if (entity.state !== 'approved') throw new PlanStateError('approved', entity.state);
  return { ...entity, state: 'running' as PlanState };
}`;
      const results = inferFromSource(source);
      const machine = results.find(r => r.node.type === 'machine');
      expect(machine).toBeDefined();
      expect(machine!.node.props?.name).toBe('Plan');
      expect(machine!.summary).toContain('machine Plan');
      expect(machine!.confidencePct).toBeGreaterThanOrEqual(75);
    });
  });

  // ── Phase 2: Config Detection ──

  describe('config inference', () => {
    it('detects config from interface + defaults pair', () => {
      const source = `
export interface AgonConfig {
  timeout: number;
  approvalLevel: string;
  maxRetries: number;
}

export const DEFAULT_AGON_CONFIG: Required<AgonConfig> = {
  timeout: 120,
  approvalLevel: 'plan',
  maxRetries: 3,
};`;
      const results = inferFromSource(source);
      const config = results.find(r => r.node.type === 'config');
      expect(config).toBeDefined();
      expect(config!.node.props?.name).toBe('AgonConfig');
      expect(config!.confidencePct).toBeGreaterThanOrEqual(80);
    });
  });

  // ── Phase 2: Event Detection ──

  describe('event inference', () => {
    it('detects event from type+interface+map triple', () => {
      const source = `
export type ForgeEventType = 'baseline:start' | 'baseline:done' | 'winner:determined';

export interface ForgeEvent {
  type: ForgeEventType;
  engineId?: string;
  data?: Record<string, unknown>;
}

export interface ForgeEventMap {
  'baseline:start': Record<string, unknown>;
  'baseline:done': { passes: boolean };
  'winner:determined': { winner: string; bestScore: number };
}`;
      const results = inferFromSource(source);
      const event = results.find(r => r.node.type === 'event');
      expect(event).toBeDefined();
      expect(event!.node.props?.name).toBe('ForgeEvent');
      expect(event!.confidencePct).toBeGreaterThanOrEqual(85);
    });
  });

  // ── Metrics ──

  describe('metrics', () => {
    it('every inference has token counts', () => {
      const source = `
export type State = 'a' | 'b';
export interface Foo { x: string; }
export function bar(): void {}
`;
      const results = inferFromSource(source);
      for (const r of results) {
        expect(r.kernTokens).toBeGreaterThan(0);
        expect(r.tsTokens).toBeGreaterThan(0);
      }
    });

    it('results are sorted by line number', () => {
      const source = `
import { foo } from 'bar';
export type X = 'a' | 'b';
export interface Y { z: string; }
export function w(): void {}
`;
      const results = inferFromSource(source);
      for (let i = 1; i < results.length; i++) {
        expect(results[i].startLine).toBeGreaterThanOrEqual(results[i - 1].startLine);
      }
    });
  });
});
