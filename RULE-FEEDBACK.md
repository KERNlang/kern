# Kern Sight — Rule Feedback Collection

Findings observed in real codebases that need rule-tuning work in `@kernlang/review`.
Triaged later into rule edits, new detectors, or suppression patterns.

Source extension build: `kern-sight` @ `chore/ux-cleanup-v0` (v0.7.7, review 3.4.6).

## Resolved

Landed in `@kernlang/review@3.5.0`. Point the extension at this version to pick up
the carve-outs. Each fix ships with a paired "still-fires-on-bad-code" regression
test so the genuine-bad detectors remain intact. An Evil-Twin self-challenge round
refined the carve-outs against over-suppression risks — notably narrowing
`unrecovered-effect` throw-as-handler logic to a transport-filename gate, and
dropping the broad URL-substring auth-endpoint set in favour of narrow RFC
suffixes + the `{context:"auth"}` author marker.

| # | Rule | Commit | Carve-out |
|---|---|---|---|
| 1 | `unhandled-async` (RSC) | `a6bb9ae1` | New `isReactServerComponent` helper — skip async fns returning JSX in `(src/)app/**/*.tsx` without `'use client'` |
| 2 | `taint-redirect` (constant-fold) | `92a9f03f` | `new URL(literal-starting-with-slash, tainted)` resolves to fixed same-origin path — drop the finding |
| 3 | `unrecovered-effect` on `headers.get()` | `9c7f2353` | Effect-extractor denylist for objName ending in `.headers` / `.cookies` / `.searchParams` / `.params` / `.body` / `.query` |
| 4 | `unhandled-async` (route handler) | `a6bb9ae1` | New `isRouteHandler` helper — message reworded for App Router handlers (no `error.tsx` fallback so still fires, but points at observability) |
| 5 | `hydration-mismatch` on utility modules | `624e98ab` | Per-rule JSX-in-file gate; skip on `__IS_SERVER` / `typeof window` ternary; skip inside `Logger` / `metrics` / `telemetry` / `tracer` / `span` calls |
| 6 | `unguarded-effect` in transport wrapper | `e01da092` | New guard patterns: `build*Headers` / `with*Auth` / `signRequest` / `attachAuth` / `getAuthHeaders`, plus token-arg detection (`accessToken` / `authToken` / `apiKey` / `credentials` / `bearer`) |
| 7 | `unrecovered-effect` on transport primitive | `3b7724be` | Skip when file is `request.ts` / `fetch.ts` / `http.ts` / `api-client.ts` AND container has a throw — narrowly scoped per Evil Twin |
| 8 | `unguarded-effect` on auth endpoints | `e01da092` | Narrow RFC suffixes (`/oauth/token`, `/auth/login`, `/auth/signin`, `/.well-known/openid-configuration`, `/.well-known/jwks.json`); `{context:"auth"}` author marker — broad substring set dropped per Evil Twin |

---

## Engine-side prerequisite: per-finding confidence on every emission

**Status:** must ship before (or with) the rule precision-tuning pass. The extension side (kern-sight) is implementing a user-tunable confidence threshold and per-card confidence display — but it needs the engine to actually emit the number.

**Required change in `@kernlang/review`:**

Every emitted finding must carry a `confidence: number` field, integer in `0–100`.

- 0–100 (not 0–1) — matches the user-facing threshold UI on the extension side.
- Each rule declares a baseline confidence per match shape. Rules MAY adjust per match — e.g. `taint-redirect` returns higher when source and sink are both unambiguous, lower when the path is partially constant-folded.
- Suggested bands (informational only, downstream UI decides what to do with them): `high ≥ 90`, `medium 70–89`, `low < 70`.
- **Deterministic** per (rule, match context). No randomness. Same input must always produce the same number.
- Document the score per rule in `packages/review/RULES.md` or in per-rule frontmatter.

**Acceptance:**

- The field is **required** in the `ReviewFinding` TypeScript type and JSON schema. A rule that omits `confidence` must fail the test suite.
- The 8 false-positive cases below should each score **≤ 70** at the specific (rule, context) combo described — so they fall below the extension's default threshold of 90 even when the per-rule carve-outs in this file can't fully suppress them. The carve-outs and the score are complementary safety nets, not alternatives.
- Genuine bugs the rule was designed to catch must still score **≥ 90**.

The aggregate `confidenceSummary` that the engine emits today can stay as a derived convenience, but the source of truth becomes the per-finding `confidence`. The extension will consolidate to derive the aggregate locally.

---

## 1. `unhandled-async` fires on Next.js React Server Components

**Date:** 2026-05-11
**Severity surfaced:** INFO
**Repo where observed:** interdiscount-next
**File:** `src/features/footer/components/payment-options/payment-options.tsx:11`

**Code that triggered it:**

```tsx
export async function PaymentOptions({ locale }: PaymentOptionsProps) {
  const { t } = getTranslations(locale);
  const isNewPaymentIconsEnabled = await fetchFeatureToggle(
    "frontend_footer_payment_icons_enabled"
  );
  const paymentMethods = getFooterPaymentMethods(isNewPaymentIconsEnabled);
  return ( <> ... </> );
}
```

**Finding message:** "Async function 'PaymentOptions' has await but no try/catch — unhandled rejection risk"
**Suggested fix:** "Wrap await calls in try/catch or add .catch() handler"

**Why this is a false positive here:**

This is a Next.js **React Server Component**. RSCs are designed to let awaits throw — the framework routes the rejection to the nearest `error.tsx` boundary. Wrapping every await in try/catch inside an RSC is an antipattern: it swallows errors the framework is meant to handle and forces fallback UI inline.

**Proposed rule change (rough sketch):**

Detect RSCs and skip `unhandled-async` (or downgrade to NOTE):

- File path under `app/**` or `src/app/**` (Next.js app router), or
- File ends in `.tsx`/`.jsx`, exports an async function that returns JSX, and
- File does **not** contain a `"use client"` directive at the top, and
- Function is the default export or a PascalCase named export

Optional second signal: presence of `error.tsx` / `global-error.tsx` in the same route segment.

**Possible alternative:** keep firing but rewrite the suggested fix for RSC context to "let it throw — handle via error.tsx" instead of "wrap in try/catch".

---

<!-- Append new entries below. Template:

## N. `<rule-id>` <one-line summary>

**Date:**
**Severity surfaced:**
**Repo where observed:**
**File:**

**Code that triggered it:**

\`\`\`
...
\`\`\`

**Finding message:**
**Suggested fix:**

**Why this is a false positive / wrong / mistuned:**

**Proposed rule change:**

-->

---

## 2. `taint-redirect` fires when `request.url` is used only as base for a hardcoded path

**Date:** 2026-05-11
**Severity surfaced:** WARN (PRE-EXISTING, NEXT)
**Repo where observed:** interdiscount-next
**File:** `src/app/api/mock/[...path]/route.ts:1069`

**Code that triggered it:**

```ts
const handleImageRedirect = (key: string, request: NextRequest) => {
  if (key.endsWith("__invalid__.jpg"))
    return NextResponse.json({}, { status: 404 });
  return NextResponse.redirect(
    new URL("/next-assets/images/placeholder.jpg", request.url)
  );
};
```

**Finding message:** "Taint flow: request (HTTP input) → redirect() — potential open redirect. Variable 'request' reaches dangerous sink without sanitization."
**Suggested fix:** "Validate redirect URL against an allowlist of safe destinations"

**Why this is a false positive here:**

`new URL(path, base)` with a **path that starts with `/`** discards everything except the origin from `base`. The redirect target is therefore always `<own-origin>/next-assets/images/placeholder.jpg` — a hardcoded same-origin path. The attacker cannot influence the destination path; they can only influence the origin via the incoming `Host` header (which is a separate, much weaker class of issue, and Next.js controls trusted hosts).

**Proposed rule change:**

When `request.url` (or any tainted value) reaches `NextResponse.redirect(new URL(p, base))`, inspect the first arg `p`:

- If `p` is a string literal **starting with `/`** → the path component is constant; downgrade or drop the finding (same-origin redirect to fixed path).
- If `p` is a string literal **without a scheme** but not starting with `/` → still risky (relative path off `request.url`), keep WARN.
- If `p` itself is tainted → real open-redirect risk, keep/raise.

Secondary: detect `new URL("/literal", request.url)` as a known-safe sink pattern across the codebase, not just for redirect.

---

## 3. `unrecovered-effect` fires on synchronous header check (no network op present)

**Date:** 2026-05-11
**Severity surfaced:** WARN (PRE-EXISTING, NEXT)
**Repo where observed:** interdiscount-next
**File:** `src/app/api/mock/[...path]/route.ts:1107`

**Code that triggered it:**

```ts
if (request.headers.get("Authorization")?.includes("invalid-token")) {
  return NextResponse.json(
    {
      errors: [{ type: "InvalidTokenError", message: "Invalid access token" }],
    },
    { status: 401 }
  );
}
```

**Finding message:** "network effect without error recovery — wrap in try/catch or add .catch()"

**Why this is a false positive here:**

There is no network effect on this line. `request.headers.get()` is a **synchronous** property access on the already-received `NextRequest` object — it returns `string | null` directly, no promise, no fetch, no I/O. The rule is misclassifying header access as a network operation, probably because of the `request` identifier or the `.get(` call shape.

**Proposed rule change:**

The "network effect" detector must require an actual async sink in the call chain — `fetch`, `axios`, `http.request`, `XMLHttpRequest`, `WebSocket`, a known SDK client method, or an awaited expression. Pure synchronous `.get()`/`.has()`/`.entries()` on `Headers`, `URLSearchParams`, `Map`, `FormData`, `cookies()`, etc. must not qualify.

Quick heuristic: if the call's return type is **not** a `Promise` and the call is not `await`-ed, it is not a network effect.

---

## 4. `unhandled-async` fires on Next.js Route Handlers (App Router)

**Date:** 2026-05-11
**Severity surfaced:** INFO (PRE-EXISTING, NEXT)
**Repo where observed:** interdiscount-next
**File:** `src/app/api/mock/[...path]/route.ts:1162` (POST; also PUT/DELETE in same file)

**Code that triggered it:**

```ts
export async function POST(
  request: NextRequest,
  props: { params: Promise<{ path: Array<string> }> }
) {
  const params = await props.params;
  const { path } = params;
  const key = path.join("/");
  return handleFixture(request, key);
}
```

**Finding message:** "Async function 'POST' has await but no try/catch — unhandled rejection risk"

**Why this is a false positive here:**

This is a Next.js **App Router Route Handler**. Next.js wraps the handler and converts uncaught rejections into a `500` response; user code is not expected to wrap every await. Wrapping in try/catch in a route handler is also generally an antipattern — it hides errors from Next.js error logging and observability. Related to case #1 (RSC) but for the route-handler shape.

**Proposed rule change:**

Extend the RSC carve-out from case #1 to cover route handlers:

- File path ending in `app/**/route.ts` or `app/**/route.tsx` (also `src/app/**`), and
- Export is one of the HTTP method names: `GET`, `HEAD`, `POST`, `PUT`, `DELETE`, `PATCH`, `OPTIONS`, and
- Export is an `async function`.

Skip `unhandled-async` for these signatures (or downgrade to NOTE with a route-handler-specific message).

---

## 5. `hydration-mismatch` fires on `Date.now()` in a non-render utility module

**Date:** 2026-05-11
**Severity surfaced:** WARN (PRE-EXISTING)
**Repo where observed:** interdiscount-next
**File:** `request.ts:103`

**Code that triggered it:**

```ts
const startTime = __IS_SERVER ? Date.now() : 0;
const finalUrl = buildRequestUrl(url, searchParams);
const headers = await buildRequestHeaders(init, finalUrl, accessToken);

if (__IS_CLIENT) {
  patchFetchOccAuth();
}

const response = await fetch(finalUrl, {
  ...(hasTimeout
    ? {
        signal: AbortSignal.timeout(
          __IS_SERVER ? DEFAULT_TIMEOUT : DEFAULT_CLIENT_TIMEOUT
        ),
      }
    : {}),
});
```

**Finding message:** "Date.now() in render produces different values on server vs client — hydration mismatch"
**Suggested fix:** "Move to useEffect or use a stable seed. For IDs, use React.useId()"

**Why this is a false positive here:**

This is a `request.ts` utility module — a `fetch` wrapper. It is not a React component, has no JSX, returns no element. The `Date.now()` is explicitly gated behind `__IS_SERVER` and used for **timing telemetry**, never rendered to the DOM. There is no hydration concern: nothing produced here is part of the React tree.

The rule appears to fire on any `Date.now()` it sees, without checking whether the surrounding function/module is actually a renderer.

**Proposed rule change:**

`hydration-mismatch` must require that the unstable value (`Date.now()`, `Math.random()`, `new Date()`, `crypto.randomUUID()`) actually flows into render output. Tighten to one or more of:

- File ends in `.tsx`/`.jsx` and exports a React component (function returning JSX, or `forwardRef`, or class extends `Component`), **and**
- The unstable expression is reachable from the component's return value (data-flow check), **not** inside a `useEffect` / `useLayoutEffect` / event handler / async callback.

Additionally, treat `__IS_SERVER ? unstable : stable` (and the mirror `__IS_CLIENT` form) as **explicit author intent** — these names are conventional Next/SSR guards and signal that the asymmetry is deliberate. Skip the finding when the unstable call sits on a branch gated by one of: `typeof window === 'undefined'`, `typeof window !== 'undefined'`, `__IS_SERVER`, `__IS_CLIENT`, `isServer`, `isClient`.

**Second occurrence (same file, same rule, same root cause) — `request.ts:169`:**

```ts
if (status !== 404 && status !== 401) {
  Logger.error(LOG_TYPE.API_LOG, {
    url,
    status,
    cacheStatus: response.headers.get("cache-status"),
    cacheAge: Number(response.headers.get("age") ?? 0),
    cacheId: response.headers.get("cache-id"),
    fetchTime: Math.round(Date.now() - startTime),
    method,
  });
}
```

Same false-positive pattern as the L103 case: `Date.now()` here flows into a **server-side log payload** (`Logger.error`), not into render output. There is no DOM, no React tree — hydration is not in scope. Strengthens the proposed fix above: the rule must verify data-flow into JSX, not just spot a `Date.now()` call. Bonus signal: identifiers like `Logger`, `logger`, `log`, `metrics`, `telemetry`, `tracer`, `span` in the surrounding call are strong hints that the value is being recorded, not rendered.

---

## 6. `unguarded-effect` fires inside a fetch wrapper that already builds auth headers

**Date:** 2026-05-11
**Severity surfaced:** WARN (PRE-EXISTING)
**Repo where observed:** interdiscount-next
**File:** `request.ts:111`

**Code that triggered it:**

```ts
export async function request<T>(url: string, init: EnhancedRequestInit = {}) {
  const { hasTimeout = true, hasJsonResponse = true, method = "GET" } = init;
  const startTime = __IS_SERVER ? Date.now() : 0;
  const finalUrl = buildRequestUrl(url, searchParams);
  const headers = await buildRequestHeaders(init, finalUrl, accessToken);

  if (__IS_CLIENT) patchFetchOccAuth();

  const response = await fetch(finalUrl, {
    ...(hasTimeout ? { signal: AbortSignal.timeout(...) } : {}),
    ...init,
    headers,
  });
  // ...
}
```

**Finding message:** "Network/DB effect without auth/validation guard"

**Why this is a false positive here:**

The function **is** the auth layer. Two lines above the `fetch` call, `buildRequestHeaders(init, finalUrl, accessToken)` constructs Authorization-bearing headers (note the `accessToken` argument), and the result is spread into the request `headers`. The rule isn't recognizing `buildRequestHeaders` (or any project-specific header builder) as a guard.

Beyond that, this is a generic transport primitive — by design, callers are responsible for "should this user be allowed to call this URL" (route/middleware/server-component concern). Auth-policy checks don't belong in the low-level wrapper.

**Proposed rule change:**

Treat a call to any function whose name matches `/build.*Headers?|with.*Auth|signRequest|attachAuth|getAuthHeaders?/i` (configurable list) **before** the network sink as a satisfied guard. Even simpler heuristic: if the request's `headers` value flows from a function whose argument list includes a token/credential-like identifier (`accessToken`, `token`, `apiKey`, `credentials`, `bearer`), treat as guarded.

Secondary: when the function being analyzed is itself a generic transport (signature is `<T>(url: string, init?: ...)` and it returns the awaited response, no business-domain types), downgrade `unguarded-effect` — call sites are the right place to check, not the primitive.

---

## 7. `unrecovered-effect` fires on a transport primitive that intentionally lets errors propagate

**Date:** 2026-05-11
**Severity surfaced:** WARN (PRE-EXISTING)
**Repo where observed:** interdiscount-next
**File:** `request.ts:111`

**Code that triggered it:**

```ts
export async function request<T>(url: string, init: EnhancedRequestInit = {}) {
  // ...
  const response = await fetch(finalUrl, { /* ... */ });
  if (!response.ok) {
    // parse + throw a typed error
  }
  // ...
}
```

**Finding message:** "network effect without error recovery — wrap in try/catch or add .catch()"

**Why this is a false positive here:**

This is a generic fetch wrapper exported as `request<T>`. Its **contract is to throw** on transport failure so callers (or the outer route handler / RSC / RTK Query / TanStack Query layer) can decide how to recover. Wrapping the `await fetch` in a local try/catch would force this layer to either swallow the error (worse) or invent its own error envelope (couples every caller to that envelope). The function already handles the *semantic* error case (`!response.ok` → parse + throw) immediately after the await; it does not need a transport-level try/catch.

**Proposed rule change:**

Skip `unrecovered-effect` when **all** of these hold:

- The function is `export async function …<T>(…)` (generic transport shape), and
- The function name matches `/^(request|fetcher|http(Get|Post|Put|Delete|Patch)?|api(Call|Request))$/i` or the file is named `request.ts` / `fetch.ts` / `http.ts` / `api-client.ts`, and
- The awaited result is returned (directly or after a status check) — i.e., the function is a pass-through.

Alternative phrasing for the suggested fix when not skipped: "If this is a transport primitive, prefer to let callers handle the rejection. Otherwise wrap in try/catch." — so the message itself nudges authors to the right call.

---

## 8. `unguarded-effect` fires on the login call itself (the auth endpoint can't require auth before being reached)

**Date:** 2026-05-11
**Severity surfaced:** WARN (PRE-EXISTING)
**Repo where observed:** interdiscount-next
**File:** auth flow (login / token exchange), L55

**Code that triggered it:**

```ts
if (deviceSessionId) body = ...;

try {
  const { data } = await request<OccLoginResult>(
    getOccPath("/token", { context: "auth" }),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        ...init?.headers,
      },
      body,
    }
  );
```

**Finding message:** "Network/DB effect without auth/validation guard"

**Why this is a false positive here:**

This call IS the authentication step — it's a POST to `/token` with `context: "auth"` to exchange credentials for a session. Requiring an "auth guard" before calling the login endpoint is a contradiction: the user is by definition unauthenticated until this call completes. Every login/token-exchange/refresh path in every codebase will trip this rule.

This differs from #6 (which was about the transport primitive). #6 says "the wrapper shouldn't be the place that enforces auth"; #8 says "even the *caller* of the wrapper can't enforce auth here, because this *is* the auth call."

**Proposed rule change:**

Skip `unguarded-effect` when the target URL/path matches auth-endpoint patterns. Conservative allowlist of substrings (case-insensitive) on the resolved URL or path argument:

- `/oauth`, `/token`, `/login`, `/signin`, `/sign-in`, `/logout`, `/signout`, `/sign-out`
- `/auth/`, `/authorize`, `/authn`, `/sso`
- `/register`, `/signup`, `/sign-up`
- `/refresh`, `/refresh-token`, `/session`, `/csrf`, `/.well-known/`

Additional signal: a call-option of the form `{ context: "auth" }` (or any object key named `context` set to a string starting with `"auth"`) is an explicit author hint that this is an auth-domain call. Use as a secondary skip trigger.

Cross-cutting: rules in the "unguarded-X" family generally need an **endpoint-classification pass**. The same auth/login carve-out applies to `unrecovered-effect`, `taint-*`, and any rule that demands a pre-call gate — login flows are inherently unguarded by their nature.


