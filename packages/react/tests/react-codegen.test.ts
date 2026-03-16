import { parse } from '../../core/src/parser.js';
import { generateProvider, generateEffect, generateReactNode, isReactNode } from '../src/codegen-react.js';

function gen(source: string): string {
  const root = parse(source);
  return generateReactNode(root).join('\n');
}

describe('React Codegen', () => {
  // ── provider ──

  describe('provider', () => {
    const providerSource = [
      'provider name=Search type=UseSearchResult',
      '  prop name=initialQuery type=string',
      '  prop name=category type=string optional=true',
      '  handler <<<',
      '    const value = useSearch({ query: initialQuery, category });',
      '  >>>',
    ].join('\n');

    it('generates context creation', () => {
      const code = gen(providerSource);
      expect(code).toContain('const SearchContext = createContext<UseSearchResult | null>(null);');
    });

    it('generates provider component with props', () => {
      const code = gen(providerSource);
      expect(code).toContain('export function SearchProvider({ children, initialQuery, category }: SearchProviderProps)');
      expect(code).toContain('<SearchContext.Provider value={value}>');
      expect(code).toContain('{children}');
      expect(code).toContain('</SearchContext.Provider>');
    });

    it('generates props interface with children and custom props', () => {
      const code = gen(providerSource);
      expect(code).toContain('export interface SearchProviderProps {');
      expect(code).toContain('  children: ReactNode;');
      expect(code).toContain('  initialQuery: string;');
    });

    it('handles optional props', () => {
      const code = gen(providerSource);
      expect(code).toContain('  category?: string;');
    });

    it('generates consumer hook with null-check', () => {
      const code = gen(providerSource);
      expect(code).toContain('export function useSearchContext(): UseSearchResult {');
      expect(code).toContain('const ctx = useContext(SearchContext);');
      expect(code).toContain('if (ctx === null)');
      expect(code).toContain("throw new Error('useSearchContext must be used within a SearchProvider')");
    });

    it('includes use client directive', () => {
      const code = gen(providerSource);
      expect(code).toContain("'use client';");
    });

    it('includes handler code in provider body', () => {
      const code = gen(providerSource);
      expect(code).toContain('const value = useSearch({ query: initialQuery, category });');
    });

    it('imports createContext and useContext', () => {
      const code = gen(providerSource);
      expect(code).toContain("import { createContext, useContext } from 'react';");
      expect(code).toContain("import type { ReactNode } from 'react';");
    });
  });

  // ── effect ──

  describe('effect', () => {
    const effectSource = [
      'effect name=TrackingContainer generic=T once=true deps="entities,generator"',
      '  prop name=entities type="T[]"',
      '  prop name=generator type="(items: T[]) => Promise<TrackingEvent>"',
      '  handler <<<',
      '    generator(entities).then(event => trackPageLoadEvent(event));',
      '  >>>',
      '  cleanup <<<',
      '    abortCtrl.abort();',
      '  >>>',
    ].join('\n');

    it('generates once guard with useRef', () => {
      const code = gen(effectSource);
      expect(code).toContain('const hasRun = useRef(false);');
      expect(code).toContain('if (hasRun.current) return;');
      expect(code).toContain('hasRun.current = true;');
    });

    it('generates without guard when once=false', () => {
      const source = [
        'effect name=Logger deps="data"',
        '  prop name=data type=string',
        '  handler <<<',
        '    console.log(data);',
        '  >>>',
      ].join('\n');
      const code = gen(source);
      expect(code).not.toContain('hasRun');
      expect(code).not.toContain('useRef');
      expect(code).toContain('console.log(data);');
    });

    it('generates deps array', () => {
      const code = gen(effectSource);
      expect(code).toContain('}, [entities,generator]);');
    });

    it('generates cleanup block', () => {
      const code = gen(effectSource);
      expect(code).toContain('return () => {');
      expect(code).toContain('abortCtrl.abort();');
    });

    it('generates props interface with generic', () => {
      const code = gen(effectSource);
      expect(code).toContain('export interface TrackingContainerProps<T> {');
      expect(code).toContain('  entities: T[];');
    });

    it('generates component that returns null', () => {
      const code = gen(effectSource);
      expect(code).toContain('return null;');
    });

    it('includes use client directive', () => {
      const code = gen(effectSource);
      expect(code).toContain("'use client';");
    });

    it('imports useRef when once=true', () => {
      const code = gen(effectSource);
      expect(code).toContain("import { useEffect, useRef } from 'react';");
    });

    it('handles effect without cleanup', () => {
      const source = [
        'effect name=Analytics deps="page"',
        '  prop name=page type=string',
        '  handler <<<',
        '    trackPage(page);',
        '  >>>',
      ].join('\n');
      const code = gen(source);
      expect(code).toContain('trackPage(page);');
      expect(code).not.toContain('return () =>');
    });
  });

  // ── isReactNode ──

  describe('isReactNode', () => {
    it('identifies provider as React node', () => {
      expect(isReactNode('provider')).toBe(true);
    });

    it('identifies effect as React node', () => {
      expect(isReactNode('effect')).toBe(true);
    });

    it('rejects non-React nodes', () => {
      expect(isReactNode('hook')).toBe(false);
      expect(isReactNode('fn')).toBe(false);
      expect(isReactNode('screen')).toBe(false);
    });
  });
});
