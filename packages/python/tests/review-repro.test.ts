import { rewriteFastAPIExpr } from '../src/fastapi-response.js';

describe('rewriteFastAPIExpr - review reproduction', () => {
  test('chained calls', () => {
    // Current: [u for u in users if u.active].map((u) => u.name)
    // Desired: [u.name for u in [u for u in users if u.active]]
    expect(rewriteFastAPIExpr('users.filter((u) => u.active).map((u) => u.name)', [])).toBe(
      '[u.name for u in [u for u in users if u.active]]'
    );
  });

  test('parentheses in predicate', () => {
    // Current: users.filter((u) => (u.age > 18))
    // Desired: [u for u in users if (u.age > 18)]
    expect(rewriteFastAPIExpr('users.filter((u) => (u.age > 18))', [])).toBe(
      '[u for u in users if (u.age > 18)]'
    );
  });

  test('=== in strings', () => {
    // Current: const s = "a == b"
    // Desired: const s = "a === b"
    expect(rewriteFastAPIExpr('const s = "a === b"', [])).toBe('const s = "a === b"');
  });

  test('undefined usage', () => {
    // JS: users.find((u) => u.id === id) === undefined
    // Python: next((u for u in users if u.id == id), None) == None
    // Current: next((u for u in users if u.id == id), None) == undefined
    expect(rewriteFastAPIExpr('users.find((u) => u.id === id) === undefined', [])).toBe(
      'next((u for u in users if u.id == id), None) == None'
    );
  });
});
