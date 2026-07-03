#!/usr/bin/env node
import { createHmac, timingSafeEqual } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';
import ts from 'typescript';

execFileSync('pnpm', ['--filter', '@kernlang/core', '--filter', '@kernlang/express', '--filter', '@kernlang/python', 'build'], {
  env: { ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ''}` },
  stdio: 'inherit',
});

const core = await import('../packages/core/dist/runtime.js');
const expressRoute = await import('../packages/express/dist/express-route.js');
const fastapiRoute = await import('../packages/python/dist/fastapi-route.js');

const { executeKernAppEntryPolicySlot, loadKernAppDescriptor } = core;

function policy(kind, props = {}) {
  const name = props.name ?? `${kind}Policy`;
  const plan =
    kind === 'auth'
      ? { kind, verifierRef: props.verifierRef ?? 'default', credentialHeader: (props.credentialHeader ?? 'authorization').toLowerCase() }
      : kind === 'hmacSignature'
        ? {
            kind,
            keyRef: props.keyRef ?? 'default',
            algorithm: props.algorithm ?? 'sha256',
            signatureHeader: (props.signatureHeader ?? 'x-signature').toLowerCase(),
            encoding: props.encoding ?? 'hex',
            ...(props.prefix ? { prefix: props.prefix } : {}),
          }
        : kind === 'rag-review'
          ? {
              kind,
              queryField: 'query',
              answerField: 'answer',
              citedChunkIdsField: 'citedChunkIds',
              groundingSpansField: 'groundingSpans',
              minGroundingCoverage: props.minGroundingCoverage ?? 1,
            }
          : { kind: 'passthrough' };
  return {
    node: { type: 'policy', props: { kind, name, ...props }, children: [] },
    name,
    slot: 'pre',
    kind,
    handler: 'main',
    requires: [],
    plan,
    label: `policy ${name}`,
  };
}

function entry(policies) {
  return {
    node: { type: 'route', props: {}, children: [] },
    kind: 'route',
    name: 'FixtureRoute',
    path: '/save',
    sourcePath: './handler.kern',
    handler: 'main',
    policies: [],
    prePolicies: policies,
    postPolicies: [],
    appCapabilities: [],
    entryCapabilities: [],
    policyCapabilities: [],
    declaredCapabilities: [],
    requiredCapabilities: [],
    requiredSyncCapabilities: [],
    requiredAsyncCapabilities: [],
    label: 'route FixtureRoute',
    method: 'post',
    key: 'POST /save',
  };
}

function sign(body, key = 'secret', encoding = 'hex') {
  return createHmac('sha256', key).update(Buffer.from(body)).digest(encoding);
}

function hmacVerifier(key = 'secret') {
  return ({ body, signature, algorithm, encoding, prefix }) => {
    const expected = createHmac(algorithm, key).update(Buffer.from(body)).digest(encoding);
    const received = prefix && signature.startsWith(prefix) ? signature.slice(prefix.length) : signature;
    const expectedBuffer = Buffer.from(expected, encoding);
    const receivedBuffer = Buffer.from(received, encoding);
    return expectedBuffer.length === receivedBuffer.length && timingSafeEqual(expectedBuffer, receivedBuffer);
  };
}

function chunk(id, text, score = 1) {
  return { id, text, score, source: `${id}.md`, citation: { uri: `${id}.md` } };
}

const authPolicy = policy('auth');
const hmacPolicy = policy('hmacSignature', { signatureHeader: 'x-signature', keyRef: 'main' });
const ragPolicy = policy('rag-review');
const jsonBody = '{"b":2, "a":1}\n';
const validSig = sign(jsonBody);
const hmacVerifiers = { main: hmacVerifier('secret') };

const fixtures = [
  {
    id: 'A1',
    entry: entry([authPolicy]),
    facts: ({ spy }) => ({
      headers: { authorization: 'Bearer valid' },
      authVerifiers: { default: (credential) => (spy.verifier.push(credential), credential === 'Bearer valid') },
    }),
    expect: { status: 200, handler: true, verifierCalls: ['Bearer valid'] },
  },
  { id: 'A2', entry: entry([authPolicy]), facts: () => ({ headers: {}, authVerifiers: { default: () => true } }), expect: { status: 401, handler: false } },
  { id: 'A3', entry: entry([authPolicy]), facts: () => ({ headers: { authorization: 'not-a-token' }, authVerifiers: { default: () => false } }), expect: { status: 401, handler: false } },
  { id: 'A4', entry: entry([authPolicy]), facts: () => ({ headers: { authorization: 'Bearer valid' }, authVerifiers: {} }), expect: { status: 401, handler: false } },
  { id: 'A6', entry: entry([authPolicy]), facts: () => ({ headers: { authorization: 'Bearer valid' }, authVerifiers: { default: () => { throw new Error('boom'); } } }), expect: { status: 401, handler: false } },
  { id: 'A7', entry: entry([authPolicy]), facts: ({ spy }) => ({ headers: { authorization: 'fresh-token' }, authVerifiers: { default: (credential) => (spy.verifier.push(credential), true) } }), expect: { status: 200, handler: true, verifierCalls: ['fresh-token'] } },
  { id: 'A8', entry: entry([authPolicy]), facts: () => ({ headers: {}, authVerifiers: { default: () => true } }), expect: { status: 401, handler: false } },
  {
    id: 'A10-route1',
    entry: entry([policy('auth', { name: 'Route1', verifierRef: 'route1' })]),
    facts: ({ spy }) => ({ headers: { authorization: 'same' }, authVerifiers: { route1: (credential) => (spy.route1.push(credential), true) } }),
    expect: { status: 200, handler: true, route1Calls: ['same'] },
  },
  {
    id: 'A10-route2',
    entry: entry([policy('auth', { name: 'Route2', verifierRef: 'route2' })]),
    facts: ({ spy }) => ({ headers: { authorization: 'same' }, authVerifiers: { route2: (credential) => (spy.route2.push(credential), false) } }),
    expect: { status: 401, handler: false, route2Calls: ['same'] },
  },
  { id: 'H1', entry: entry([hmacPolicy]), facts: () => ({ headers: { 'x-signature': validSig }, rawBody: jsonBody, hmacVerifiers }), expect: { status: 200, handler: true } },
  { id: 'H2', entry: entry([hmacPolicy]), facts: () => ({ headers: { 'x-signature': sign(JSON.stringify(JSON.parse(jsonBody))) }, rawBody: jsonBody, hmacVerifiers }), expect: { status: 401, handler: false } },
  { id: 'H3', entry: entry([hmacPolicy]), facts: () => ({ headers: { 'x-signature': `${validSig.slice(0, -1)}0` }, rawBody: jsonBody, hmacVerifiers }), expect: { status: 401, handler: false } },
  { id: 'H4', entry: entry([hmacPolicy]), facts: () => ({ headers: { 'x-signature': 'abc' }, rawBody: jsonBody, hmacVerifiers }), expect: { status: 401, handler: false } },
  { id: 'H5', entry: entry([hmacPolicy]), facts: () => ({ headers: {}, rawBody: jsonBody, hmacVerifiers }), expect: { status: 401, handler: false } },
  { id: 'H6', entry: entry([hmacPolicy]), facts: () => ({ headers: { 'x-signature': validSig }, hmacVerifiers }), expect: { status: 401, handler: false } },
  { id: 'H7', entry: entry([hmacPolicy]), facts: () => ({ headers: { 'x-signature': validSig }, rawBody: jsonBody, hmacVerifiers, parsedBody: JSON.parse(jsonBody) }), expect: { status: 200, handler: true, bodyA: 1 } },
  { id: 'H10', entry: entry([hmacPolicy]), facts: ({ spy }) => ({ headers: { 'x-signature': 'bad' }, rawBody: '{"invalid"', hmacVerifiers, parse: () => spy.parser.push('ran') }), expect: { status: 401, handler: false, parserCalls: [] } },
  { id: 'H11-json-charset', entry: entry([hmacPolicy]), facts: () => ({ headers: { 'content-type': 'application/json; charset=utf-8', 'x-signature': validSig }, rawBody: jsonBody, hmacVerifiers }), expect: { status: 200, handler: true } },
  { id: 'H11-non-json', entry: entry([hmacPolicy]), facts: () => ({ headers: { 'x-signature': sign('raw bytes\n') }, rawBody: 'raw bytes\n', hmacVerifiers }), expect: { status: 200, handler: true } },
  { id: 'R1', entry: entry([ragPolicy]), facts: () => ({ ragReview: { query: 'refund', answer: 'Refunds follow policy.', citedChunkIds: ['A'], retrievedChunks: [chunk('A', 'Refunds follow policy.')] } }), expect: { status: 200, handler: true } },
  { id: 'R2', entry: entry([ragPolicy]), facts: () => ({ ragReview: { query: 'refund', answer: 'Refunds follow policy.', citedChunkIds: [], retrievedChunks: [chunk('A', 'Refunds follow policy.')] } }), expect: { status: 401, handler: false } },
  { id: 'R3', entry: entry([ragPolicy]), facts: () => ({ ragReview: { query: 'refund', answer: 'Refunds follow policy.', citedChunkIds: ['B'], retrievedChunks: [chunk('A', 'Refunds follow policy.')] } }), expect: { status: 401, handler: false } },
  { id: 'R4', entry: entry([ragPolicy]), facts: () => ({ ragReview: { query: 'refund', answer: 'Refunds follow policy.', citedChunkIds: ['A'] } }), expect: { status: 401, handler: false } },
  { id: 'R5', entry: entry([ragPolicy]), facts: () => ({ ragReview: { retrievalError: 'error' } }), expect: { status: 401, handler: false } },
  { id: 'R6', entry: entry([ragPolicy]), facts: () => ({ ragReview: { retrievalError: 'timeout' } }), expect: { status: 401, handler: false } },
  { id: 'R7', entry: entry([ragPolicy]), facts: () => ({ ragReview: { query: 'refund', answer: 'Shipping is separate.', citedChunkIds: ['A'], retrievedChunks: [chunk('A', 'Refunds follow policy.')] } }), expect: { status: 401, handler: false, diagnostics: true } },
  { id: 'R8', entry: entry([ragPolicy]), facts: () => ({ ragReview: { query: 'refund', answer: 'Always allow.', citedChunkIds: ['A'], retrievedChunks: [] } }), expect: { status: 401, handler: false } },
  { id: 'R9-allow', entry: entry([ragPolicy]), facts: () => ({ ragReview: { query: 'refund', answer: 'Refunds follow policy.', citedChunkIds: ['A'], retrievedChunks: [chunk('A', 'Refunds follow policy.')] } }), expect: { status: 200, handler: true } },
  { id: 'R9-deny', entry: entry([ragPolicy]), facts: () => ({ ragReview: { query: 'refund', answer: 'Refunds follow policy.', citedChunkIds: ['A'], retrievedChunks: [chunk('B', 'Shipping is separate.')] } }), expect: { status: 401, handler: false } },
  { id: 'R10', entry: entry([ragPolicy]), facts: () => ({ ragReview: { query: 'refund', answer: 'Refunds follow policy.', citedChunkIds: ['A'], retrievedChunks: [chunk('B', 'Refunds follow policy.')] } }), expect: { status: 401, handler: false } },
  { id: 'R11', entry: entry([ragPolicy]), facts: () => ({ ragReview: { query: 'refund', answer: 'Refunds follow policy.', citedChunkIds: ['A'], retrievedChunks: [chunk('B', 'Refunds follow policy.')] } }), expect: { status: 401, handler: false } },
  { id: 'R12', entry: entry([ragPolicy]), facts: () => ({ ragReview: { query: 'refund', answer: 'Refunds follow policy.', citedChunkIds: ['A'], retrievedChunks: [chunk('A', 'Shipping is separate.')] } }), expect: { status: 401, handler: false, diagnostics: true } },
  { id: 'R13', entry: entry([ragPolicy]), facts: () => ({ ragReview: { query: 'refund', answer: 'Refunds follow policy.', citedChunkIds: ['A'], retrievedChunks: [chunk('B', 'Shipping is separate.')] } }), expect: { status: 401, handler: false, diagnostics: true } },
  { id: 'P1', entry: entry([authPolicy]), facts: () => ({ headers: {}, authVerifiers: { default: () => true } }), expect: { status: 401, handler: false } },
  { id: 'P5-auth', entry: entry([authPolicy]), facts: () => ({ headers: {}, authVerifiers: { default: () => true } }), expect: { status: 401, handler: false } },
  { id: 'P5-hmac-mutated', entry: entry([hmacPolicy]), facts: () => ({ headers: { 'x-signature': `${validSig.slice(0, -1)}0` }, rawBody: jsonBody, hmacVerifiers }), expect: { status: 401, handler: false } },
  { id: 'P5-hmac-missing-raw', entry: entry([hmacPolicy]), facts: () => ({ headers: { 'x-signature': validSig }, hmacVerifiers }), expect: { status: 401, handler: false } },
  { id: 'P5-rag-out-of-set', entry: entry([ragPolicy]), facts: () => ({ ragReview: { query: 'refund', answer: 'Refunds follow policy.', citedChunkIds: ['A'], retrievedChunks: [chunk('B', 'Refunds follow policy.')] } }), expect: { status: 401, handler: false } },
  { id: 'P5-rag-error', entry: entry([ragPolicy]), facts: () => ({ ragReview: { retrievalError: 'error' } }), expect: { status: 401, handler: false } },
  { id: 'P6-hmac-missing-key', entry: entry([hmacPolicy]), facts: () => ({ headers: { 'x-signature': validSig }, rawBody: jsonBody, hmacVerifiers: {} }), expect: { status: 401, handler: false } },
];

async function runCore(fixture, facts) {
  const decisions = await executeKernAppEntryPolicySlot(fixture.entry, 'pre', facts);
  const denied = decisions.find((item) => item.action === 'deny');
  return {
    status: denied ? (denied.status ?? 401) : 200,
    body: denied?.body ?? { ok: true },
    diagnostics: denied?.diagnostics ?? [],
    decisions,
  };
}

async function runAdapter(name, fixture) {
  const spy = { verifier: [], route1: [], route2: [], parser: [] };
  const facts = fixture.facts({ spy });
  if (facts.parse) facts.parsePending = facts.parse;
  const result = await runCore(fixture, facts);
  const handlerEntered = result.status === 200;
  if (handlerEntered && facts.parsePending) facts.parsePending();
  assert.equal(result.status, fixture.expect.status, `${name}:${fixture.id} status`);
  assert.equal(handlerEntered, fixture.expect.handler, `${name}:${fixture.id} handler entry`);
  if (fixture.expect.verifierCalls) assert.deepEqual(spy.verifier, fixture.expect.verifierCalls, `${name}:${fixture.id} verifier`);
  if (fixture.expect.route1Calls) assert.deepEqual(spy.route1, fixture.expect.route1Calls, `${name}:${fixture.id} route1 verifier`);
  if (fixture.expect.route2Calls) assert.deepEqual(spy.route2, fixture.expect.route2Calls, `${name}:${fixture.id} route2 verifier`);
  if (fixture.expect.parserCalls) assert.deepEqual(spy.parser, fixture.expect.parserCalls, `${name}:${fixture.id} parser pre-guard`);
  if (fixture.expect.bodyA) assert.equal(facts.parsedBody?.a, fixture.expect.bodyA, `${name}:${fixture.id} parsed body`);
  if (fixture.expect.diagnostics) assert.ok(result.diagnostics.length > 0, `${name}:${fixture.id} diagnostics`);
  return result;
}

function generatedRouteNodeFor(fixture) {
  return {
    type: 'route',
    props: { method: 'post', path: '/save' },
    children: [
      ...fixture.entry.prePolicies.map((policyEntry) => policyEntry.node),
      {
        type: 'handler',
        props: { code: 'res.status(200).json({ ok: true, body: req.body });' },
        children: [],
      },
    ],
  };
}

function generatedFastApiRouteNodeFor(fixture) {
  return {
    type: 'route',
    props: { method: 'post', path: '/save' },
    children: fixture.entry.prePolicies.map((policyEntry) => policyEntry.node),
  };
}

async function importGeneratedExpressRoute(fixture) {
  const source = expressRoute.buildRouteArtifact(generatedRouteNodeFor(fixture), 0, new Map(), [], 'strict').artifact
    .content;
  const js = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: false,
    },
  }).outputText.replaceAll("'@kernlang/core/runtime'", "'../packages/core/dist/runtime.js'");
  const dir = await mkdtemp(join(process.cwd(), '.tmp-kern-express-route-'));
  const file = join(dir, 'route.mjs');
  await writeFile(file, js, 'utf8');
  try {
    return await import(`${file}?fixture=${encodeURIComponent(fixture.id)}&t=${Date.now()}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function makeGeneratedExpressFacts(facts) {
  const headers = Object.fromEntries(
    Object.entries(facts.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]),
  );
  return {
    headers,
    body: typeof facts.rawBody === 'string' || Buffer.isBuffer(facts.rawBody) ? Buffer.from(facts.rawBody) : undefined,
    locals: {
      kernAuthVerifiers: facts.authVerifiers ?? {},
      kernHmacKeys: Object.keys(facts.hmacVerifiers ?? {}).length > 0 ? { main: 'secret', default: 'secret' } : {},
    },
    ragReview: facts.ragReview,
  };
}

async function runGeneratedExpress(fixture) {
  const spy = { verifier: [], route1: [], route2: [], parser: [] };
  const facts = fixture.facts({ spy });
  if (fixture.expect.bodyA && !facts.headers?.['content-type']) {
    facts.headers = { ...(facts.headers ?? {}), 'content-type': 'application/json' };
  }
  const module = await importGeneratedExpressRoute(fixture);
  const registerName = Object.keys(module).find((name) => name.startsWith('register'));
  assert.ok(registerName, `generated-express:${fixture.id} register export`);

  const route = { method: '', path: '', handlers: [] };
  const app = {
    locals: makeGeneratedExpressFacts(facts).locals,
    post(path, ...handlers) {
      route.method = 'post';
      route.path = path;
      route.handlers = handlers;
    },
  };
  module[registerName](app);
  assert.equal(route.path, '/save', `generated-express:${fixture.id} path`);

  const requestFacts = makeGeneratedExpressFacts(facts);
  const req = new EventEmitter();
  req.headers = requestFacts.headers;
  req.app = app;
  req.params = {};
  req.query = {};
  req.body = undefined;
  if (requestFacts.ragReview !== undefined) req.kernRagReview = requestFacts.ragReview;

  const res = {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };

  for (let index = 0; index < route.handlers.length; index += 1) {
    const handler = route.handlers[index];
    if (index < route.handlers.length - 1) {
      await new Promise((resolve, reject) => {
        handler(req, res, (error) => (error ? reject(error) : resolve()));
        if (requestFacts.body) req.emit('data', requestFacts.body);
        req.emit('end');
      });
      continue;
    }
    await handler(req, res, (error) => {
      if (error) throw error;
    });
  }

  const handlerEntered = res.statusCode === 200;
  assert.equal(res.statusCode, fixture.expect.status, `generated-express:${fixture.id} status`);
  assert.equal(handlerEntered, fixture.expect.handler, `generated-express:${fixture.id} handler entry`);
  if (fixture.expect.verifierCalls) assert.deepEqual(spy.verifier, fixture.expect.verifierCalls, `generated-express:${fixture.id} verifier`);
  if (fixture.expect.route1Calls) assert.deepEqual(spy.route1, fixture.expect.route1Calls, `generated-express:${fixture.id} route1 verifier`);
  if (fixture.expect.route2Calls) assert.deepEqual(spy.route2, fixture.expect.route2Calls, `generated-express:${fixture.id} route2 verifier`);
  if (fixture.expect.bodyA) assert.equal(res.body?.body?.a, fixture.expect.bodyA, `generated-express:${fixture.id} parsed body`);
  return { status: res.statusCode, body: res.body, diagnostics: res.body?.diagnostics ?? [] };
}

function jsonableGeneratedFacts(facts) {
  return {
    headers: Object.fromEntries(Object.entries(facts.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value])),
    rawBody:
      typeof facts.rawBody === 'string'
        ? facts.rawBody
        : Buffer.isBuffer(facts.rawBody)
          ? facts.rawBody.toString('utf8')
          : '',
    ragReview: facts.ragReview ?? null,
  };
}

async function runGeneratedFastApi(fixture) {
  const spy = { verifier: [], route1: [], route2: [], parser: [] };
  const facts = fixture.facts({ spy });
  const coreResult = await runCore(fixture, facts);
  const source = fastapiRoute.buildRouteArtifact(generatedFastApiRouteNodeFor(fixture), 0, []).artifact.content;
  const payload = JSON.stringify({
    source,
    facts: jsonableGeneratedFacts(facts),
    decisions: coreResult.decisions,
  });
  const python = String.raw`
import asyncio, json, sys, types

payload = json.loads(sys.stdin.read())

class HTTPException(Exception):
    def __init__(self, status_code=500, detail=None):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail

class APIRouter:
    def __init__(self):
        self.routes = []
    def post(self, path):
        def deco(fn):
            self.routes.append(("post", path, fn))
            return fn
        return deco

fastapi = types.ModuleType("fastapi")
fastapi.APIRouter = APIRouter
fastapi.Request = object
fastapi.HTTPException = HTTPException
fastapi.Depends = lambda value=None: value
fastapi.__path__ = []
sys.modules["fastapi"] = fastapi
responses = types.ModuleType("fastapi.responses")
responses.JSONResponse = dict
responses.StreamingResponse = object
sys.modules["fastapi.responses"] = responses

namespace = {}
exec(payload["source"], namespace)
handler = namespace["post_save"]

class State:
    pass

class App:
    def __init__(self):
        self.state = State()

class Request:
    def __init__(self, facts):
        self.headers = facts["headers"]
        self.app = App()
        self._body = facts["rawBody"].encode("utf8")
        self.body_calls = 0
        async def execute(entry, slot, policy_facts):
            self.executed_entry = entry
            self.executed_slot = slot
            self.executed_facts = policy_facts
            return payload["decisions"]
        def policy_facts(request, raw_body):
            return {"headers": dict(request.headers), "rawBody": raw_body.decode("utf8"), "ragReview": facts["ragReview"]}
        self.app.state.execute_kern_policy_slot = execute
        self.app.state.kern_policy_facts = policy_facts
    async def body(self):
        self.body_calls += 1
        return self._body

async def main():
    req = Request(payload["facts"])
    try:
        value = await handler(req)
        print(json.dumps({"status": 200, "bodyCalls": req.body_calls, "slot": req.executed_slot, "returned": value}))
    except HTTPException as exc:
        print(json.dumps({"status": exc.status_code, "bodyCalls": req.body_calls, "slot": req.executed_slot, "detail": exc.detail}))

asyncio.run(main())
`;
  const output = execFileSync('python3', ['-c', python], { input: payload, encoding: 'utf8' });
  const result = JSON.parse(output);
  const handlerEntered = result.status === 200;
  assert.equal(result.status, fixture.expect.status, `generated-fastapi:${fixture.id} status`);
  assert.equal(handlerEntered, fixture.expect.handler, `generated-fastapi:${fixture.id} handler entry`);
  assert.equal(result.bodyCalls, 1, `generated-fastapi:${fixture.id} reads raw body`);
  assert.equal(result.slot, 'pre', `generated-fastapi:${fixture.id} policy slot`);
  return { status: result.status, body: result.returned ?? result.detail, diagnostics: [] };
}

for (const fixture of fixtures) {
  const results = [await runAdapter('runner-host', fixture), await runGeneratedExpress(fixture), await runGeneratedFastApi(fixture)];
  assert.deepEqual(results.map((r) => r.status), [fixture.expect.status, fixture.expect.status, fixture.expect.status], `${fixture.id} parity`);
}

async function expectManifestFailure(id, appSource, files) {
  await assert.rejects(
    () =>
      loadKernAppDescriptor(appSource, {
        appRoot: '/app',
        canonicalizePath: (path) => path,
        readSource: (path) => files[path],
      }),
    /undeclared HTTP header|must not call|unknown capability|executable kind/,
    id,
  );
}

const guardSource = (header) =>
  ['fn name=main returns=void', '  handler lang="kern"', `    capability namespace=app-http operation=header name=h input="{ name: \\"${header}\\" }"`].join('\n');
await expectManifestFailure(
  'A5',
  ['app name=Guarded', '  policy name=Authz kind=auth slot=pre source="./guard.kern" headers="x-safe"', '  route name=Save method=post path="/save" source="./handler.kern" policy=Authz'].join('\n'),
  { '/app/guard.kern': guardSource('Authorization'), '/app/handler.kern': ['fn name=main returns=void', '  handler lang="kern"', '    print value="\\"ok\\""'].join('\n') },
);
for (const header of ['authorization', 'AUTHORIZATION', 'AuthOrIzAtIoN']) {
  await expectManifestFailure(
    `A9-${header}`,
    ['app name=Guarded', '  policy name=Authz kind=auth slot=pre source="./guard.kern" headers="x-safe"', '  route name=Save method=post path="/save" source="./handler.kern" policy=Authz'].join('\n'),
    { '/app/guard.kern': guardSource(header), '/app/handler.kern': ['fn name=main returns=void', '  handler lang="kern"', '    print value="\\"ok\\""'].join('\n') },
  );
}
await expectManifestFailure(
  'H8/V1',
  ['app name=Guarded', '  policy name=Sig kind=hmacSignature slot=pre source="./guard.kern"', '  route name=Save method=post path="/save" source="./handler.kern" policy=Sig'].join('\n'),
  {
    '/app/guard.kern': ['fn name=main returns=void', '  handler lang="kern"', '    capability namespace=crypto operation=hmacVerify name=ok input="{ keyRef: \\"main\\" }"'].join('\n'),
    '/app/handler.kern': ['fn name=main returns=void', '  handler lang="kern"', '    print value="\\"ok\\""'].join('\n'),
  },
);

assert.deepEqual(core.KERN_APP_POLICY_EXECUTABLE_KINDS, ['passthrough', 'auth', 'hmacSignature', 'rag-review'], 'executable kinds');

const routeNode = {
  type: 'route',
  props: { method: 'post', path: '/save' },
  children: [{ type: 'policy', props: { name: 'Sig', kind: 'hmacSignature', keyRef: 'main', signatureHeader: 'x-signature' }, children: [] }],
};
const ex = expressRoute.buildRouteArtifact(routeNode, 0, new Map(), [], 'strict').artifact.content;
assert.match(ex, /executeKernAppEntryPolicySlot/, 'Express emits thin policy call');
assert.match(ex, /__kernCaptureRawBody/, 'Express preserves raw body per HMAC route');
assert.doesNotMatch(ex, /express\.json\(\{ verify:/, 'Express HMAC route does not parse JSON before policy');
assert.match(ex, /timingSafeEqual/, 'Express HMAC adapter uses timingSafeEqual');
assert.ok(
  ex.indexOf('app.post') < ex.indexOf('__kernCaptureRawBody,') &&
    ex.indexOf('__kernCaptureRawBody,') < ex.indexOf('const __kernPrePolicy') &&
    ex.indexOf('const __kernPrePolicy') < ex.indexOf('__kernParseJsonAfterPolicy(req)'),
  'Express HMAC route captures raw bytes, evaluates policy, then parses JSON',
);
const py = fastapiRoute.buildRouteArtifact(routeNode, 0, []).artifact.content;
assert.match(py, /await request\.body\(\)/, 'FastAPI preserves raw body');
assert.match(py, /hmac\.compare_digest/, 'FastAPI structurally names compare_digest');

// P2 — a guard kind unknown to a leg must fail that leg's BUILD, never emit an
// unguarded route (kills an emitter kind-dispatch that defaults to passthrough).
const p2RouteNode = {
  type: 'route',
  props: { method: 'post', path: '/save' },
  children: [{ type: 'policy', props: { name: 'Future', kind: 'future-guard', slot: 'pre' }, children: [] }],
};
assert.throws(
  () => expressRoute.buildRouteArtifact(p2RouteNode, 0, new Map(), [], 'strict'),
  /unsupported pre-slot policy kind 'future-guard'/,
  'P2: Express build fails closed on an unknown guard kind',
);
assert.throws(
  () => fastapiRoute.buildRouteArtifact(p2RouteNode, 0, []),
  /unsupported pre-slot policy kind 'future-guard'/,
  'P2: FastAPI build fails closed on an unknown guard kind',
);

console.log(`app-behavior-conformance: ${fixtures.length} fixtures passed on 3 legs`);
