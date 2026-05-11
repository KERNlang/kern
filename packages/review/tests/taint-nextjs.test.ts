/**
 * Next.js App Router + Pages Router taint coverage.
 *
 * Two improvements:
 *   1. HTTP_PARAM_TYPES tightened with word boundaries — `Request` no longer
 *      matches `UserRequest`, etc. NextRequest / NextApiRequest added.
 *   2. Next.js route-verb detection: in `app/**\/route.{ts,tsx}` or
 *      `pages/api/**` files, a top-level export named GET/POST/PUT/PATCH/
 *      DELETE/HEAD/OPTIONS taints its first param regardless of type
 *      annotation — covers untyped App Router handlers.
 */

import { reviewSource } from '../src/index.js';

describe('Next.js taint coverage', () => {
  // ── App Router (app/**/route.ts) ─────────────────────────────────

  it('fires on App Router GET handler with Request type → SQL injection', () => {
    const source = `
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get('id');
  return Response.json(await db.query(\`SELECT * FROM users WHERE id = \${id}\`));
}
`;
    const report = reviewSource(source, 'app/api/users/route.ts');
    const f = report.findings.find((f) => f.ruleId === 'taint-sql' || f.ruleId === 'taint-template');
    expect(f).toBeDefined();
  });

  it('fires on App Router POST handler with NextRequest → NoSQL injection via request.json()', () => {
    const source = `
import type { NextRequest } from 'next/server';
export async function POST(request: NextRequest) {
  const body = await request.json();
  const u = await User.findOne(body);
  return Response.json(u);
}
`;
    const report = reviewSource(source, 'app/api/users/route.ts');
    const f = report.findings.find((f) => f.ruleId === 'taint-nosql');
    expect(f).toBeDefined();
  });

  it('fires on UNTYPED App Router handler (Pass 2 verb detection)', () => {
    // `function GET(r) { … }` — `r` is not in HTTP_PARAM_NAMES, has no
    // type annotation. Without the route-verb pass, this would be
    // invisible to the engine.
    const source = `
export async function GET(r) {
  const id = new URL(r.url).searchParams.get('id');
  return Response.json(await db.query(\`SELECT * FROM users WHERE id = \${id}\`));
}
`;
    const report = reviewSource(source, 'app/api/users/route.ts');
    const f = report.findings.find((f) => f.ruleId === 'taint-sql' || f.ruleId === 'taint-template');
    expect(f).toBeDefined();
  });

  it('fires on App Router exported arrow handler (`export const POST = async (req) => …`)', () => {
    // Codex/Gemini plan-review caught: var-arrow exports lose their name
    // through the existing allFns walk. We now propagate the binding name
    // through so route-verb detection works.
    const source = `
export const POST = async (req: Request) => {
  await db.query(\`INSERT INTO logs VALUES (\${req.headers.get('x-info')})\`);
  return new Response('ok');
};
`;
    const report = reviewSource(source, 'app/api/log/route.ts');
    const f = report.findings.find((f) => f.ruleId === 'taint-sql' || f.ruleId === 'taint-template');
    expect(f).toBeDefined();
  });

  it('fires on App Router handler reaching SSRF sink', () => {
    const source = `
export async function POST(request: Request) {
  const target = await request.text();
  return await fetch(target);
}
`;
    const report = reviewSource(source, 'app/api/proxy/route.ts');
    const f = report.findings.find((f) => f.ruleId === 'taint-ssrf');
    expect(f).toBeDefined();
  });

  // ── Pages Router (pages/api/*.ts) ────────────────────────────────

  it('fires on Pages Router NextApiRequest → open redirect', () => {
    const source = `
import type { NextApiRequest, NextApiResponse } from 'next';
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.redirect(req.query.url as string);
}
`;
    const report = reviewSource(source, 'pages/api/go.ts');
    const f = report.findings.find((f) => f.ruleId === 'taint-redirect' || f.ruleId === 'open-redirect');
    expect(f).toBeDefined();
  });

  // ── FP guards ────────────────────────────────────────────────────

  it('does NOT fire on a function named GET outside a route file', () => {
    // `export function GET(r)` in a utility file — the route-verb gate
    // requires file-path match.
    const source = `
export async function GET(r: { url: string }) {
  return r.url.toUpperCase();
}
async function caller(): Promise<void> {
  await db.query(\`SELECT * FROM logs WHERE event = '\${await GET({ url: '/x' })}'\`);
}
`;
    const report = reviewSource(source, 'utils/http.ts');
    // The GET handler isn't a route — its `r` param shouldn't be tainted.
    // (taint-sql may still fire on the caller side if the engine traces
    // GET's return value as tainted via interprocedural analysis; the
    // assertion focuses on the handler itself.)
    const handlerFindings = report.findings.filter(
      (f) => f.ruleId === 'taint-sql' && f.message.includes('Next.js route handler'),
    );
    expect(handlerFindings).toHaveLength(0);
  });

  it('does NOT match types whose name embeds Request (UserRequest, AuthorizedRequest)', () => {
    // Codex plan-review: tightened HTTP_PARAM_TYPES with word boundaries.
    // Otherwise an internal type like `UserRequest` (a domain model, not an
    // HTTP request) would taint its arg.
    const source = `
interface UserRequest { kind: 'create' | 'update'; id: string; }
export function processRequest(req: UserRequest): string {
  return \`UPDATE users SET kind = '\${req.kind}'\`;
}
`;
    const report = reviewSource(source, 'domain.ts');
    const f = report.findings.find((f) => f.ruleId.startsWith('taint-'));
    expect(f).toBeUndefined();
  });

  // ── Impl-review additions ────────────────────────────────────────

  it('fires on UNTYPED arrow export `export const GET = async (r) => …` (OpenCode impl-review)', () => {
    // Variant of the typed arrow test — covers no annotation. Exercises
    // both the var-arrow name capture and the route-verb gate.
    const source = `
export const GET = async (r) => {
  const id = new URL(r.url).searchParams.get('id');
  return Response.json(await db.query(\`SELECT * FROM users WHERE id = \${id}\`));
};
`;
    const report = reviewSource(source, 'app/api/users/route.ts');
    const f = report.findings.find((f) => f.ruleId === 'taint-sql' || f.ruleId === 'taint-template');
    expect(f).toBeDefined();
  });

  it('fires on local non-exported helper named GET inside a route file (Codex impl-review FP fix — must NOT fire)', () => {
    const source = `
function GET(r: { url: string }) {
  return db.query(\`SELECT * FROM logs WHERE event = '\${r.url}'\`);
}
export async function POST(req: Request) {
  return new Response('ok');
}
`;
    const report = reviewSource(source, 'app/api/log/route.ts');
    // Local GET shouldn't be tainted as a route handler.
    const handlerFindings = report.findings.filter(
      (f) => (f.ruleId === 'taint-sql' || f.ruleId === 'taint-template') && f.message.includes('Next.js route handler'),
    );
    expect(handlerFindings).toHaveLength(0);
  });

  it('fires on root app/route.ts handler (Codex impl-review FN fix — empty intermediate segment)', () => {
    const source = `
export async function GET(r) {
  await db.query(\`SELECT * FROM x WHERE q = '\${new URL(r.url).searchParams.get('q')}'\`);
  return new Response('ok');
}
`;
    const report = reviewSource(source, 'app/route.ts');
    const f = report.findings.find((f) => f.ruleId === 'taint-sql' || f.ruleId === 'taint-template');
    expect(f).toBeDefined();
  });

  it('fires on second `{ params }` arg of App Router handler (Gemini impl-review)', () => {
    const source = `
export async function GET(req: Request, { params }: { params: { id: string } }) {
  await db.query(\`SELECT * FROM users WHERE id = '\${params.id}'\`);
  return new Response('ok');
}
`;
    const report = reviewSource(source, 'app/api/users/[id]/route.ts');
    const f = report.findings.find((f) => f.ruleId === 'taint-sql' || f.ruleId === 'taint-template');
    expect(f).toBeDefined();
  });

  it('fires on PATCH and DELETE verb handlers (broader verb coverage)', () => {
    const patchSource = `
export async function PATCH(req: Request) {
  const body = await req.json();
  await User.findOneAndUpdate({ _id: 'x' }, body);
  return new Response('ok');
}
`;
    const patchReport = reviewSource(patchSource, 'app/api/users/route.ts');
    expect(patchReport.findings.find((f) => f.ruleId === 'taint-nosql')).toBeDefined();

    const delSource = `
export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get('id');
  await db.query(\`DELETE FROM users WHERE id = \${id}\`);
  return new Response('ok');
}
`;
    const delReport = reviewSource(delSource, 'app/api/users/route.ts');
    expect(delReport.findings.find((f) => f.ruleId === 'taint-sql' || f.ruleId === 'taint-template')).toBeDefined();
  });

  // ── RULE-FEEDBACK.md #2: constant-folded new URL(literal, taintedBase) ──

  it('does NOT fire taint-redirect on new URL("/literal", request.url)', () => {
    // The first arg to `new URL` starting with "/" makes the constructor
    // ignore the path of `base`. The redirect target is always
    // `<own-origin>/literal` — attacker can't influence the path.
    const source = `
import { NextResponse, type NextRequest } from 'next/server';
export async function GET(request: NextRequest) {
  if (request.headers.get('x-fail')) return NextResponse.json({}, { status: 404 });
  return NextResponse.redirect(new URL('/next-assets/images/placeholder.jpg', request.url));
}
`;
    const report = reviewSource(source, 'app/api/mock/route.ts');
    const f = report.findings.find((f) => f.ruleId === 'taint-redirect');
    expect(f).toBeUndefined();
  });

  // Regression guard: template literals and non-literal first args MUST still
  // fire — those can carry attacker-controlled path segments.
  it('STILL fires taint-redirect on new URL(`${tainted}`, request.url)', () => {
    const source = `
import { NextResponse, type NextRequest } from 'next/server';
export async function GET(request: NextRequest) {
  const next = new URL(request.url).searchParams.get('next') || '';
  return NextResponse.redirect(new URL(\`/redirect/\${next}\`, request.url));
}
`;
    const report = reviewSource(source, 'app/api/r/route.ts');
    const f = report.findings.find((f) => f.ruleId === 'taint-redirect');
    expect(f).toBeDefined();
  });

  it('STILL fires taint-redirect on raw NextResponse.redirect(req.query.url)', () => {
    const source = `
import { NextResponse, type NextRequest } from 'next/server';
export async function GET(request: NextRequest) {
  const url = new URL(request.url).searchParams.get('next') || '';
  return NextResponse.redirect(url);
}
`;
    const report = reviewSource(source, 'app/api/r/route.ts');
    const f = report.findings.find((f) => f.ruleId === 'taint-redirect');
    expect(f).toBeDefined();
  });
});
