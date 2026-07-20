/** Side-effect-neutral state shared by the parser, schema, codegen, and public runtime barrel. */
import type { IRNode, ParseDiagnostic, TemplateDefinition } from './types.js';

export interface ParserHintsConfig {
  positionalArgs?: string[];
  bareWord?: string;
  multilineBlock?: string;
}

export class KernRuntime {
  readonly parserHints = new Map<string, ParserHintsConfig>();
  readonly multilineBlockTypes = new Set(['logic', 'handler', 'cleanup', 'body', 'doc', 'render']);
  lastParseDiagnostics: ParseDiagnostic[] = [];

  readonly dynamicNodeTypes = new Set<string>();
  readonly evolvedGenerators = new Map<string, (node: IRNode) => string[]>();
  readonly evolvedTargetGenerators = new Map<string, Map<string, (node: IRNode) => string[]>>();
  readonly templateRegistry = new Map<string, TemplateDefinition>();

  registerParserHints(keyword: string, hints: ParserHintsConfig): void {
    this.parserHints.set(keyword, hints);
    if (hints.multilineBlock) this.multilineBlockTypes.add(keyword);
  }

  unregisterParserHints(keyword: string): void {
    const hints = this.parserHints.get(keyword);
    if (hints?.multilineBlock) this.multilineBlockTypes.delete(keyword);
    this.parserHints.delete(keyword);
  }

  clearParserHints(): void {
    for (const [keyword, hints] of this.parserHints) {
      if (hints.multilineBlock) this.multilineBlockTypes.delete(keyword);
    }
    this.parserHints.clear();
  }

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

  reset(): void {
    this.clearParserHints();
    this.clearEvolvedTypes();
    this.clearEvolvedGenerators();
    this.clearTemplates();
    this.lastParseDiagnostics = [];
  }
}

export const defaultRuntime = new KernRuntime();
