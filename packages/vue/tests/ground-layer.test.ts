import { parse } from '../../core/src/parser.js';
import { generateVueGroundNode, isVueGroundNode } from '../src/codegen-vue.js';

describe('Vue Ground Layer Codegen', () => {
  // ── isVueGroundNode ──

  test('identifies ground-layer node types', () => {
    expect(isVueGroundNode('derive')).toBe(true);
    expect(isVueGroundNode('each')).toBe(true);
    expect(isVueGroundNode('transform')).toBe(true);
    expect(isVueGroundNode('action')).toBe(true);
    expect(isVueGroundNode('guard')).toBe(true);
    expect(isVueGroundNode('branch')).toBe(true);
    expect(isVueGroundNode('pattern')).toBe(true);
  });

  test('non-ground nodes return false', () => {
    expect(isVueGroundNode('text')).toBe(false);
    expect(isVueGroundNode('screen')).toBe(false);
    expect(isVueGroundNode('provider')).toBe(false);
    expect(isVueGroundNode('hook')).toBe(false);
  });

  // ── derive → computed() ──

  describe('derive → computed()', () => {
    test('generates computed() from derive node', () => {
      const ast = parse('derive name=total expr="items.length * price"');
      const lines = generateVueGroundNode(ast);
      expect(lines).not.toBeNull();
      expect(lines!.join('\n')).toContain('const total = computed(() => items.length * price);');
    });

    test('generates computed with simple expression', () => {
      const ast = parse('derive name=isValid expr="name.length > 0"');
      const lines = generateVueGroundNode(ast);
      expect(lines).not.toBeNull();
      expect(lines!.join('\n')).toContain('const isValid = computed(() => name.length > 0);');
    });
  });

  // ── each → v-for ──

  describe('each → v-for', () => {
    test('generates v-for template from each node', () => {
      const ast = parse('each name=user in=users');
      const lines = generateVueGroundNode(ast);
      expect(lines).not.toBeNull();
      const code = lines!.join('\n');
      expect(code).toContain('v-for="user in users"');
      expect(code).toContain(':key="user.id ?? user"');
      expect(code).toContain('<template');
    });

    test('generates v-for with index variable', () => {
      const ast = parse('each name=item index=idx in=items');
      const lines = generateVueGroundNode(ast);
      expect(lines).not.toBeNull();
      const code = lines!.join('\n');
      expect(code).toContain('v-for="(item, idx) in items"');
    });

    test('defaults item name to "item"', () => {
      const ast = parse('each in=products');
      const lines = generateVueGroundNode(ast);
      expect(lines).not.toBeNull();
      const code = lines!.join('\n');
      expect(code).toContain('v-for="item in products"');
    });
  });

  // ── Non-overridden nodes fall through ──

  test('non-overridden ground nodes return null', () => {
    const ast = parse('transform name=toUpper\n  handler <<<\n    return s.toUpperCase();\n  >>>');
    const lines = generateVueGroundNode(ast);
    expect(lines).toBeNull();
  });

  test('action node returns null (no Vue override)', () => {
    const ast = parse('action name=saveUser\n  handler <<<\n    await api.save(user);\n  >>>');
    const lines = generateVueGroundNode(ast);
    expect(lines).toBeNull();
  });

  test('guard node returns null (no Vue override)', () => {
    const ast = parse('guard name=isAuthenticated\n  handler <<<\n    return !!token;\n  >>>');
    const lines = generateVueGroundNode(ast);
    expect(lines).toBeNull();
  });
});
