import { parse } from '../../core/src/parser.js';
import { transpileNuxt } from '../src/transpiler-nuxt.js';

describe('Nuxt 3 Transpiler', () => {
  // ── Basic SFC structure ──

  test('generates valid SFC without explicit vue imports', () => {
    const ast = parse('screen name=Dashboard\n  text value=Hello');
    const result = transpileNuxt(ast);
    expect(result.code).toContain('<script setup lang="ts">');
    expect(result.code).toContain('<template>');
    // Nuxt auto-imports — no explicit 'import { ref } from "vue"'
    expect(result.code).not.toContain("from 'vue'");
  });

  // ── Page generation ──

  test('generates page artifact for screen nodes', () => {
    const ast = parse('screen name=Dashboard\n  text value=Hello');
    const result = transpileNuxt(ast);
    expect(result.artifacts).toBeDefined();
    expect(result.artifacts!.length).toBeGreaterThan(0);
    expect(result.artifacts![0].path).toBe('pages/dashboard.vue');
    expect(result.artifacts![0].type).toBe('page');
  });

  test('Index page routes to pages/index.vue', () => {
    const ast = parse('screen name=Index\n  text value=Welcome');
    const result = transpileNuxt(ast);
    expect(result.artifacts![0].path).toBe('pages/index.vue');
  });

  test('PascalCase name becomes kebab-case route', () => {
    const ast = parse('screen name=UserProfile\n  text value=Profile');
    const result = transpileNuxt(ast);
    expect(result.artifacts![0].path).toBe('pages/user-profile.vue');
  });

  // ── Metadata → useHead ──

  test('metadata nodes generate useHead', () => {
    const ast = parse('screen name=About\n  metadata title="About Us" description="Learn more"\n  text value=About');
    const result = transpileNuxt(ast);
    expect(result.code).toContain('useHead({');
    expect(result.code).toContain("title: 'About Us'");
    expect(result.code).toContain('description');
  });

  // ── NuxtLink ──

  test('button with to uses NuxtLink', () => {
    const ast = parse('screen name=Nav\n  button text="Go Home" to=home');
    const result = transpileNuxt(ast);
    expect(result.code).toContain('<NuxtLink');
    expect(result.code).toContain(':to="\'/home\'"');
  });

  // ── State (auto-imported ref) ──

  test('state generates ref without vue import', () => {
    const ast = parse('screen name=Test\n  state name=count initial=0\n  text value=Hello');
    const result = transpileNuxt(ast);
    expect(result.code).toContain('const count = ref(0);');
    expect(result.code).not.toContain("from 'vue'");
  });

  // ── Layout nodes ──

  test('generates layout artifacts for layout nodes', () => {
    const ast = parse('layout name=Default\n  text value=Header');
    const result = transpileNuxt(ast);
    expect(result.artifacts).toBeDefined();
    expect(result.artifacts![0].path).toBe('layouts/default.vue');
    expect(result.artifacts![0].type).toBe('layout');
  });

  // ── Server routes ──

  test('generates server route artifacts (GET defaults to no suffix)', () => {
    const ast = parse('route name=Users method=get\n  handler <<<\n    return [{ id: 1, name: "Alice" }];\n  >>>');
    const result = transpileNuxt(ast);
    expect(result.artifacts).toBeDefined();
    const serverArtifact = result.artifacts!.find((a) => a.path.startsWith('server/'));
    expect(serverArtifact).toBeDefined();
    expect(serverArtifact!.path).toBe('server/api/users.ts');
    expect(serverArtifact!.content).toContain('defineEventHandler');
  });

  test('POST route uses method suffix in path', () => {
    const ast = parse('route name=Users method=post\n  handler <<<\n    return { created: true };\n  >>>');
    const result = transpileNuxt(ast);
    const serverArtifact = result.artifacts!.find((a) => a.path.startsWith('server/'));
    expect(serverArtifact!.path).toBe('server/api/users.post.ts');
  });

  // ── Middleware ──

  test('generates middleware artifacts', () => {
    const ast = parse(
      'middleware name=Auth\n  handler <<<\n    if (!isAuthenticated()) return navigateTo("/login");\n  >>>',
    );
    const result = transpileNuxt(ast);
    expect(result.artifacts).toBeDefined();
    const mwArtifact = result.artifacts!.find((a) => a.path.startsWith('middleware/'));
    expect(mwArtifact).toBeDefined();
    expect(mwArtifact!.path).toBe('middleware/auth.ts');
    expect(mwArtifact!.content).toContain('defineNuxtRouteMiddleware');
  });

  // ── Event handlers (on nodes) ──

  test('on event=click generates handleClick function without vue import', () => {
    const ast = parse(
      'screen name=Test\n  on event=click\n    handler <<<\n      count++;\n    >>>\n  text value=Hello',
    );
    const result = transpileNuxt(ast);
    expect(result.code).toContain('function handleClick(e: MouseEvent)');
    expect(result.code).toContain('count++;');
    // Nuxt auto-imports — no explicit vue import
    expect(result.code).not.toContain("from 'vue'");
  });

  test('on event=submit with async generates async function', () => {
    const ast = parse(
      'screen name=Test\n  on event=submit async=true\n    handler <<<\n      e.preventDefault();\n      await submitForm(data);\n    >>>\n  text value=Hello',
    );
    const result = transpileNuxt(ast);
    expect(result.code).toContain('async function handleSubmit(e: Event)');
    expect(result.code).toContain('e.preventDefault();');
    expect(result.code).toContain('await submitForm(data);');
  });

  test('on event=key with key=Enter generates onMounted + onUnmounted (auto-imported)', () => {
    const ast = parse(
      'screen name=Test\n  on event=key key=Enter\n    handler <<<\n      processInput(buffer);\n    >>>\n  text value=Hello',
    );
    const result = transpileNuxt(ast);
    // Nuxt auto-imports onMounted/onUnmounted — no explicit vue import
    expect(result.code).not.toContain("from 'vue'");
    expect(result.code).toContain('function handleKey(e: KeyboardEvent)');
    expect(result.code).toContain("if ((e as KeyboardEvent).key !== 'Enter') return;");
    expect(result.code).toContain('processInput(buffer);');
    expect(result.code).toContain('onMounted(() => {');
    expect(result.code).toContain("window.addEventListener('keydown', handleKey as EventListener);");
    expect(result.code).toContain('onUnmounted(() => {');
    expect(result.code).toContain("window.removeEventListener('keydown', handleKey as EventListener);");
  });

  test('on event=resize generates onMounted + onUnmounted window listeners (auto-imported)', () => {
    const ast = parse(
      'screen name=Test\n  on event=resize\n    handler <<<\n      updateLayout();\n    >>>\n  text value=Hello',
    );
    const result = transpileNuxt(ast);
    expect(result.code).not.toContain("from 'vue'");
    expect(result.code).toContain('function handleResize()');
    expect(result.code).toContain('updateLayout();');
    expect(result.code).toContain("window.addEventListener('resize', handleResize as EventListener);");
    expect(result.code).toContain("window.removeEventListener('resize', handleResize as EventListener);");
  });

  test('on node does not render template elements', () => {
    const ast = parse(
      'screen name=Test\n  on event=click\n    handler <<<\n      doSomething();\n    >>>\n  text value=Hello',
    );
    const result = transpileNuxt(ast);
    // The on node should NOT produce any <div> in the template
    expect(result.code).not.toMatch(/<div[^>]*>.*doSomething/s);
    expect(result.code).toContain('<p');
    expect(result.code).toContain('Hello');
  });

  // ── Styles ──

  test('generates scoped styles', () => {
    const ast = parse('screen name=Test {bg:#f0f0f0}\n  text value=Hello');
    const result = transpileNuxt(ast);
    expect(result.code).toContain('<style scoped>');
    expect(result.code).toContain('background');
  });

  // ── Token metrics ──

  test('includes token reduction metrics', () => {
    const ast = parse('screen name=Test\n  text value=Hello');
    const result = transpileNuxt(ast);
    expect(result.irTokenCount).toBeGreaterThan(0);
    expect(result.tsTokenCount).toBeGreaterThan(0);
  });
});
