/**
 * KernRuntime — instance-based state for KERN's parser, codegen, and template engine.
 *
 * Centralizes 6 module-level global registries into a single owning instance.
 * All public APIs (parse, parseDocument, generateCoreNode, isTemplateNode,
 * expandTemplateNode, isKnownNodeType) accept an optional `runtime` parameter
 * for true instance isolation (LSP, serverless, worker threads, parallel tests).
 *
 * Usage:
 *   const runtime = new KernRuntime();
 *   runtime.registerEvolvedType('custom');
 *   runtime.registerParserHints('custom', { positionalArgs: ['name'] });
 *   runtime.registerEvolvedGenerator('custom', node => [...]);
 *
 * A `defaultRuntime` singleton is provided for backward compatibility.
 * All existing module-level functions (registerEvolvedType, clearParserHints, etc.)
 * delegate to `defaultRuntime` so existing code continues to work unchanged.
 */

import type { IRNode, ParseDiagnostic, TemplateDefinition } from './types.js';

// ── Parser Hints Config ──────────────────────────────────────────────────

export interface ParserHintsConfig {
  positionalArgs?: string[];
  bareWord?: string;
  multilineBlock?: string;
}

// ── KernRuntime ──────────────────────────────────────────────────────────

export class KernRuntime {
  // Parser state
  readonly parserHints = new Map<string, ParserHintsConfig>();
  readonly multilineBlockTypes = new Set(['logic', 'handler', 'cleanup', 'body']);
  lastParseDiagnostics: ParseDiagnostic[] = [];

  // Spec state
  readonly dynamicNodeTypes = new Set<string>();

  // Codegen state
  readonly evolvedGenerators = new Map<string, (node: IRNode) => string[]>();
  readonly evolvedTargetGenerators = new Map<string, Map<string, (node: IRNode) => string[]>>();

  // Template state
  readonly templateRegistry = new Map<string, TemplateDefinition>();

  // ── Parser Hints ─────────────────────────────────────────────────────

  registerParserHints(keyword: string, hints: ParserHintsConfig): void {
    this.parserHints.set(keyword, hints);
    if (hints.multilineBlock) {
      this.multilineBlockTypes.add(keyword);
    }
  }

  unregisterParserHints(keyword: string): void {
    const hints = this.parserHints.get(keyword);
    if (hints?.multilineBlock) {
      this.multilineBlockTypes.delete(keyword);
    }
    this.parserHints.delete(keyword);
  }

  clearParserHints(): void {
    for (const [keyword, hints] of this.parserHints) {
      if (hints.multilineBlock) this.multilineBlockTypes.delete(keyword);
    }
    this.parserHints.clear();
  }

  // ── Evolved Types (spec) ─────────────────────────────────────────────

  registerEvolvedType(keyword: string): void {
    this.dynamicNodeTypes.add(keyword);
  }

  unregisterEvolvedType(keyword: string): void {
    this.dynamicNodeTypes.delete(keyword);
  }

  getEvolvedTypes(): ReadonlySet<string> {
    return new Set(this.dynamicNodeTypes);
  }

  clearEvolvedTypes(): void {
    this.dynamicNodeTypes.clear();
  }

  // ── Evolved Generators (codegen) ─────────────────────────────────────

  registerEvolvedGenerator(keyword: string, fn: (node: IRNode) => string[]): void {
    this.evolvedGenerators.set(keyword, fn);
  }

  registerEvolvedTargetGenerator(keyword: string, target: string, fn: (node: IRNode) => string[]): void {
    let targetMap = this.evolvedTargetGenerators.get(keyword);
    if (!targetMap) {
      targetMap = new Map();
      this.evolvedTargetGenerators.set(keyword, targetMap);
    }
    targetMap.set(target, fn);
  }

  unregisterEvolvedGenerator(keyword: string): void {
    this.evolvedGenerators.delete(keyword);
    this.evolvedTargetGenerators.delete(keyword);
  }

  hasEvolvedGenerator(keyword: string): boolean {
    return this.evolvedGenerators.has(keyword);
  }

  clearEvolvedGenerators(): void {
    this.evolvedGenerators.clear();
    this.evolvedTargetGenerators.clear();
  }

  // ── Templates ────────────────────────────────────────────────────────

  registerTemplate(name: string, def: TemplateDefinition): void {
    this.templateRegistry.set(name, def);
  }

  isTemplateNode(type: string): boolean {
    return this.templateRegistry.has(type);
  }

  getTemplate(name: string): TemplateDefinition | undefined {
    return this.templateRegistry.get(name);
  }

  templateCount(): number {
    return this.templateRegistry.size;
  }

  clearTemplates(): void {
    this.templateRegistry.clear();
  }

  // ── Full Reset ───────────────────────────────────────────────────────

  /** Reset all runtime state. Useful for test isolation. */
  reset(): void {
    this.clearParserHints();
    this.clearEvolvedTypes();
    this.clearEvolvedGenerators();
    this.clearTemplates();
    this.lastParseDiagnostics = [];
  }
}

// ── Default Runtime ──────────────────────────────────────────────────────

/**
 * Default runtime singleton. All existing module-level registration functions
 * delegate to this instance for backward compatibility.
 */
export const defaultRuntime = new KernRuntime();
