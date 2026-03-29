import { parse } from '../../core/src/parser.js';
import { transpileTailwindVue } from '../src/transpiler-tailwind-vue.js';
import { resolveConfig } from '../../core/src/config.js';

describe('Vue 3 Tailwind Transpiler', () => {
  // ── Basic SFC structure ──

  test('generates SFC with script setup and template — no style block', () => {
    const ast = parse('screen name=Dashboard\n  text value=Hello');
    const result = transpileTailwindVue(ast);
    expect(result.code).toContain('<script setup lang="ts">');
    expect(result.code).toContain('</script>');
    expect(result.code).toContain('<template>');
    expect(result.code).toContain('</template>');
    expect(result.code).not.toContain('<style');
  });

  // ── Tailwind classes ──

  test('screen renders with Tailwind classes', () => {
    const ast = parse('screen name=Test\n  text value=Hello');
    const result = transpileTailwindVue(ast);
    expect(result.code).toContain('min-h-screen');
    expect(result.code).toContain('space-y-8');
  });

  test('row renders with flex class', () => {
    const ast = parse('screen name=Test\n  row\n    text value=A');
    const result = transpileTailwindVue(ast);
    expect(result.code).toContain('class="');
    expect(result.code).toContain('flex');
  });

  test('col renders with flex flex-col classes', () => {
    const ast = parse('screen name=Test\n  col\n    text value=A');
    const result = transpileTailwindVue(ast);
    expect(result.code).toContain('flex flex-col');
  });

  test('card renders with shadow-sm class', () => {
    const ast = parse('screen name=Test\n  card\n    text value=Hello');
    const result = transpileTailwindVue(ast);
    expect(result.code).toContain('shadow-sm');
  });

  test('styles convert to Tailwind classes', () => {
    const ast = parse('screen name=Test {p:16}\n  text value=Hello');
    const result = transpileTailwindVue(ast);
    expect(result.code).toContain('class="');
    // Should have Tailwind padding class instead of inline style
    expect(result.code).not.toContain('padding:');
  });

  test('pseudo-styles generate Tailwind variants', () => {
    const ast = parse('screen name=Test\n  button text=Click {bg:#007AFF,:press:bg:#005BB5}');
    const result = transpileTailwindVue(ast);
    expect(result.code).toContain('active:');
  });

  // ── Layout elements ──

  test('divider renders with h-px class', () => {
    const ast = parse('screen name=Test\n  divider');
    const result = transpileTailwindVue(ast);
    expect(result.code).toContain('h-px');
  });

  test('grid renders with grid-cols classes', () => {
    const ast = parse('screen name=Test\n  grid cols=3 gap=16\n    text value=A');
    const result = transpileTailwindVue(ast);
    expect(result.code).toContain('grid');
    expect(result.code).toContain('grid-cols-1');
    expect(result.code).toContain('md:grid-cols-3');
    expect(result.code).toContain('gap-4');
  });

  // ── UI Elements ──

  test('text renders as semantic element', () => {
    const ast = parse('screen name=Test\n  text value=Hello');
    const result = transpileTailwindVue(ast);
    expect(result.code).toContain('<p');
    expect(result.code).toContain('Hello');
  });

  test('text variant=h1 renders as <h1>', () => {
    const ast = parse('screen name=Test\n  text value=Title variant=h1');
    const result = transpileTailwindVue(ast);
    expect(result.code).toContain('<h1');
    expect(result.code).toContain('Title');
  });

  test('button renders with click handler', () => {
    const ast = parse('screen name=Test\n  button text=Click action=doSomething');
    const result = transpileTailwindVue(ast);
    expect(result.code).toContain('<button');
    expect(result.code).toContain('Click');
    expect(result.code).toContain('@click="doSomething"');
  });

  test('button with to renders as router-link', () => {
    const ast = parse('screen name=Test\n  button text=Go to=home');
    const result = transpileTailwindVue(ast);
    expect(result.code).toContain('<router-link');
    expect(result.code).toContain('to="/home"');
  });

  test('input renders with v-model and Tailwind classes', () => {
    const ast = parse('screen name=Test\n  input bind=query placeholder=Search');
    const result = transpileTailwindVue(ast);
    expect(result.code).toContain('v-model="query"');
    expect(result.code).toContain('placeholder="Search"');
    expect(result.code).not.toContain('<style');
  });

  test('slider renders with v-model and range type', () => {
    const ast = parse('screen name=Test\n  slider bind=volume min=0 max=100');
    const result = transpileTailwindVue(ast);
    expect(result.code).toContain('type="range"');
    expect(result.code).toContain('v-model="volume"');
    expect(result.code).toContain('appearance-none');
  });

  test('toggle renders with checkbox and peer classes', () => {
    const ast = parse('screen name=Test\n  toggle bind=darkMode');
    const result = transpileTailwindVue(ast);
    expect(result.code).toContain('type="checkbox"');
    expect(result.code).toContain('v-model="darkMode"');
    expect(result.code).toContain('peer');
  });

  test('image renders as <img> tag', () => {
    const ast = parse('screen name=Test\n  image src=logo');
    const result = transpileTailwindVue(ast);
    expect(result.code).toContain('<img');
    expect(result.code).toContain("logo");
  });

  test('progress renders with custom color and percentage', () => {
    const ast = parse('screen name=Test\n  progress label=Steps current=3 target=10 color=#22c55e');
    const result = transpileTailwindVue(ast);
    expect(result.code).toContain('Steps');
    expect(result.code).toContain('3/10');
    expect(result.code).toContain('#22c55e');
  });

  test('list and item render with Tailwind spacing', () => {
    const ast = parse('screen name=Test\n  list\n    item\n      text value=Item1');
    const result = transpileTailwindVue(ast);
    expect(result.code).toContain('space-y-2');
    expect(result.code).toContain('flex items-center');
  });

  test('icon renders as inline SVG', () => {
    const ast = parse('screen name=Test\n  icon name=search');
    const result = transpileTailwindVue(ast);
    expect(result.code).toContain('<svg');
    expect(result.code).toContain('circle cx="11"');
  });

  test('conditional renders as v-if template', () => {
    const ast = parse('screen name=Test\n  conditional if=isAdmin\n    text value=Admin');
    const result = transpileTailwindVue(ast);
    expect(result.code).toContain('v-if="isAdmin"');
  });

  // ── State ──

  test('state generates ref() with import', () => {
    const ast = parse('screen name=Test\n  state name=count initial=0\n  text value=Hello');
    const result = transpileTailwindVue(ast);
    expect(result.code).toContain("import { ref } from 'vue'");
    expect(result.code).toContain('const count = ref(0);');
  });

  test('state with string initial value', () => {
    const ast = parse('screen name=Test\n  state name=query initial=hello\n  text value=Hello');
    const result = transpileTailwindVue(ast);
    expect(result.code).toContain("const query = ref('hello');");
  });

  test('state with boolean initial value', () => {
    const ast = parse('screen name=Test\n  state name=active initial=true\n  text value=Hello');
    const result = transpileTailwindVue(ast);
    expect(result.code).toContain('const active = ref(true);');
  });

  // ── Event handlers ──

  test('click handler generates function', () => {
    const ast = parse('screen name=Test\n  on event=click\n    handler <<<\n      console.log("clicked");\n    >>>\n  text value=Hello');
    const result = transpileTailwindVue(ast);
    expect(result.code).toContain('function handleClick');
    expect(result.code).toContain('console.log("clicked");');
  });

  test('key handler generates onMounted/onUnmounted', () => {
    const ast = parse('screen name=Test\n  on event=key key=Escape\n    handler <<<\n      close();\n    >>>\n  text value=Hello');
    const result = transpileTailwindVue(ast);
    expect(result.code).toContain('onMounted');
    expect(result.code).toContain('onUnmounted');
    expect(result.code).toContain("addEventListener('keydown'");
    expect(result.code).toContain("key !== 'Escape'");
  });

  // ── i18n ──

  test('i18n disabled: text renders raw value', () => {
    const ast = parse('screen name=Test\n  text value=Hello');
    const result = transpileTailwindVue(ast);
    expect(result.code).toContain('Hello');
    expect(result.code).not.toContain("t('");
  });

  test('i18n enabled: text wraps with t()', () => {
    const ast = parse('screen name=Test\n  text value=Hello');
    const config = resolveConfig({ i18n: { enabled: true } });
    const result = transpileTailwindVue(ast, config);
    expect(result.code).toContain("t('");
    expect(result.code).toContain("import { useI18n } from 'vue-i18n'");
    expect(result.code).toContain('const { t } = useI18n()');
  });

  // ── Section ──

  test('section renders with title', () => {
    const ast = parse('screen name=Test\n  section title=Settings\n    text value=Hello');
    const result = transpileTailwindVue(ast);
    expect(result.code).toContain('Settings');
    expect(result.code).toContain('text-sm font-medium');
  });

  // ── Tabs ──

  test('tabs generate tab buttons and v-if panels', () => {
    const ast = parse('screen name=Test\n  tabs\n    tab name=general label=General\n      text value=General\n    tab name=advanced label=Advanced\n      text value=Advanced');
    const result = transpileTailwindVue(ast);
    expect(result.code).toContain("= 'general'");
    expect(result.code).toContain("= 'advanced'");
    expect(result.code).toContain('v-if="activeTab_');
    expect(result.code).toContain('ref(');
  });

  // ── Diagnostics ──

  test('returns diagnostics with token counts', () => {
    const ast = parse('screen name=Test\n  text value=Hello');
    const result = transpileTailwindVue(ast);
    expect(result.irTokenCount).toBeGreaterThan(0);
    expect(result.tsTokenCount).toBeGreaterThan(0);
    expect(result.sourceMap.length).toBeGreaterThan(0);
  });

  // ── Dark mode detection ──

  test('dark background adds text-white class', () => {
    const ast = parse('screen name=Test {bg:#111111}\n  text value=Hello');
    const result = transpileTailwindVue(ast);
    expect(result.code).toContain('text-white');
  });

  test('light background adds text-zinc-900 class', () => {
    const ast = parse('screen name=Test {bg:#ffffff}\n  text value=Hello');
    const result = transpileTailwindVue(ast);
    expect(result.code).toContain('text-zinc-900');
  });
});
