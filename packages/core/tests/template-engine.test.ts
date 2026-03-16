import { parse } from '../src/parser.js';
import {
  registerTemplate, isTemplateNode, expandTemplateNode,
  clearTemplates, getTemplate, templateCount, KernTemplateError,
} from '../src/template-engine.js';
import { generateCoreNode, isCoreNode } from '../src/codegen-core.js';

beforeEach(() => {
  clearTemplates();
});

// Helper: parse a template definition and register it
function reg(source: string): void {
  const ast = parse(source);
  const node = ast.type === 'template' ? ast : (ast.children || []).find(n => n.type === 'template');
  if (!node) throw new Error('No template node found');
  registerTemplate(node);
}

// Helper: parse a template instance and expand via codegen
function expand(source: string): string {
  const ast = parse(source);
  const node = ast.type === 'template' ? ast : ast;
  // For single-node sources, the root IS the instance
  return generateCoreNode(ast).join('\n');
}

// Helper: parse and expand, returning child codegen for multi-node docs
function expandChild(source: string): string {
  const ast = parse(source);
  const child = ast.children?.[0];
  if (!child) return '';
  return generateCoreNode(child).join('\n');
}

describe('Template Engine', () => {
  // ── Registration ──

  describe('registration', () => {
    it('registers a template and isTemplateNode returns true', () => {
      reg([
        'template name=my-hook',
        '  slot name=hookName type=identifier',
        '  body <<<',
        '    export function {{hookName}}() {}',
        '  >>>',
      ].join('\n'));

      expect(isTemplateNode('my-hook')).toBe(true);
      expect(isTemplateNode('unknown-thing')).toBe(false);
      expect(templateCount()).toBe(1);
    });

    it('stores slot definitions correctly', () => {
      reg([
        'template name=my-comp',
        '  slot name=compName type=identifier',
        '  slot name=returnType type=type optional=true default=void',
        '  body <<<',
        '    function {{compName}}(): {{returnType}} {}',
        '  >>>',
      ].join('\n'));

      const tmpl = getTemplate('my-comp');
      expect(tmpl).toBeDefined();
      expect(tmpl!.slots).toHaveLength(2);
      expect(tmpl!.slots[0]).toEqual({
        name: 'compName',
        slotType: 'identifier',
        optional: false,
        defaultValue: undefined,
      });
      expect(tmpl!.slots[1]).toEqual({
        name: 'returnType',
        slotType: 'type',
        optional: true,
        defaultValue: 'void',
      });
    });

    it('stores import definitions', () => {
      reg([
        'template name=swr-hook',
        '  slot name=hookName type=identifier',
        '  import from=swr names=useSWR',
        '  import from=react names="useEffect,useState"',
        '  body <<<',
        '    export function {{hookName}}() {}',
        '  >>>',
      ].join('\n'));

      const tmpl = getTemplate('swr-hook');
      expect(tmpl!.imports).toHaveLength(2);
      expect(tmpl!.imports[0]).toEqual({ from: 'swr', names: 'useSWR' });
      expect(tmpl!.imports[1]).toEqual({ from: 'react', names: 'useEffect,useState' });
    });

    it('rejects template without name', () => {
      expect(() => {
        const ast = parse('template\n  body <<<\n    code\n  >>>');
        registerTemplate(ast);
      }).toThrow(KernTemplateError);
    });

    it('rejects template without body', () => {
      expect(() => {
        const ast = parse('template name=no-body\n  slot name=x type=expr');
        registerTemplate(ast);
      }).toThrow(KernTemplateError);
    });

    it('clearTemplates resets registry', () => {
      reg([
        'template name=test-tmpl',
        '  slot name=x type=expr',
        '  body <<<',
        '    {{x}}',
        '  >>>',
      ].join('\n'));
      expect(templateCount()).toBe(1);
      clearTemplates();
      expect(templateCount()).toBe(0);
      expect(isTemplateNode('test-tmpl')).toBe(false);
    });
  });

  // ── Slot validation ──

  describe('slot validation', () => {
    beforeEach(() => {
      reg([
        'template name=id-test',
        '  slot name=funcName type=identifier',
        '  body <<<',
        '    function {{funcName}}() {}',
        '  >>>',
      ].join('\n'));
    });

    it('identifier slot accepts valid identifiers', () => {
      const code = expand('id-test funcName=myFunc');
      expect(code).toContain('function myFunc() {}');
    });

    it('identifier slot rejects invalid names', () => {
      expect(() => {
        expand('id-test funcName=123-bad');
      }).toThrow(KernTemplateError);
    });

    it('optional slot uses default value', () => {
      clearTemplates();
      reg([
        'template name=opt-test',
        '  slot name=name type=identifier',
        '  slot name=ret type=type optional=true default=void',
        '  body <<<',
        '    function {{name}}(): {{ret}} {}',
        '  >>>',
      ].join('\n'));

      const code = expand('opt-test name=myFn');
      expect(code).toContain('function myFn(): void {}');
    });

    it('optional slot resolves to empty when no default', () => {
      clearTemplates();
      reg([
        'template name=opt-empty',
        '  slot name=name type=identifier',
        '  slot name=extra type=expr optional=true',
        '  body <<<',
        '    const {{name}} = 1;{{extra}}',
        '  >>>',
      ].join('\n'));

      const code = expand('opt-empty name=x');
      expect(code).toContain('const x = 1;');
    });

    it('required slot throws when missing', () => {
      expect(() => {
        expand('id-test');
      }).toThrow(/required slot 'funcName' not provided/);
    });
  });

  // ── Expansion ──

  describe('expansion', () => {
    it('replaces single slot in body', () => {
      reg([
        'template name=simple',
        '  slot name=name type=identifier',
        '  body <<<',
        '    export const {{name}} = true;',
        '  >>>',
      ].join('\n'));

      const code = expand('simple name=isReady');
      expect(code).toContain('export const isReady = true;');
    });

    it('replaces multiple slots', () => {
      reg([
        'template name=typed-const',
        '  slot name=name type=identifier',
        '  slot name=constType type=type',
        '  slot name=value type=expr',
        '  body <<<',
        '    export const {{name}}: {{constType}} = {{value}};',
        '  >>>',
      ].join('\n'));

      const code = expand('typed-const name=MAX_RETRIES constType=number value=3');
      expect(code).toContain('export const MAX_RETRIES: number = 3;');
    });

    it('expands {{CHILDREN}} with handler blocks', () => {
      reg([
        'template name=wrapper',
        '  slot name=name type=identifier',
        '  body <<<',
        '    export function {{name}}() {',
        '      {{CHILDREN}}',
        '    }',
        '  >>>',
      ].join('\n'));

      const code = expand([
        'wrapper name=doStuff',
        '  handler <<<',
        '    console.log("hello");',
        '    return 42;',
        '  >>>',
      ].join('\n'));

      expect(code).toContain('export function doStuff() {');
      expect(code).toContain('console.log("hello");');
      expect(code).toContain('return 42;');
    });

    it('prepends imports', () => {
      reg([
        'template name=react-hook',
        '  slot name=hookName type=identifier',
        '  import from=react names="useState,useEffect"',
        '  body <<<',
        '    export function {{hookName}}() {',
        '      const [x, setX] = useState(0);',
        '    }',
        '  >>>',
      ].join('\n'));

      const code = expand('react-hook hookName=useCounter');
      expect(code).toContain("import { useState, useEffect } from 'react';");
      expect(code).toContain('export function useCounter() {');
    });

    it('handles empty CHILDREN gracefully', () => {
      reg([
        'template name=empty-children',
        '  slot name=name type=identifier',
        '  body <<<',
        '    function {{name}}() {',
        '      {{CHILDREN}}',
        '    }',
        '  >>>',
      ].join('\n'));

      const code = expand('empty-children name=noop');
      expect(code).toContain('function noop() {');
      // Should not contain {{CHILDREN}} literally
      expect(code).not.toContain('{{CHILDREN}}');
    });

    it('expands core node children via codegen pipeline', () => {
      reg([
        'template name=module-tmpl',
        '  slot name=name type=identifier',
        '  body <<<',
        '    // Module: {{name}}',
        '    {{CHILDREN}}',
        '  >>>',
      ].join('\n'));

      const code = expand([
        'module-tmpl name=myModule',
        '  type name=Status values="ok|error"',
      ].join('\n'));

      expect(code).toContain('// Module: myModule');
      expect(code).toContain("export type Status = 'ok' | 'error';");
    });
  });

  // ── Integration with generateCoreNode ──

  describe('codegen integration', () => {
    it('generateCoreNode returns [] for template definitions', () => {
      const ast = parse([
        'template name=my-template',
        '  slot name=x type=expr',
        '  body <<<',
        '    {{x}}',
        '  >>>',
      ].join('\n'));

      expect(generateCoreNode(ast)).toEqual([]);
    });

    it('generateCoreNode expands template instances', () => {
      reg([
        'template name=arrow-fn',
        '  slot name=name type=identifier',
        '  body <<<',
        '    export const {{name}} = () => {};',
        '  >>>',
      ].join('\n'));

      const ast = parse('arrow-fn name=doSomething');
      const code = generateCoreNode(ast).join('\n');
      expect(code).toContain('export const doSomething = () => {};');
    });

    it('template + core nodes in same file work together', () => {
      // Register template first
      reg([
        'template name=helper-fn',
        '  slot name=name type=identifier',
        '  slot name=value type=expr',
        '  body <<<',
        '    export const {{name}} = () => {{value}};',
        '  >>>',
      ].join('\n'));

      // Document with mixed core + template nodes
      const source = [
        'type name=Status values="ok|error"',
        '  helper-fn name=getDefault value="\'ok\'"',
      ].join('\n');
      const ast = parse(source);

      // Root is 'type' — core node
      const typeLine = generateCoreNode(ast).join('\n');
      expect(typeLine).toContain("export type Status = 'ok' | 'error';");

      // Child is template instance
      const child = ast.children![0];
      const helperCode = generateCoreNode(child).join('\n');
      expect(helperCode).toContain("export const getDefault = () => 'ok';");
    });

    it('isCoreNode returns true for template/slot/body', () => {
      expect(isCoreNode('template')).toBe(true);
      expect(isCoreNode('slot')).toBe(true);
      expect(isCoreNode('body')).toBe(true);
    });
  });

  // ── Real-world: SWR hook template ──

  describe('real-world: SWR hook', () => {
    beforeEach(() => {
      reg([
        'template name=swr-hook',
        '  slot name=hookName type=identifier',
        '  slot name=cacheKey type=expr',
        '  slot name=fetcher type=expr optional=true default=defaultFetcher',
        '  slot name=returnType type=type optional=true',
        '  import from=swr names=useSWR',
        '  body <<<',
        '    export function {{hookName}}() {',
        '      const { data, error, isLoading } = useSWR(',
        '        {{cacheKey}},',
        '        {{fetcher}}',
        '      );',
        '',
        '      {{CHILDREN}}',
        '',
        '      return { data, error, isLoading };',
        '    }',
        '  >>>',
      ].join('\n'));
    });

    it('expands SWR hook with all slots', () => {
      const code = expand([
        'swr-hook hookName=useProducts cacheKey="/api/products" fetcher=apiFetcher',
        '  handler <<<',
        '    const formatted = data?.map(formatProduct);',
        '  >>>',
      ].join('\n'));

      expect(code).toContain("import { useSWR } from 'swr';");
      expect(code).toContain('export function useProducts() {');
      expect(code).toContain('/api/products');
      expect(code).toContain('apiFetcher');
      expect(code).toContain('const formatted = data?.map(formatProduct);');
      expect(code).toContain('return { data, error, isLoading };');
    });

    it('uses default fetcher when not specified', () => {
      const code = expand('swr-hook hookName=useCart cacheKey="/api/cart"');
      expect(code).toContain('export function useCart()');
      expect(code).toContain('defaultFetcher');
    });
  });

  // ── Arrow function template ──

  describe('real-world: arrow-fn template', () => {
    beforeEach(() => {
      reg([
        'template name=arrow-fn',
        '  slot name=name type=identifier',
        '  slot name=params type=expr optional=true',
        '  slot name=returnType type=type optional=true',
        '  body <<<',
        '    export const {{name}} = ({{params}}){{returnType}} => {',
        '      {{CHILDREN}}',
        '    };',
        '  >>>',
      ].join('\n'));
    });

    it('expands arrow function with all slots', () => {
      const code = expand([
        'arrow-fn name=fetchData params="url: string" returnType=": Promise<Response>"',
        '  handler <<<',
        '    return fetch(url);',
        '  >>>',
      ].join('\n'));

      expect(code).toContain('export const fetchData = (url: string): Promise<Response> => {');
      expect(code).toContain('return fetch(url);');
    });

    it('expands with minimal slots', () => {
      const code = expand([
        'arrow-fn name=noop',
        '  handler <<<',
        '    // nothing',
        '  >>>',
      ].join('\n'));

      expect(code).toContain('export const noop = ()');
    });
  });

  // ── Real-world: Zustand store (AudioFacets pattern) ──

  describe('real-world: Zustand store', () => {
    beforeEach(() => {
      // Register zustand-store template
      reg([
        'template name=zustand-store',
        '  slot name=storeName type=identifier',
        '  slot name=stateType type=identifier',
        '  import from=zustand names=create',
        '  body <<<',
        '    export const use{{storeName}}Store = create<{{stateType}}>((set) => ({',
        '      {{CHILDREN}}',
        '    }));',
        '  >>>',
      ].join('\n'));

      // Register zustand-selector template
      reg([
        'template name=zustand-selector',
        '  slot name=selectorName type=identifier',
        '  slot name=stateType type=identifier',
        '  slot name=field type=expr',
        '  body <<<',
        '    export const select{{selectorName}} = (s: {{stateType}}) => s.{{field}};',
        '  >>>',
      ].join('\n'));
    });

    it('expands Zustand store with handler body', () => {
      const code = expand([
        'zustand-store storeName=Toast stateType=ToastState',
        '  handler <<<',
        '    toasts: [],',
        '    addToast: (msg: string) => set({ toasts: [msg] }),',
        '  >>>',
      ].join('\n'));

      expect(code).toContain("import { create } from 'zustand';");
      expect(code).toContain('export const useToastStore = create<ToastState>((set) => ({');
      expect(code).toContain('toasts: [],');
      expect(code).toContain('addToast: (msg: string) => set({ toasts: [msg] }),');
      expect(code).toContain('}));');
    });

    it('expands Zustand selector', () => {
      const code = expand('zustand-selector selectorName=Toasts stateType=ToastState field=toasts');
      expect(code).toContain('export const selectToasts = (s: ToastState) => s.toasts;');
    });

    it('Zustand store + interface + selectors compose together', () => {
      // Simulates the audiofacets-toast.kern file
      const source = [
        'interface name=ToastState',
        '  field name=toasts type="Toast[]"',
        '  field name=addToast type="(msg: string) => void"',
      ].join('\n');
      const ast = parse(source);
      const interfaceCode = generateCoreNode(ast).join('\n');
      expect(interfaceCode).toContain('export interface ToastState {');
      expect(interfaceCode).toContain('toasts: Toast[];');

      const storeCode = expand([
        'zustand-store storeName=Toast stateType=ToastState',
        '  handler <<<',
        '    toasts: [],',
        '    addToast: (msg) => set({ toasts: [msg] }),',
        '  >>>',
      ].join('\n'));
      expect(storeCode).toContain('useToastStore');
      expect(storeCode).toContain("from 'zustand'");

      const selectorCode = expand('zustand-selector selectorName=AddToast stateType=ToastState field=addToast');
      expect(selectorCode).toContain('selectAddToast');
    });
  });

  // ── Recursion guard ──

  describe('recursion guard', () => {
    it('throws on excessive nesting depth', () => {
      // We can't easily create infinite recursion with templates,
      // but we can test the depth parameter directly
      reg([
        'template name=deep-tmpl',
        '  slot name=x type=expr',
        '  body <<<',
        '    {{x}}',
        '  >>>',
      ].join('\n'));

      const node = parse('deep-tmpl x=test');
      // Direct call with depth exceeding max
      expect(() => {
        expandTemplateNode(node, 11);
      }).toThrow(/depth exceeded/);
    });
  });
});
