import { parse } from '../../core/src/parser.js';
import { transpileVue } from '../src/transpiler-vue.js';
import { resolveConfig } from '../../core/src/config.js';

describe('Vue 3 SFC Transpiler', () => {
  // ── Basic SFC structure ──

  test('generates valid SFC with script setup, template, and style blocks', () => {
    const ast = parse('screen name=Dashboard\n  text value=Hello');
    const result = transpileVue(ast);
    expect(result.code).toContain('<script setup lang="ts">');
    expect(result.code).toContain('</script>');
    expect(result.code).toContain('<template>');
    expect(result.code).toContain('</template>');
  });

  test('generates scoped style block when styles are present', () => {
    const ast = parse('screen name=Test {bg:#fff}\n  text value=Hello');
    const result = transpileVue(ast);
    expect(result.code).toContain('<style scoped>');
    expect(result.code).toContain('</style>');
  });

  // ── Layout nodes ──

  test('screen renders as flex column div', () => {
    const ast = parse('screen name=Test\n  text value=Hello');
    const result = transpileVue(ast);
    expect(result.code).toContain('flex-direction: column');
    expect(result.code).toContain('min-height: 100vh');
  });

  test('row renders as flex row', () => {
    const ast = parse('screen name=Test\n  row\n    text value=A\n    text value=B');
    const result = transpileVue(ast);
    expect(result.code).toContain('flex-direction: row');
  });

  test('col renders as flex column', () => {
    const ast = parse('screen name=Test\n  col\n    text value=A');
    const result = transpileVue(ast);
    // screen + col both get flex column, check for both div class attrs
    expect(result.code).toContain('<div class="col-');
  });

  test('card renders with box-shadow', () => {
    const ast = parse('screen name=Test\n  card\n    text value=Hello');
    const result = transpileVue(ast);
    expect(result.code).toContain('box-shadow');
  });

  // ── UI Elements ──

  test('text renders as <p> with content', () => {
    const ast = parse('screen name=Test\n  text value=Hello');
    const result = transpileVue(ast);
    expect(result.code).toContain('<p');
    expect(result.code).toContain('Hello');
  });

  test('text with variant=h1 renders as <h1>', () => {
    const ast = parse('screen name=Test\n  text variant=h1 value="Welcome"');
    const result = transpileVue(ast);
    expect(result.code).toContain('<h1');
    expect(result.code).toContain('Welcome');
  });

  test('button renders with text content', () => {
    const ast = parse('screen name=Test\n  button text=Click');
    const result = transpileVue(ast);
    expect(result.code).toContain('<button');
    expect(result.code).toContain('Click');
    expect(result.code).toContain('</button>');
  });

  test('button with to uses @click router', () => {
    const ast = parse('screen name=Test\n  button text=Go to=dashboard');
    const result = transpileVue(ast);
    expect(result.code).toContain("@click=\"$router.push('/dashboard')\"");
  });

  test('image renders as self-closing <img>', () => {
    const ast = parse('screen name=Test\n  image src=logo');
    const result = transpileVue(ast);
    expect(result.code).toContain('<img');
    expect(result.code).toContain(':src="');
    expect(result.code).toContain('alt="logo"');
    expect(result.code).toContain('/>');
  });

  test('input renders with v-model', () => {
    const ast = parse('screen name=Test\n  input bind=query placeholder="Search..."');
    const result = transpileVue(ast);
    expect(result.code).toContain('v-model="query"');
    expect(result.code).toContain('placeholder="Search..."');
  });

  test('divider renders as self-closing <hr>', () => {
    const ast = parse('screen name=Test\n  divider');
    const result = transpileVue(ast);
    expect(result.code).toContain('<hr');
    expect(result.code).toContain('/>');
  });

  test('progress renders with value and max', () => {
    const ast = parse('screen name=Test\n  progress current=30 target=100 label=Health');
    const result = transpileVue(ast);
    expect(result.code).toContain('<progress');
    expect(result.code).toContain(':value="30"');
    expect(result.code).toContain(':max="100"');
  });

  test('list renders as <ul>', () => {
    const ast = parse('screen name=Test\n  list\n    item\n      text value=One');
    const result = transpileVue(ast);
    expect(result.code).toContain('<ul');
    expect(result.code).toContain('<li');
  });

  test('header renders as <header>', () => {
    const ast = parse('screen name=Test\n  header\n    text value=Title');
    const result = transpileVue(ast);
    expect(result.code).toContain('<header');
  });

  test('section renders with title as <h2>', () => {
    const ast = parse('screen name=Test\n  section title=Settings');
    const result = transpileVue(ast);
    expect(result.code).toContain('<section');
    expect(result.code).toContain('<h2>Settings</h2>');
  });

  // ── State / reactivity ──

  test('state nodes generate ref() in script setup', () => {
    const ast = parse('screen name=Test\n  state name=count initial=0\n  text value=Hello');
    const result = transpileVue(ast);
    expect(result.code).toContain('const count = ref(0);');
    expect(result.code).toContain("import { ref } from 'vue'");
  });

  test('state with string initial wraps in quotes', () => {
    const ast = parse('screen name=Test\n  state name=query initial=hello\n  text value=Hi');
    const result = transpileVue(ast);
    expect(result.code).toContain("const query = ref('hello');");
  });

  test('state with boolean initial keeps bare value', () => {
    const ast = parse('screen name=Test\n  state name=active initial=true\n  text value=Hi');
    const result = transpileVue(ast);
    expect(result.code).toContain('const active = ref(true);');
  });

  // ── Logic blocks ──

  test('logic blocks are included in script setup', () => {
    const ast = parse('screen name=Test\n  logic <<<\n    console.log("mounted");\n  >>>\n  text value=Hello');
    const result = transpileVue(ast);
    expect(result.code).toContain('console.log("mounted");');
  });

  // ── Styles ──

  test('inline styles generate scoped CSS', () => {
    const ast = parse('screen name=Test {bg:#f0f0f0,p:16}\n  text value=Hello');
    const result = transpileVue(ast);
    expect(result.code).toContain('<style scoped>');
    expect(result.code).toContain('background');
    expect(result.code).toContain('padding');
  });

  // ── Tabs ──

  test('tabs generate tab buttons and v-if panels', () => {
    const ast = parse('screen name=Test\n  tabs\n    tab name=general label=General\n      text value=General\n    tab name=advanced label=Advanced\n      text value=Advanced');
    const result = transpileVue(ast);
    expect(result.code).toContain('@click=');
    expect(result.code).toContain('v-if=');
    expect(result.code).toContain('General');
    expect(result.code).toContain('Advanced');
  });

  // ── Token metrics ──

  test('includes token reduction metrics', () => {
    const ast = parse('screen name=Test\n  text value=Hello');
    const result = transpileVue(ast);
    expect(result.irTokenCount).toBeGreaterThan(0);
    expect(result.tsTokenCount).toBeGreaterThan(0);
    expect(typeof result.tokenReduction).toBe('number');
  });

  test('includes source map entries', () => {
    const ast = parse('screen name=Test\n  text value=Hello');
    const result = transpileVue(ast);
    expect(result.sourceMap.length).toBeGreaterThan(0);
  });
});
