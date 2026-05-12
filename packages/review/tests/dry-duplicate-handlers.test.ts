import type { IRNode } from '@kernlang/core';
import { lintDryDuplicateHandlers, tokenizeNormalized } from '../src/rules/dry-duplicate-handlers.js';
import type { InferResult, ReviewReport } from '../src/types.js';

function handlerNode(code: string, line = 1): IRNode {
  return {
    type: 'handler',
    props: { code },
    loc: { line, col: 1 },
  };
}

function fnNode(name: string, body: IRNode, line = 1): IRNode {
  return {
    type: 'fn',
    props: { name },
    children: [body],
    loc: { line, col: 1 },
  };
}

function inferred(node: IRNode, startLine = 1): InferResult {
  return {
    node,
    nodeId: `${node.type}:${(node.props?.name as string) || 'anon'}@${startLine}`,
    promptAlias: 'N1',
    startLine,
    endLine: startLine + 20,
    sourceSpans: [],
    summary: '',
    confidence: 'high',
    confidencePct: 95,
    kernTokens: 0,
    tsTokens: 0,
  };
}

function report(filePath: string, infers: InferResult[]): ReviewReport {
  return {
    filePath,
    inferred: infers,
    templateMatches: [],
    findings: [],
    stats: {
      totalLines: 100,
      coveredLines: 100,
      coveragePct: 100,
      totalTsTokens: 0,
      totalKernTokens: 0,
      reductionPct: 0,
      constructCount: 1,
    },
  };
}

const HANDLER_A_USERS = `
const user = req.body.user;
if (!user.email) {
  return res.status(400).json({ error: 'missing email' });
}
const existing = await db.users.findOne({ email: user.email });
if (existing) {
  return res.status(409).json({ error: 'exists' });
}
const created = await db.users.insert(user);
res.status(201).json(created);
`;

// Same logic, different identifier names — should still be detected.
const HANDLER_B_PRODUCTS = `
const product = req.body.product;
if (!product.sku) {
  return res.status(400).json({ error: 'missing sku' });
}
const existing = await db.products.findOne({ sku: product.sku });
if (existing) {
  return res.status(409).json({ error: 'exists' });
}
const created = await db.products.insert(product);
res.status(201).json(created);
`;

// Materially different — auth flow, not CRUD.
const HANDLER_C_AUTH = `
const { email, password } = req.body;
const user = await db.users.findOne({ email });
if (!user) {
  return res.status(401).json({ error: 'invalid' });
}
const ok = await bcrypt.compare(password, user.passwordHash);
if (!ok) {
  return res.status(401).json({ error: 'invalid' });
}
const token = jwt.sign({ uid: user.id }, JWT_SECRET);
res.json({ token });
`;

// Very short — under MIN_HANDLER_LINES, should be ignored.
const HANDLER_TINY = `res.json({ ok: true });`;

describe('tokenizeNormalized', () => {
  it('collapses identifiers but preserves keywords and punctuation', () => {
    const tokens = tokenizeNormalized('const userName = getUserName();');
    expect(tokens).toEqual(['const', '$IDENT', '=', '$IDENT', '(', ')', ';']);
  });

  it('collapses numeric and string literals to type tags', () => {
    const tokens = tokenizeNormalized('return "hello" + 42;');
    expect(tokens).toEqual(['return', '$STR', '+', '$NUM', ';']);
  });

  it('produces identical token streams for handlers that differ only in names', () => {
    const a = tokenizeNormalized(HANDLER_A_USERS);
    const b = tokenizeNormalized(HANDLER_B_PRODUCTS);
    expect(a).toEqual(b);
  });

  it('strips comments before tokenizing', () => {
    const withComments = `
// a leading comment
const x = 1; /* inline */ const y = 2;
`;
    const withoutComments = `
const x = 1;  const y = 2;
`;
    expect(tokenizeNormalized(withComments)).toEqual(tokenizeNormalized(withoutComments));
  });

  it('handles template literals without throwing', () => {
    expect(() => tokenizeNormalized('const x = `hello ${name}`;')).not.toThrow();
  });

  // Regression (Gemini impl-review P1): pre-tokenize comment stripping
  // corrupted strings containing `//`. The fix moves comment handling
  // into the loop, AFTER string detection.
  it('does not corrupt strings containing //', () => {
    const tokens = tokenizeNormalized('const url = "http://example.com";');
    // Five real tokens before the `;`: const ident = $STR ;
    expect(tokens).toEqual(['const', '$IDENT', '=', '$STR', ';']);
  });

  it('does not corrupt strings containing /* sequences', () => {
    const tokens = tokenizeNormalized('const re = "x /* not a comment */ y";');
    expect(tokens).toEqual(['const', '$IDENT', '=', '$STR', ';']);
  });

  // Regression (Gemini impl-review P3): # and @ used to fall to the
  // unknown-char skip, dropping discriminative tokens for class-based
  // handlers. They're now in PUNCT_RE.
  it('preserves # and @ as structural punctuation tokens', () => {
    const tokens = tokenizeNormalized('class X { @log #cache = 1 }');
    expect(tokens).toContain('@');
    expect(tokens).toContain('#');
  });
});

describe('lintDryDuplicateHandlers', () => {
  it('flags two handlers in different files with the same logic but different names', () => {
    const reports = [
      report('src/users.ts', [inferred(fnNode('createUser', handlerNode(HANDLER_A_USERS, 5)))]),
      report('src/products.ts', [inferred(fnNode('createProduct', handlerNode(HANDLER_B_PRODUCTS, 8)))]),
    ];
    const findings = lintDryDuplicateHandlers(reports);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.ruleId).toBe('dry-duplicate-handlers');
    expect(findings[0]?.severity).toBe('info');
    // Stable primary = alphabetically-first file.
    expect(findings[0]?.primarySpan.file).toBe('src/products.ts');
    expect(findings[0]?.relatedSpans?.[0]?.file).toBe('src/users.ts');
  });

  it('emits one finding per duplicate group (not per occurrence)', () => {
    const reports = [
      report('src/a.ts', [inferred(fnNode('createA', handlerNode(HANDLER_A_USERS, 1)))]),
      report('src/b.ts', [inferred(fnNode('createB', handlerNode(HANDLER_B_PRODUCTS, 1)))]),
      report('src/c.ts', [inferred(fnNode('createC', handlerNode(HANDLER_A_USERS, 1)))]),
    ];
    const findings = lintDryDuplicateHandlers(reports);
    expect(findings).toHaveLength(1);
    // The single finding should reference both peer handlers via relatedSpans.
    expect(findings[0]?.relatedSpans).toHaveLength(2);
  });

  it('does not flag dissimilar handlers', () => {
    const reports = [
      report('src/crud.ts', [inferred(fnNode('createUser', handlerNode(HANDLER_A_USERS, 1)))]),
      report('src/auth.ts', [inferred(fnNode('login', handlerNode(HANDLER_C_AUTH, 1)))]),
    ];
    const findings = lintDryDuplicateHandlers(reports);
    expect(findings).toHaveLength(0);
  });

  it('ignores handlers below the minimum line count', () => {
    const reports = [
      report('src/a.ts', [inferred(fnNode('a', handlerNode(HANDLER_TINY, 1)))]),
      report('src/b.ts', [inferred(fnNode('b', handlerNode(HANDLER_TINY, 1)))]),
    ];
    const findings = lintDryDuplicateHandlers(reports);
    expect(findings).toHaveLength(0);
  });

  it('does not compare a handler against itself when it appears in only one report', () => {
    const reports = [report('src/solo.ts', [inferred(fnNode('createUser', handlerNode(HANDLER_A_USERS, 1)))])];
    const findings = lintDryDuplicateHandlers(reports);
    expect(findings).toHaveLength(0);
  });

  it('produces a stable fingerprint across runs', () => {
    const reports = () => [
      report('src/users.ts', [inferred(fnNode('createUser', handlerNode(HANDLER_A_USERS, 5)))]),
      report('src/products.ts', [inferred(fnNode('createProduct', handlerNode(HANDLER_B_PRODUCTS, 8)))]),
    ];
    const first = lintDryDuplicateHandlers(reports())[0]?.fingerprint;
    const second = lintDryDuplicateHandlers(reports())[0]?.fingerprint;
    expect(first).toBeDefined();
    expect(first).toBe(second);
  });

  it('scales confidence with group size', () => {
    const pair = lintDryDuplicateHandlers([
      report('src/a.ts', [inferred(fnNode('a', handlerNode(HANDLER_A_USERS, 1)))]),
      report('src/b.ts', [inferred(fnNode('b', handlerNode(HANDLER_B_PRODUCTS, 1)))]),
    ]);
    const triple = lintDryDuplicateHandlers([
      report('src/a.ts', [inferred(fnNode('a', handlerNode(HANDLER_A_USERS, 1)))]),
      report('src/b.ts', [inferred(fnNode('b', handlerNode(HANDLER_B_PRODUCTS, 1)))]),
      report('src/c.ts', [inferred(fnNode('c', handlerNode(HANDLER_A_USERS, 1)))]),
    ]);
    expect(pair[0]?.confidence).toBeLessThan(triple[0]?.confidence ?? 0);
  });

  // Regression (Gemini impl-review P2-1): with overlapping ±1 token-band
  // buckets, two near-identical handlers landing on opposite sides of a
  // 10-token cliff still get compared. The old single-bucket version
  // would silently miss this pair.
  it('compares handlers on opposite sides of a token-count band boundary', () => {
    // Build two handlers that are near-identical structure but one has
    // one extra token. They should still group.
    const baseHandler = `
const a = req.body.foo;
const b = req.body.bar;
const c = a + b;
const d = c * 2;
const e = d + 1;
const f = e - 1;
const g = f * 3;
const h = g + 4;
const i = h - 2;
const j = i;
return j;
`;
    const extraHandler = `${baseHandler}return j;\n`;
    const reports = [
      report('src/a.ts', [inferred(fnNode('a', handlerNode(baseHandler, 1)))]),
      report('src/b.ts', [inferred(fnNode('b', handlerNode(extraHandler, 1)))]),
    ];
    const findings = lintDryDuplicateHandlers(reports);
    expect(findings.length).toBeGreaterThanOrEqual(1);
  });

  // Regression (OpenCode impl-review P2-A): confidence used to ignore the
  // actual Jaccard score — a 0.80 marginal pair scored identically to a
  // 0.99 near-clone. After the fix the near-clone scores higher.
  it('scales confidence with actual similarity, not just group size', () => {
    // HANDLER_A_USERS and HANDLER_B_PRODUCTS differ only in variable
    // names, so their normalized tokens are byte-identical → Jaccard=1.0.
    // The 2-member group with score 1.0 should land near the cap.
    const finding = lintDryDuplicateHandlers([
      report('src/a.ts', [inferred(fnNode('a', handlerNode(HANDLER_A_USERS, 1)))]),
      report('src/b.ts', [inferred(fnNode('b', handlerNode(HANDLER_B_PRODUCTS, 1)))]),
    ])[0];
    // Formula: min(80, round(40 + maxScore*30 + others*4)) with
    // maxScore≈1.0 and others=1 → round(40 + 30 + 4) = 74.
    expect(finding?.confidence).toBeGreaterThanOrEqual(70);
  });

  it('emits a useful message listing peer locations', () => {
    const reports = [
      report('src/users.ts', [inferred(fnNode('createUser', handlerNode(HANDLER_A_USERS, 5)))]),
      report('src/products.ts', [inferred(fnNode('createProduct', handlerNode(HANDLER_B_PRODUCTS, 8)))]),
    ];
    const finding = lintDryDuplicateHandlers(reports)[0];
    expect(finding?.message).toContain('createUser');
    expect(finding?.message).toContain('src/users.ts:5');
    expect(finding?.suggestion).toContain('shared helper');
  });
});
