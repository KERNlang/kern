import { KERN_JS_OBJECT_HELPERS_PY, KERN_JS_STRING_HELPERS_PY, rewriteExpr } from '../src/core/expr/index.js';

describe('portable logic matrix expression lowering', () => {
  it('lowers Object.keys/values/entries through JS-order helpers', () => {
    for (const [expr, expected] of [
      ['Object.keys({"2":"two","1":"one",x:"ex"})', '_kern_js_object_keys({"2":"two", "1":"one", "x":"ex"})'],
      ['Object.values({"2":"two","1":"one",x:"ex"})', '_kern_js_object_values({"2":"two", "1":"one", "x":"ex"})'],
      ['Object.entries({"2":"two","1":"one",x:"ex"})', '_kern_js_object_entries({"2":"two", "1":"one", "x":"ex"})'],
    ] as const) {
      const imports = new Set<string>();
      expect(rewriteExpr(expr, [], [], {}, imports)).toBe(expected);
      expect(imports).toContain(KERN_JS_OBJECT_HELPERS_PY);
    }
  });

  it('lowers empty string split to character-list semantics', () => {
    const imports = new Set<string>();
    expect(rewriteExpr('s.split("")', [], [], {}, imports)).toBe('list(s)');
    expect(rewriteExpr('s.split("", 2)', [], [], {}, imports)).toBe('list(s)[:_kern_js_split_limit(2)]');
    expect(rewriteExpr('s.split(",", -1)', [], [], {}, imports)).toBe('s.split(",")[:_kern_js_split_limit(-1)]');
    expect(imports).toContain(KERN_JS_STRING_HELPERS_PY);
  });

  it('lowers replacement strings through the JS replacement-token helper', () => {
    const firstImports = new Set<string>();
    expect(rewriteExpr('s.replace("a", "$&")', [], [], {}, firstImports)).toBe('_kern_js_replace(s, "a", "$&", False)');
    expect(firstImports).toContain(KERN_JS_STRING_HELPERS_PY);

    const escapedImports = new Set<string>();
    expect(rewriteExpr('s.replace("a", "\\u0024&")', [], [], {}, escapedImports)).toBe(
      '_kern_js_replace(s, "a", "\\u0024&", False)',
    );
    expect(escapedImports).toContain(KERN_JS_STRING_HELPERS_PY);

    const allImports = new Set<string>();
    expect(rewriteExpr('s.replaceAll("a", "$$")', [], [], {}, allImports)).toBe('_kern_js_replace(s, "a", "$$", True)');
    expect(allImports).toContain(KERN_JS_STRING_HELPERS_PY);
  });
});
