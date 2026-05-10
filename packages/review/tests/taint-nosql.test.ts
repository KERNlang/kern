/**
 * NoSQL injection (Mongo / Mongoose) — receiver-aware sink with arg-index gating.
 *
 * Why receiver-aware: method names like `find`, `findOne`, `updateOne`, `count`
 * collide with Array.prototype and would FP on every JS array call if added
 * flat to SINK_NAMES. The taint engine's `isNoSQLSinkContext` gate accepts:
 *   - Capitalized identifier receivers (`User.find`, `OrderModel.find`)
 *   - `db.collection('x')` chains
 *   - One alias hop (`const users = db.collection('users'); users.find(...)`)
 */

import { reviewSource } from '../src/index.js';

describe('taint-nosql', () => {
  // ── Positive: must fire ────────────────────────────────────────────

  it('fires on Mongoose model.find with tainted req.body filter', () => {
    const source = `
export async function search(req: any, res: any) {
  const users = await User.find({ email: req.body.email });
  res.json(users);
}
`;
    const report = reviewSource(source, 'h.ts');
    const f = report.findings.find((f) => f.ruleId === 'taint-nosql');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('error');
  });

  it('fires on db.collection().findOne with tainted req.params._id', () => {
    const source = `
export async function get(req: any, res: any) {
  const u = await db.collection('users').findOne({ _id: req.params.id });
  res.json(u);
}
`;
    const report = reviewSource(source, 'h.ts');
    const f = report.findings.find((f) => f.ruleId === 'taint-nosql');
    expect(f).toBeDefined();
  });

  it('fires on findOneAndUpdate with tainted update document (arg index 1)', () => {
    const source = `
export async function update(req: any, res: any) {
  const post = await Post.findOneAndUpdate({ _id: 'hardcoded' }, req.body);
  res.json(post);
}
`;
    const report = reviewSource(source, 'h.ts');
    const f = report.findings.find((f) => f.ruleId === 'taint-nosql');
    expect(f).toBeDefined();
  });

  it('fires on aggregate pipeline with tainted $match', () => {
    const source = `
export async function pipe(req: any, res: any) {
  const docs = await User.aggregate([{ $match: req.body }]);
  res.json(docs);
}
`;
    const report = reviewSource(source, 'h.ts');
    const f = report.findings.find((f) => f.ruleId === 'taint-nosql');
    expect(f).toBeDefined();
  });

  it('fires through one alias hop (const users = db.collection(...))', () => {
    const source = `
export async function query(req: any, res: any) {
  const users = db.collection('users');
  const u = await users.findOne({ email: req.body.email });
  res.json(u);
}
`;
    const report = reviewSource(source, 'h.ts');
    const f = report.findings.find((f) => f.ruleId === 'taint-nosql');
    expect(f).toBeDefined();
  });

  it('fires on findById with object-shaped tainted req.body', () => {
    // qs/body-parser parses `?id[$gt]=` into an object — req.body.id can be
    // an object payload. We can't statically prove it's object vs string, so
    // we fire when source is body/query (object-possible).
    const source = `
export async function getById(req: any, res: any) {
  const u = await User.findById(req.body.id);
  res.json(u);
}
`;
    const report = reviewSource(source, 'h.ts');
    const f = report.findings.find((f) => f.ruleId === 'taint-nosql');
    expect(f).toBeDefined();
  });

  // ── Negative: must NOT fire ────────────────────────────────────────

  it('does NOT fire on Array.prototype.find', () => {
    const source = `
export function findUser(req: any, items: any[]) {
  return items.find((x) => x.id === req.params.id);
}
`;
    const report = reviewSource(source, 'h.ts');
    const f = report.findings.find((f) => f.ruleId === 'taint-nosql');
    expect(f).toBeUndefined();
  });

  it('does NOT fire on lowercase identifier receiver without scope tracking', () => {
    // `users.find` where `users` is a local array (no alias hop to a Mongo
    // collection) — the receiver gate rejects it.
    const source = `
export function pickUser(req: any) {
  const users = [{ id: 1 }, { id: 2 }];
  return users.find((u) => u.id === req.params.id);
}
`;
    const report = reviewSource(source, 'h.ts');
    const f = report.findings.find((f) => f.ruleId === 'taint-nosql');
    expect(f).toBeUndefined();
  });

  it('does NOT fire on findById with scalar req.params.id (string is literal _id, not operator)', () => {
    // Codex plan-review: route segments are strings; Mongo treats them as
    // literal _id values. Classic operator injection requires object input.
    const source = `
export async function get(req: any, res: any) {
  const u = await User.findById(req.params.id);
  res.json(u);
}
`;
    const report = reviewSource(source, 'h.ts');
    const f = report.findings.find((f) => f.ruleId === 'taint-nosql');
    expect(f).toBeUndefined();
  });

  it('does NOT fire on hardcoded query', () => {
    const source = `
export async function active(_req: any, res: any) {
  const docs = await User.find({ status: 'active' });
  res.json(docs);
}
`;
    const report = reviewSource(source, 'h.ts');
    const f = report.findings.find((f) => f.ruleId === 'taint-nosql');
    expect(f).toBeUndefined();
  });

  it('does NOT fire when query is schema-validated', () => {
    const source = `
import { z } from 'zod';
const schema = z.object({ email: z.string() });
export async function search(req: any, res: any) {
  const validated = schema.parse(req.body);
  const u = await User.findOne(validated);
  res.json(u);
}
`;
    const report = reviewSource(source, 'h.ts');
    const f = report.findings.find((f) => f.ruleId === 'taint-nosql');
    expect(f).toBeUndefined();
  });

  it('does NOT fire on projection argument (arg index 1 of find)', () => {
    // Mongoose `find(query, projection)` — only arg 0 is the filter.
    // A tainted projection is not classic injection (Mongo treats unknown
    // operators as literal field selectors).
    const source = `
export async function search(req: any, res: any) {
  const docs = await User.find({ status: 'active' }, req.body.fields);
  res.json(docs);
}
`;
    const report = reviewSource(source, 'h.ts');
    const f = report.findings.find((f) => f.ruleId === 'taint-nosql');
    expect(f).toBeUndefined();
  });

  // ── Impl-review additions ──────────────────────────────────────────

  it('does NOT fire on findById through one alias hop (Codex impl-review)', () => {
    // `const id = req.params.id; User.findById(id)` — the alias hides the
    // `req.params` origin from the simple path matcher. resolveStaticOriginPath
    // follows the variable's initializer one step.
    const source = `
export async function get(req: any, res: any) {
  const id = req.params.id;
  const u = await User.findById(id);
  res.json(u);
}
`;
    const report = reviewSource(source, 'h.ts');
    const f = report.findings.find((f) => f.ruleId === 'taint-nosql');
    expect(f).toBeUndefined();
  });

  it('does NOT fire on findById with Fastify-style request.params.id', () => {
    const source = `
export async function get(request: any, reply: any) {
  const u = await User.findById(request.params.id);
  reply.send(u);
}
`;
    const report = reviewSource(source, 'h.ts');
    const f = report.findings.find((f) => f.ruleId === 'taint-nosql');
    expect(f).toBeUndefined();
  });

  it('fires on Mongoose fluent .where() chain (Gemini impl-review — fluent API)', () => {
    const source = `
export async function filter(req: any, res: any) {
  const docs = await User.find({}).where(req.body.field).equals(req.body.val);
  res.json(docs);
}
`;
    const report = reviewSource(source, 'h.ts');
    const f = report.findings.find((f) => f.ruleId === 'taint-nosql');
    expect(f).toBeDefined();
  });

  it('fires through db.getCollection() chain (Mongo driver factory)', () => {
    const source = `
export async function get(req: any, res: any) {
  const u = await db.getCollection('users').findOne({ email: req.body.email });
  res.json(u);
}
`;
    const report = reviewSource(source, 'h.ts');
    const f = report.findings.find((f) => f.ruleId === 'taint-nosql');
    expect(f).toBeDefined();
  });

  it('does NOT fire on internal helper that only forwards projection (interprocedural arg-index)', () => {
    // Codex impl-review: buildInternalSinkMap was promoting params into the
    // sink set without arg-index gating, so a helper that forwards a
    // projection (idx 1) marked the param as tainted-flowing-to-nosql.
    const source = `
function search(query: any, projection: any) {
  return User.find(query, projection);
}
export async function handler(req: any, res: any) {
  const docs = await search({ status: 'active' }, req.body.fields);
  res.json(docs);
}
`;
    const report = reviewSource(source, 'h.ts');
    const f = report.findings.find((f) => f.ruleId === 'taint-nosql');
    expect(f).toBeUndefined();
  });
});
