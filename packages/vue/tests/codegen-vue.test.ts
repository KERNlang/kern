import { parse } from '../../core/src/parser.js';
import { generateVueProvider, generateVueEffect, generateVueHook, generateVueNode, isVueNode } from '../src/codegen-vue.js';

function gen(source: string): string {
  const root = parse(source);
  return generateVueNode(root).join('\n');
}

describe('Vue Codegen', () => {
  // ── provider → provide/inject ──

  describe('provider', () => {
    const providerSource = [
      'provider name=Search type=UseSearchResult',
      '  prop name=initialQuery type=string',
      '  prop name=category type=string optional=true',
      '  handler <<<',
      '    const value = useSearch({ query: initialQuery, category });',
      '  >>>',
    ].join('\n');

    it('generates InjectionKey', () => {
      const code = gen(providerSource);
      expect(code).toContain("export const SearchKey: InjectionKey<UseSearchResult> = Symbol('Search');");
    });

    it('generates provide composable', () => {
      const code = gen(providerSource);
      expect(code).toContain('export function provideSearch(');
      expect(code).toContain('provide(SearchKey, value);');
      expect(code).toContain('return value;');
    });

    it('generates inject consumer composable', () => {
      const code = gen(providerSource);
      expect(code).toContain('export function useSearchContext(): UseSearchResult {');
      expect(code).toContain('const ctx = inject(SearchKey);');
      expect(code).toContain('if (ctx === undefined)');
    });

    it('includes handler code in provider body', () => {
      const code = gen(providerSource);
      expect(code).toContain('const value = useSearch({ query: initialQuery, category });');
    });

    it('imports provide and inject from vue', () => {
      const code = gen(providerSource);
      expect(code).toContain("import { provide, inject } from 'vue'");
    });

    it('handles optional props in parameters', () => {
      const code = gen(providerSource);
      expect(code).toContain('category?: string');
    });
  });

  // ── effect → onMounted / watch ──

  describe('effect', () => {
    const effectSource = [
      'effect name=TrackingContainer generic=T once=true',
      '  prop name=entities type="T[]"',
      '  prop name=generator type="(items: T[]) => Promise<TrackingEvent>"',
      '  handler <<<',
      '    generator(entities).then(event => trackPageLoadEvent(event));',
      '  >>>',
      '  cleanup <<<',
      '    abortCtrl.abort();',
      '  >>>',
    ].join('\n');

    it('generates onMounted for once=true effect', () => {
      const code = gen(effectSource);
      expect(code).toContain('onMounted(() => {');
    });

    it('generates props interface with generic', () => {
      const code = gen(effectSource);
      expect(code).toContain('export interface TrackingContainerProps<T> {');
      expect(code).toContain('  entities: T[];');
    });

    it('generates composable function', () => {
      const code = gen(effectSource);
      expect(code).toContain('export function useTrackingContainer<T>({ entities, generator }: TrackingContainerProps<T>)');
    });

    it('includes handler code', () => {
      const code = gen(effectSource);
      expect(code).toContain('generator(entities).then(event => trackPageLoadEvent(event));');
    });

    it('generates cleanup with onUnmounted', () => {
      const code = gen(effectSource);
      expect(code).toContain('onUnmounted(() => {');
      expect(code).toContain('abortCtrl.abort();');
    });

    it('generates watch with immediate:true for effect with deps', () => {
      const source = [
        'effect name=Logger deps="data"',
        '  prop name=data type=string',
        '  handler <<<',
        '    console.log(data);',
        '  >>>',
      ].join('\n');
      const code = gen(source);
      expect(code).toContain('watch(data,');
      expect(code).toContain('console.log(data);');
      expect(code).toContain('{ immediate: true }');
    });
  });

  // ── hook → composable ──

  describe('hook (composable)', () => {
    it('generates composable with ref instead of useState', () => {
      const source = [
        'hook name=useCounter returns=CounterResult',
        '  state name=count type=number init=0',
        '  returns names="count"',
      ].join('\n');
      const root = parse(source);
      const code = generateVueHook(root).join('\n');
      expect(code).toContain("import { ref } from 'vue'");
      expect(code).toContain('const count = ref<number>(0);');
      expect(code).toContain('return { count };');
    });

    it('generates computed instead of useMemo', () => {
      const source = [
        'hook name=useSearch returns=SearchResult',
        '  state name=query type=string init=""',
        '  memo name=cacheKey deps="query"',
        '    handler <<<',
        '      return buildCacheKey(query);',
        '    >>>',
        '  returns names="query,cacheKey"',
      ].join('\n');
      const root = parse(source);
      const code = generateVueHook(root).join('\n');
      expect(code).toContain("import { computed, ref } from 'vue'");
      expect(code).toContain('const cacheKey = computed(() => {');
    });

    it('generates plain function instead of useCallback', () => {
      const source = [
        'hook name=useActions returns=ActionsResult',
        '  callback name=handleClick params="id:string" deps="data"',
        '    handler <<<',
        '      doSomething(id);',
        '    >>>',
        '  returns names="handleClick"',
      ].join('\n');
      const root = parse(source);
      const code = generateVueHook(root).join('\n');
      // Vue doesn't need useCallback, just a plain function
      expect(code).toContain('function handleClick(id: string) {');
      expect(code).not.toContain('useCallback');
    });

    it('generates watch with immediate:true instead of useEffect', () => {
      const source = [
        'hook name=useTracker returns=void',
        '  effect deps="page"',
        '    handler <<<',
        '      trackPage(page);',
        '    >>>',
      ].join('\n');
      const root = parse(source);
      const code = generateVueHook(root).join('\n');
      expect(code).toContain('watch(page,');
      expect(code).toContain('trackPage(page);');
      expect(code).toContain('{ immediate: true }');
    });

    it('generates inject instead of useContext', () => {
      const source = [
        'hook name=useTheme returns=ThemeResult',
        '  context name=theme type=Theme source=ThemeKey',
        '  returns names="theme"',
      ].join('\n');
      const root = parse(source);
      const code = generateVueHook(root).join('\n');
      expect(code).toContain("import { inject } from 'vue'");
      expect(code).toContain('const theme = inject(ThemeKey);');
    });
  });

  // ── isVueNode ──

  describe('isVueNode', () => {
    it('identifies provider as Vue node', () => {
      expect(isVueNode('provider')).toBe(true);
    });

    it('identifies effect as Vue node', () => {
      expect(isVueNode('effect')).toBe(true);
    });

    it('identifies hook as Vue node', () => {
      expect(isVueNode('hook')).toBe(true);
    });

    it('rejects non-Vue nodes', () => {
      expect(isVueNode('fn')).toBe(false);
      expect(isVueNode('screen')).toBe(false);
    });
  });
});
