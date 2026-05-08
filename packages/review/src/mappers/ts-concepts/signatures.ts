export const EXTRACTOR_VERSION = '1.0.0';

// ── Network effect signatures ────────────────────────────────────────────

export const NETWORK_CALLS = new Set(['fetch', 'axios', 'got', 'request', 'superagent', 'ky']);

export const NETWORK_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'request']);

// ── Wrapped HTTP-client detection ────────────────────────────────────────
// ~75% of production React/Next/Expo apps route through a wrapper (custom
// ApiClient class, axios.create instance, tRPC-generated client). The fixed
// NETWORK_CALLS set misses those, so the cross-stack wedge rules
// (contract-drift, untyped-api-response, tainted-across-wire) silently
// find nothing on real repos. collectClientIdentifiers() scans the file
// for wrapper patterns and returns the local identifiers that behave like
// HTTP clients; extractEffects() then treats `<name>.get/post/…` calls on
// those identifiers as network effects.

export const CLIENT_HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete']);

// Names considered client-shaped for imported identifiers. Kept narrow on
// purpose — false positives here cascade into the wedge rules and poison
// the pitch. Matches: api, http, client, apiClient, httpClient, fetcher,
// requester, ApiClient, HttpClient, MyApiClient, etc.
export const CLIENT_NAME_PATTERN = /^(api|http|client|apiClient|httpClient|fetcher|requester)$|Client$/;

// Wrapper factories — if a variable is initialized with one of these calls,
// the variable is a client instance (axios.create, ky.create, got.extend).
export const CLIENT_FACTORY_CALLS = new Set(['axios.create', 'ky.create', 'ky.extend', 'got.extend']);

export const DB_CALLS = new Set([
  'query',
  'execute',
  'findMany',
  'findFirst',
  'findUnique',
  'create',
  'update',
  'delete',
  'upsert',
  'aggregate',
  'insertOne',
  'insertMany',
  'updateOne',
  'updateMany',
  'deleteOne',
  'deleteMany',
  'find',
  'findOne',
  'countDocuments',
]);

export const DB_COLLECTION_READ_CALLS = new Set([
  'findMany',
  'find',
  'select',
  'query',
  'aggregate',
  'toArray',
  'all',
  'fetchAll',
]);

export const DB_WRITE_CALLS = new Set([
  'create',
  'createMany',
  'insert',
  'insertOne',
  'insertMany',
  'update',
  'updateMany',
  'updateOne',
  'delete',
  'deleteMany',
  'deleteOne',
  'remove',
  'save',
  'upsert',
]);

export const FS_CALLS = new Set([
  'readFile',
  'readFileSync',
  'writeFile',
  'writeFileSync',
  'readdir',
  'readdirSync',
  'mkdir',
  'mkdirSync',
  'unlink',
  'unlinkSync',
  'rename',
  'renameSync',
  'createReadStream',
  'createWriteStream',
]);

export const ROUTE_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'all']);

export const API_ERROR_STATUS_CODES = new Set([401, 403, 404, 422, 500]);
export const API_SUCCESS_STATUS_CODES = new Set([200, 201, 202, 204, 206]);
export const TERMINAL_RESPONSE_METHODS = new Set(['json', 'send', 'end', 'render', 'jsonp']);

export const PAGINATION_RE = /\b(limit|take|offset|skip|cursor|page|pageSize|perPage)\b|\.limit\s*\(|\.take\s*\(/i;
export const IDEMPOTENCY_RE =
  /\b(idempotency|Idempotency-Key|transaction|\$transaction|unique|upsert|findUnique|findOne|on\s+conflict|getOrCreate|createOrGet)\b/i;

export const NEXTJS_HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']);

export const REACT_WRAPPERS = new Set(['memo', 'forwardRef']);
export const REACT_QUALIFIED_WRAPPERS = new Set(['React.memo', 'React.forwardRef']);

export const AUTH_KEYWORDS = /auth|session|token|user|role|permission|admin|login|credential/i;
export const VALIDATION_CALLS = new Set(['parse', 'safeParse', 'validate', 'validateSync', 'check']);
// Helper-call naming heuristic: requireAdminOrigin, assertSession, checkPermissions,
// validateBody, ensureAuthenticated, etc. The leading verb determines the subtype.
export const GUARD_HELPER_RE = /^(require|assert|check|validate|ensure)([A-Z]\w*)$/;
// At the call site, the first argument's surface text. Matches the request /
// session / auth-context shapes that real guard helpers consume. Used to
// disambiguate `requireAdminOrigin()`, `requireAuth(req)`, `assertSession(headers)`
// (real guards) from `checkCache(key)`, `ensureConnected(client)`, `assertReady(state)`
// (utilities that happen to share the verb prefix). See review feedback Codex P2.
export const GUARD_ARG_RE =
  /^(req|request|session|ctx|context|auth|user|origin|headers?|tok(en)?|cred(ential)?s?|cookies?)\b/i;

export const EXPRESS_ROUTE_METHODS = new Set(['get', 'post', 'put', 'delete', 'patch', 'use', 'all']);

export const NODE_STDLIB = new Set([
  'fs',
  'path',
  'os',
  'http',
  'https',
  'url',
  'util',
  'crypto',
  'events',
  'stream',
  'buffer',
  'child_process',
  'cluster',
  'net',
  'dns',
  'tls',
  'zlib',
  'readline',
  'assert',
  'querystring',
]);

// Incidental HOF callbacks — these are NOT logical containers
export const SKIP_CALLBACKS = new Set([
  'forEach',
  'map',
  'filter',
  'reduce',
  'some',
  'every',
  'find',
  'findIndex',
  'flatMap',
  'sort',
  'then',
  'catch',
  'finally',
]);

// Phase 1 of surface-fingerprinting: pull the host out of an absolute URL so
// downstream cross-stack rules can later filter third-party calls (e.g. a
// frontend `fetch` to `stripe.com/api/charges` shouldn't match against the
// partner backend's `/api/charges` route). Phase 2 will use this — phase 1
// only captures it.
export const HOST_LIKE_RE = /^[a-z0-9][a-z0-9.-]*(:[0-9]+)?$/i;

export const STATUS_PROP_RE = /(?:^|\.)status$/;
export const STATUS_LIKELY_RECEIVER_RE = /\b(res|response|reply|err|error|e|ex|result|r)\b/i;

/**
 * Network libraries split into two call-site conventions:
 *   fetch-style — `fetch(url, options)` where `options.body` carries the
 *     payload. `ky` and generic `request()` follow this shape.
 *   axios-style — `axios.post(url, data, config)` where the second arg IS
 *     the payload directly. `got.post`, `superagent.post`, and most axios
 *     method calls (post/put/patch) match this.
 */
export const AXIOS_STYLE_METHODS = new Set(['post', 'put', 'patch']);

// Object-level Zod modifiers that don't change which fields are validated
// for the purposes of /type comparison. `.partial()` / `.required()` only
// flip optionality — same fields, same types. `.strict()` / `.passthrough()`
// / `.strip()` change extra-field handling but preserve the recorded set.
// Modifiers that DO change the field set (`omit`, `pick`, `extend`, `merge`)
// are deliberately absent — encountering them in the chain bails extraction
// to avoid recording stale or missing field tags.
export const SCHEMA_PRESERVING_OBJECT_MODIFIERS = new Set([
  'partial',
  'required',
  'passthrough',
  'strict',
  'strip',
  'refine',
  'superRefine',
  'transform',
  'describe',
  'brand',
  'readonly',
  'optional',
  'nullable',
  'nullish',
  'default',
  'catch',
]);

// Zod call-chain modifiers — methods that wrap a base type without changing
// its coarse on-the-wire shape. We peel these off until we hit the base
// constructor (`z.string`, `z.number`, …).
export const ZOD_MODIFIERS = new Set([
  'optional',
  'nullable',
  'nullish',
  'min',
  'max',
  'length',
  'default',
  'nonempty',
  'refine',
  'transform',
  'describe',
  'brand',
  'pipe',
  'catch',
  'readonly',
  'positive',
  'negative',
  'nonnegative',
  'nonpositive',
  'multipleOf',
  'finite',
  'safe',
  'trim',
  'lowercase',
  'uppercase',
  'startsWith',
  'endsWith',
  'regex',
  'email',
  'url',
  'uuid',
  'cuid',
  'cuid2',
  'datetime',
  'ip',
  'emoji',
  // `.or(...)` / `.and(...)` are intentionally absent: they widen the
  // accepted shape (`z.string().or(z.number())` accepts both), so peeling
  // them like a passthrough modifier creates a false-positive on the
  // OTHER branch. They fall through to the default → 'unknown' below.
  // Codex flagged this as a real precision miss.
]);
