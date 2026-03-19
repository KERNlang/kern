# KERN v3 Language Roadmap — Gap-Driven from audiofacets

**Date:** 2026-03-19
**Status:** Planned — reviewed by Gemini + Codex
**Method:** `kern review` gap analysis on audiofacets (903 files, real production codebase)

## The Principle

KERN's language roadmap is driven by real gaps found by `kern review`. Every `extra-code` finding = a pattern KERN can't express yet. audiofacets is the test bench.

```
kern review (finds gaps) → kern evolve (proposes features) → KERN v3 (adds features) → kern review (validates coverage)
```

## Current Coverage

| Codebase | Files | KERN Coverage | Gap |
|----------|-------|--------------|-----|
| audiofacets backend (Express) | 40 | 75% | 25% |
| audiofacets frontend (Electron + web-viewer) | 863 | 82% | 18% |

## Gap Analysis Summary

### Backend (25% gap = 218 uncovered blocks)
- Route handlers: 49 blocks
- Control flow in handlers: 24 blocks
- HTTP responses: 20 blocks
- Export statements: 9 blocks
- Other imperative: 108 blocks

### Frontend (18% gap = 1754 uncovered blocks)
- Other imperative: 1129 blocks
- Control flow: 244 blocks
- Export statements: 118 blocks
- JSX elements: 84 blocks
- Return logic: 74 blocks
- Event listeners: 30 blocks
- Array transforms: 31 blocks

## Implementation Plan (7 phases)

Priority order based on consensus from Gemini + Codex:
- Module exports first (cheapest broad win, enables multi-file)
- Route before component (higher semantic value)
- Effect before component (solidify effect semantics first)
- DOM events fold into component (not standalone)
- Middleware + schema added (both buddies flagged as missing)

---

### Phase 3.1: `module` exports
**Effort:** 1 day | **Impact:** +3-5% both codebases

**What:** Barrel files, re-exports, selective exports from modules.

```kern
module reviewQueries
  export getReview, createReview, deleteReview
  export type ReviewSession, ReviewVersion, ReviewComment
  export default reviewRouter
```

**Compiles to:**
```typescript
export { getReview, createReview, deleteReview } from './reviewQueries.js';
export type { ReviewSession, ReviewVersion, ReviewComment } from './types.js';
export default reviewRouter;
```

**Files to change:**
- `packages/core/src/spec.ts` — add `module` to NODE_TYPES if not present
- `packages/core/src/codegen-core.ts` — add `generateModule` export handling
- `packages/core/src/parser.ts` — parse `export` children in module node
- Tests: module export roundtrip

**Closes:** 127 export-statement blocks across both codebases

---

### Phase 3.2: `route` node (framework-agnostic)
**Effort:** 2-3 days | **Impact:** Backend 75% → ~88%

**Design principle (Gemini + Codex consensus):** Model the INTENT — verb, path, params, auth, validation, response shape. Express/FastAPI/Go are backends, not the syntax.

```kern
route GET /api/users
  params page:number = 1, limit:number = 20
  auth required
  validate UserQuerySchema
  middleware rateLimit, cors
  handler {
    const users = await db.query('SELECT * FROM users LIMIT $1', [limit]);
    respond 200 json=users
  }
  error 401 "Unauthorized"
  error 500 "Server error"
```

**Compiles to Express:**
```typescript
router.get('/api/users',
  authRequired,
  rateLimit,
  cors,
  validate(UserQuerySchema),
  async (req: Request, res: Response) => {
    try {
      const { page = 1, limit = 20 } = req.query;
      const users = await db.query('SELECT * FROM users LIMIT $1', [limit]);
      res.json(users);
    } catch (err) {
      res.status(500).json({ error: 'Server error' });
    }
  }
);
```

**Compiles to FastAPI:**
```python
@router.get("/api/users")
async def get_users(page: int = 1, limit: int = 20, user: User = Depends(auth_required)):
    users = await db.query("SELECT * FROM users LIMIT $1", [limit])
    return users
```

**Files to change:**
- `packages/core/src/spec.ts` — add `route` node type
- `packages/core/src/parser.ts` — parse route syntax (verb, path, children)
- `packages/core/src/codegen-core.ts` — generate route IR
- `packages/express/src/transpiler-express.ts` — Express route output
- `packages/fastapi/src/transpiler-fastapi.ts` — FastAPI route output
- Tests: route → Express, route → FastAPI roundtrip

**Closes:** 69 blocks (route-handler + http-response)

---

### Phase 3.3: `effect` syntax (reviewable side effects)
**Effort:** 2 days | **Impact:** Concept model alignment, strategic

**Design principle (Codex):** Only valuable if it carries reviewable semantics — trigger, external system, guard, recovery, cleanup, idempotency. Not just sugar for "network call."

```kern
effect fetchUsers
  trigger network GET /api/users
  guard auth required
  recover retry=3 fallback=[]
  cleanup abortController
  idempotent true
```

**What this enables:**
- `kern review` concept rules validate effects at language level (not just heuristics)
- `effect` nodes compile to fetch/axios/requests with built-in error handling
- Recovery strategy is explicit, not hidden in handler bodies
- Aligns with concept model: `effect(network)` + `guard(auth)` + `error_handle(retried)`

**Files to change:**
- `packages/core/src/spec.ts` — add `effect` children (trigger, guard, recover, cleanup)
- `packages/core/src/codegen-core.ts` — generate effect code
- `packages/review/src/mappers/ts-concepts.ts` — detect `effect` KERN nodes as concepts
- Tests: effect → TS, effect → concept map roundtrip

**Closes:** 11+ blocks directly, but strategic value is much higher

---

### Phase 3.4: `component` node (React v1, abstract lifecycle)
**Effort:** 3-5 days | **Impact:** Frontend 82% → ~87%

**Design principles:**
- Gemini: "Don't bake in useEffect — use effect nodes. Keep UI description high-level."
- Codex: "React only for v1. Vue/Svelte have different reactivity models."
- Both: "Don't make the handler/render block a string dump."

```kern
component ReviewCard
  props
    slug: string
    title: string
    onDelete?: () => void

  state
    loading: boolean = false
    error: string | null = null
    data: ReviewData | null = null

  effect [slug]
    setLoading(true)
    const result = await fetchReview(slug)
    setData(result)
    setLoading(false)

  ref audioRef: HTMLAudioElement | null = null

  memo filteredComments [data?.comments]
    return data?.comments.filter(c => !c.deleted) ?? []

  on cleanup
    audioRef.current?.pause()

  render
    if (loading) return <Spinner />
    if (error) return <ErrorBanner message={error} />
    <Card>
      <h2>{title}</h2>
      <CommentList comments={filteredComments} />
      <button onClick={onDelete}>Delete</button>
    </Card>
```

**Compiles to React:**
```typescript
export function ReviewCard({ slug, title, onDelete }: ReviewCardProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ReviewData | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    setLoading(true);
    fetchReview(slug).then(setData).finally(() => setLoading(false));
    return () => { audioRef.current?.pause(); };
  }, [slug]);

  const filteredComments = useMemo(
    () => data?.comments.filter(c => !c.deleted) ?? [],
    [data?.comments]
  );

  if (loading) return <Spinner />;
  if (error) return <ErrorBanner message={error} />;
  return (
    <Card>
      <h2>{title}</h2>
      <CommentList comments={filteredComments} />
      <button onClick={onDelete}>Delete</button>
    </Card>
  );
}
```

**DOM events fold in here** — `on click`, `on resize`, etc. become event children of the component, not a separate top-level feature (Codex recommendation).

**Files to change:**
- `packages/core/src/spec.ts` — add `component` node type
- `packages/core/src/parser.ts` — parse component syntax
- `packages/core/src/codegen-core.ts` — generate component IR
- `packages/react/src/codegen-react.ts` — React component output
- Tests: component → React roundtrip

**Closes:** 94+ blocks (jsx-element + react-hook + event-listener)

---

### Phase 3.5: `middleware` / pipeline
**Effort:** 1-2 days | **Impact:** Route groups, shared concerns

**Flagged by both Gemini and Codex as missing.**

```kern
middleware authStack
  use helmet
  use cors origin=["https://audiofacets.com"]
  use rateLimit window=60s max=100
  use authenticate

route group /api/review
  middleware authStack
  route GET /:slug handler { ... }
  route POST /:slug/comment handler { ... }
  route DELETE /:slug handler { ... }
```

**Files to change:**
- `packages/core/src/spec.ts` — add `middleware`, `group` nodes
- `packages/express/src/transpiler-express.ts` — Express router group output
- Tests: middleware → Express

---

### Phase 3.6: `schema` / model
**Effort:** 1-2 days | **Impact:** Shared contracts

**Flagged by Codex as missing.**

```kern
schema CreateReviewRequest
  projectName: string min=1 max=100
  note?: string max=500
  password?: string min=6
  tier: "free" | "pro"

model ReviewSession
  id: number autoincrement
  slug: string unique
  projectName: string
  status: "active" | "archived" | "expired"
  createdAt: Date default=now
```

**Compiles to:** Zod schema + TypeScript type + optional Prisma/Drizzle model.

**Files to change:**
- `packages/core/src/spec.ts` — add `schema`, `model` nodes
- `packages/core/src/codegen-core.ts` — generate schema/model
- Tests: schema → Zod + type roundtrip

---

## Target Coverage After v3

| Codebase | Before | After v3 | Realistic target |
|----------|--------|----------|-----------------|
| Backend | 75% | ~92% | 88-90% (Codex: plan around this) |
| Frontend | 82% | ~92% | 88-90% |

Remaining ~10% stays as TypeScript handler bodies:
- Complex business logic, audio processing, custom algorithms, migrations

## What Stays as TypeScript

This is a **feature, not a bug** (Gemini: "escape hatches where DSL becomes too restrictive"):
- Complex if/else chains with domain-specific rules
- Audio processing (Web Audio API, FFT, buffer manipulation)
- Custom algorithms (slug generation, hash computation)
- Database migrations (one-off scripts)

## Critical Warnings

- **Gemini:** "Don't make the handler block a string dump — if KERN doesn't understand what's inside, review capabilities drop"
- **Codex:** "Plan around 88-90%, treat 92% as stretch. The last 8-10% is always the nasty tail"
- **Gemini:** "Agnosticism is key — if component is too React-heavy, you've built a worse TypeScript"
- **Codex:** "Effect is only valuable if it carries reviewable semantics, not just sugar"

## Input Sources

- **Gap data:** `kern review` on audiofacets (903 files)
- **Gemini:** Reorder to module first, route must be framework-agnostic, component abstract, don't string-dump handlers, add middleware
- **Codex:** Same reorder, effect before component, React only for v1, add schema/model, plan for 88-90% not 92%
- **Claude:** Synthesis, gap classification, coverage projections
- **Nico:** "audiofacets is the test bench for KERN — every gap is a missing feature"
