import type { ConceptMap } from '@kernlang/core';
import { Project } from 'ts-morph';
import { bodyShapeDrift } from '../../src/concept-rules/body-shape-drift.js';
import { extractTsConcepts } from '../../src/mappers/ts-concepts.js';

// body-shape-drift with Zod-validated server schemas. Pre-PR the rule
// could only catch type mismatches when the handler ALSO had typed
// `req.body.X` reads (so `bodyFieldTypes[f]` was a real tag). The common
// real-world pattern — `Schema.parse(req.body)` and use `data.x` — left
// `bodyFieldTypes[f]` as `'unknown'` (req.body is the Express default
// `any`), so no /type finding ever fired.
//
// This PR threads `validatedBodyFieldTypes` through the entrypoint
// payload and lets the rule fall back to the schema's tags when the
// handler-read tag is `'unknown'` or absent. Iterates the union of
// handler-read and schema-validated field names so schema-only handlers
// still get checked.

function mergeMaps(...maps: ConceptMap[]): Map<string, ConceptMap> {
  const out = new Map<string, ConceptMap>();
  for (const m of maps) {
    const existing = out.get(m.filePath);
    if (existing) {
      out.set(m.filePath, { ...existing, nodes: [...existing.nodes, ...m.nodes] });
    } else {
      out.set(m.filePath, m);
    }
  }
  return out;
}

describe('body-shape-drift with Zod-validated server schemas', () => {
  const project = () => new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: true } });

  it('fires /type when client sends number for a z.boolean()-validated field on a schema-only handler', () => {
    const p = project();
    const clientSrc = `
      async function setActive() {
        await fetch('/api/users', {
          method: 'POST',
          body: JSON.stringify({ active: 1 }),
        });
      }
    `;
    // Schema-only handler: validates with z.object then uses 'data', NEVER
    // touches req.body.X directly. Pre-PR the rule would not fire because
    // bodyFieldsResolved was false (whole-body forwarding).
    const serverSrc = `
      import express from 'express';
      import { z } from 'zod';
      const app = express();
      app.post('/api/users', (req: any, res: any) => {
        const data = z.object({ active: z.boolean() }).parse(req.body);
        res.json({ ok: data.active });
      });
    `;
    const cf = '/client/api.ts';
    const sf = '/server/index.ts';
    const cMap = extractTsConcepts(p.createSourceFile(cf, clientSrc), cf);
    const sMap = extractTsConcepts(p.createSourceFile(sf, serverSrc), sf);
    const findings = bodyShapeDrift({
      concepts: cMap,
      filePath: cf,
      allConcepts: mergeMaps(cMap, sMap),
    });
    const typeFindings = findings.filter((f) => f.ruleId === 'body-shape-drift/type');
    expect(typeFindings).toHaveLength(1);
    expect(typeFindings[0].message).toMatch(/active/);
    expect(typeFindings[0].message).toMatch(/client `number` vs server `boolean`/);
  });

  it('uses validated tag as fallback when handler-read tag is unknown but both are present', () => {
    const p = project();
    const clientSrc = `
      async function update() {
        await fetch('/api/items', {
          method: 'POST',
          body: JSON.stringify({ count: 'three' }),
        });
      }
    `;
    // Hybrid: handler does inline validation AND reads req.body.count.
    // bodyFieldTypes['count'] = 'unknown' (req.body is any), but schema
    // says number. /type should fire on the schema's tag.
    const serverSrc = `
      import express from 'express';
      import { z } from 'zod';
      const app = express();
      app.post('/api/items', (req: any, res: any) => {
        z.object({ count: z.number() }).parse(req.body);
        const { count } = req.body;
        res.json({ count });
      });
    `;
    const cf = '/client/api.ts';
    const sf = '/server/index.ts';
    const cMap = extractTsConcepts(p.createSourceFile(cf, clientSrc), cf);
    const sMap = extractTsConcepts(p.createSourceFile(sf, serverSrc), sf);
    const findings = bodyShapeDrift({
      concepts: cMap,
      filePath: cf,
      allConcepts: mergeMaps(cMap, sMap),
    });
    const typeFindings = findings.filter((f) => f.ruleId === 'body-shape-drift/type');
    expect(typeFindings).toHaveLength(1);
    expect(typeFindings[0].message).toMatch(/count.*client `string` vs server `number`/);
  });

  it('peels Zod modifier chains (.optional, .min, .default) to the base tag', () => {
    const p = project();
    const clientSrc = `
      async function send() {
        await fetch('/api/x', {
          method: 'POST',
          body: JSON.stringify({ name: 42, age: 'ten' }),
        });
      }
    `;
    const serverSrc = `
      import express from 'express';
      import { z } from 'zod';
      const app = express();
      app.post('/api/x', (req: any, res: any) => {
        z.object({
          name: z.string().min(1).optional(),
          age: z.number().nonnegative().default(0),
        }).parse(req.body);
        res.json({});
      });
    `;
    const cf = '/client/api.ts';
    const sf = '/server/index.ts';
    const cMap = extractTsConcepts(p.createSourceFile(cf, clientSrc), cf);
    const sMap = extractTsConcepts(p.createSourceFile(sf, serverSrc), sf);
    const findings = bodyShapeDrift({
      concepts: cMap,
      filePath: cf,
      allConcepts: mergeMaps(cMap, sMap),
    });
    const typeFindings = findings.filter((f) => f.ruleId === 'body-shape-drift/type');
    expect(typeFindings).toHaveLength(1);
    // Both fields should be flagged on the same call.
    expect(typeFindings[0].message).toMatch(/name/);
    expect(typeFindings[0].message).toMatch(/age/);
  });

  it('is silent when client tag is unknown (no false positives on dynamic payloads)', () => {
    const p = project();
    const clientSrc = `
      async function send(payload: any) {
        await fetch('/api/x', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }
    `;
    const serverSrc = `
      import express from 'express';
      import { z } from 'zod';
      const app = express();
      app.post('/api/x', (req: any, res: any) => {
        z.object({ id: z.string() }).parse(req.body);
        res.json({});
      });
    `;
    const cf = '/client/api.ts';
    const sf = '/server/index.ts';
    const cMap = extractTsConcepts(p.createSourceFile(cf, clientSrc), cf);
    const sMap = extractTsConcepts(p.createSourceFile(sf, serverSrc), sf);
    const findings = bodyShapeDrift({
      concepts: cMap,
      filePath: cf,
      allConcepts: mergeMaps(cMap, sMap),
    });
    expect(findings.filter((f) => f.ruleId === 'body-shape-drift/type')).toHaveLength(0);
  });

  it('is silent on method mismatch (PUT vs POST on the same path)', () => {
    const p = project();
    const clientSrc = `
      async function send() {
        await fetch('/api/x', {
          method: 'PUT',
          body: JSON.stringify({ active: 1 }),
        });
      }
    `;
    const serverSrc = `
      import express from 'express';
      import { z } from 'zod';
      const app = express();
      app.post('/api/x', (req: any, res: any) => {
        z.object({ active: z.boolean() }).parse(req.body);
        res.json({});
      });
    `;
    const cf = '/client/api.ts';
    const sf = '/server/index.ts';
    const cMap = extractTsConcepts(p.createSourceFile(cf, clientSrc), cf);
    const sMap = extractTsConcepts(p.createSourceFile(sf, serverSrc), sf);
    const findings = bodyShapeDrift({
      concepts: cMap,
      filePath: cf,
      allConcepts: mergeMaps(cMap, sMap),
    });
    expect(findings).toHaveLength(0);
  });

  it('is silent when Zod schema tag is unknown (z.union with mixed tags)', () => {
    const p = project();
    const clientSrc = `
      async function send() {
        await fetch('/api/x', {
          method: 'POST',
          body: JSON.stringify({ value: 'hello' }),
        });
      }
    `;
    const serverSrc = `
      import express from 'express';
      import { z } from 'zod';
      const app = express();
      app.post('/api/x', (req: any, res: any) => {
        z.object({ value: z.union([z.string(), z.number()]) }).parse(req.body);
        res.json({});
      });
    `;
    const cf = '/client/api.ts';
    const sf = '/server/index.ts';
    const cMap = extractTsConcepts(p.createSourceFile(cf, clientSrc), cf);
    const sMap = extractTsConcepts(p.createSourceFile(sf, serverSrc), sf);
    const findings = bodyShapeDrift({
      concepts: cMap,
      filePath: cf,
      allConcepts: mergeMaps(cMap, sMap),
    });
    // Mixed-tag union coarsens to 'unknown' on the server side, so
    // /type stays silent — precision over recall.
    expect(findings.filter((f) => f.ruleId === 'body-shape-drift/type')).toHaveLength(0);
  });

  it('is silent on z.coerce.number() — coerce accepts strings (codex-flagged FP fix)', () => {
    // `z.coerce.number()` accepts string|number|boolean|bigint|date and
    // coerces them. So a client sending `{count: '42'}` is FINE — server
    // turns it into a number. Pre-fix the rule fired a false positive
    // because `z.coerce.number()` was tagged like `z.number()`. Now
    // coerce-rooted calls collapse to 'unknown' so /type stays silent.
    const p = project();
    const clientSrc = `
      async function send() {
        await fetch('/api/x', { method: 'POST', body: JSON.stringify({ count: 'abc' }) });
      }
    `;
    const serverSrc = `
      import express from 'express';
      import { z } from 'zod';
      const app = express();
      app.post('/api/x', (req: any, res: any) => {
        z.object({ count: z.coerce.number() }).parse(req.body);
        res.json({});
      });
    `;
    const cf = '/client/api.ts';
    const sf = '/server/index.ts';
    const cMap = extractTsConcepts(p.createSourceFile(cf, clientSrc), cf);
    const sMap = extractTsConcepts(p.createSourceFile(sf, serverSrc), sf);
    const findings = bodyShapeDrift({
      concepts: cMap,
      filePath: cf,
      allConcepts: mergeMaps(cMap, sMap),
    });
    expect(findings.filter((f) => f.ruleId === 'body-shape-drift/type')).toHaveLength(0);
  });

  it('is silent on response-schema parse(req.body) collisions (codex-flagged FP fix)', () => {
    // Pre-fix, schemaCallValidatesRequestBody walked ancestor TEXT up to
    // 5 levels, so any z.object inside a handler that ALSO had a
    // separate `Schema.parse(req.body)` was mis-tagged as the request
    // schema. Concretely: a response z.object({proceed:...}).parse(result)
    // would inherit the unrelated request-parse text and record proceed
    // as a request-validated field. A client sending `{proceed: 'yes'}`
    // (string) would then get a false /type vs server boolean.
    //
    // The chain-walk version requires the z.object to be the actual
    // receiver of the .parse(req.body) call.
    const p = project();
    const clientSrc = `
      async function send() {
        await fetch('/api/x', { method: 'POST', body: JSON.stringify({ proceed: 'yes' }) });
      }
    `;
    const serverSrc = `
      import express from 'express';
      import { z } from 'zod';
      const RequestSchema = z.object({ name: z.string() });
      const app = express();
      app.post('/api/x', (req: any, res: any) => {
        const body = RequestSchema.parse(req.body);
        const result = { proceed: true };
        const out = z.object({ proceed: z.boolean() }).parse(result);
        res.json(out);
      });
    `;
    const cf = '/client/api.ts';
    const sf = '/server/index.ts';
    const cMap = extractTsConcepts(p.createSourceFile(cf, clientSrc), cf);
    const sMap = extractTsConcepts(p.createSourceFile(sf, serverSrc), sf);
    const findings = bodyShapeDrift({
      concepts: cMap,
      filePath: cf,
      allConcepts: mergeMaps(cMap, sMap),
    });
    // No /type finding on the unrelated response schema field.
    expect(findings.filter((f) => f.ruleId === 'body-shape-drift/type')).toHaveLength(0);
  });

  it('is silent on z.string().or(z.number()) — peeling .or would fire on the other branch (codex-flagged FP fix)', () => {
    // Pre-fix, `.or` was a modifier and peeled to the LHS — `z.string().or(z.number())`
    // tagged as 'string'. A client sending a number would get a FP /type
    // even though server accepts both. Now `.or` falls through to 'unknown'.
    const p = project();
    const clientSrc = `
      async function send() {
        await fetch('/api/x', { method: 'POST', body: JSON.stringify({ value: 42 }) });
      }
    `;
    const serverSrc = `
      import express from 'express';
      import { z } from 'zod';
      const app = express();
      app.post('/api/x', (req: any, res: any) => {
        z.object({ value: z.string().or(z.number()) }).parse(req.body);
        res.json({});
      });
    `;
    const cf = '/client/api.ts';
    const sf = '/server/index.ts';
    const cMap = extractTsConcepts(p.createSourceFile(cf, clientSrc), cf);
    const sMap = extractTsConcepts(p.createSourceFile(sf, serverSrc), sf);
    const findings = bodyShapeDrift({
      concepts: cMap,
      filePath: cf,
      allConcepts: mergeMaps(cMap, sMap),
    });
    expect(findings.filter((f) => f.ruleId === 'body-shape-drift/type')).toHaveLength(0);
  });

  it('is silent on z.object({...}).omit({field: true}) — omit drops fields, recording them is wrong (codex-flagged FP fix)', () => {
    // `z.object({active: z.boolean()}).omit({active: true})` no longer
    // validates `active`. The chain-walk hits `.omit` (not in shape-
    // preserving allowlist) and bails — so no validatedBodyFieldTypes is
    // recorded for this z.object literal. /type stays silent.
    const p = project();
    const clientSrc = `
      async function send() {
        await fetch('/api/x', { method: 'POST', body: JSON.stringify({ active: 1 }) });
      }
    `;
    const serverSrc = `
      import express from 'express';
      import { z } from 'zod';
      const app = express();
      app.post('/api/x', (req: any, res: any) => {
        z.object({ active: z.boolean() }).omit({ active: true }).parse(req.body);
        res.json({});
      });
    `;
    const cf = '/client/api.ts';
    const sf = '/server/index.ts';
    const cMap = extractTsConcepts(p.createSourceFile(cf, clientSrc), cf);
    const sMap = extractTsConcepts(p.createSourceFile(sf, serverSrc), sf);
    const findings = bodyShapeDrift({
      concepts: cMap,
      filePath: cf,
      allConcepts: mergeMaps(cMap, sMap),
    });
    expect(findings.filter((f) => f.ruleId === 'body-shape-drift/type')).toHaveLength(0);
  });

  it('handles z.object({...}).partial() (gemini-flagged blocker, actually fine)', () => {
    // Gemini claimed chained outer-object modifiers like `.partial()`
    // skip extraction because the OUTER call has no object-literal arg.
    // Actually fine: `getDescendantsOfKind(CallExpression)` visits the
    // INNER `z.object({...})` call too, and its arg[0] IS the literal.
    const p = project();
    const clientSrc = `
      async function send() {
        await fetch('/api/x', { method: 'POST', body: JSON.stringify({ id: 42 }) });
      }
    `;
    const serverSrc = `
      import express from 'express';
      import { z } from 'zod';
      const app = express();
      app.post('/api/x', (req: any, res: any) => {
        z.object({ id: z.string() }).partial().parse(req.body);
        res.json({});
      });
    `;
    const cf = '/client/api.ts';
    const sf = '/server/index.ts';
    const cMap = extractTsConcepts(p.createSourceFile(cf, clientSrc), cf);
    const sMap = extractTsConcepts(p.createSourceFile(sf, serverSrc), sf);
    const findings = bodyShapeDrift({
      concepts: cMap,
      filePath: cf,
      allConcepts: mergeMaps(cMap, sMap),
    });
    expect(findings.filter((f) => f.ruleId === 'body-shape-drift/type')).toHaveLength(1);
  });

  it('prefers handler-read tag when both handler-read and validated are present and concrete', () => {
    const p = project();
    const clientSrc = `
      async function send() {
        await fetch('/api/x', {
          method: 'POST',
          body: JSON.stringify({ id: 'abc' }),
        });
      }
    `;
    // Typed body interface on the handler → bodyFieldTypes['id'] = 'string'.
    // Schema validates the same field as 'string' too. Client sends string.
    // No mismatch — must stay silent.
    const serverSrc = `
      import express from 'express';
      import { z } from 'zod';
      interface Body { id: string }
      const app = express();
      app.post('/api/x', (req: { body: Body }, res: any) => {
        z.object({ id: z.string() }).parse(req.body);
        const { id } = req.body;
        res.json({ id });
      });
    `;
    const cf = '/client/api.ts';
    const sf = '/server/index.ts';
    const cMap = extractTsConcepts(p.createSourceFile(cf, clientSrc), cf);
    const sMap = extractTsConcepts(p.createSourceFile(sf, serverSrc), sf);
    const findings = bodyShapeDrift({
      concepts: cMap,
      filePath: cf,
      allConcepts: mergeMaps(cMap, sMap),
    });
    expect(findings.filter((f) => f.ruleId === 'body-shape-drift/type')).toHaveLength(0);
  });
});
