# KERN Backend Node Proposals — Forge Brief

**Date:** 2026-03-20
**Context:** fitVT stress test — full FastAPI backend (53 patterns, 20 API modules) vs KERN capability inventory (58 core + 17 server node types)
**Goal:** Identify and design the missing node types that would let KERN express a complete backend, not just the API surface.

---

## The Problem

KERN can currently express: routes, middleware, types, interfaces, service stubs, config, errors, state machines, pure functions. That covers the **API surface** — about 15-20% of a real backend.

What it cannot express: database models, query layers, dependency injection, caching, background jobs, file storage, transactional email. That's the other **80%** — the part that makes a backend actually work.

fitVT has 53 distinct architectural patterns. KERN covers 13 of them today.

---

## Proposed New Nodes (4 P0/P1, challenge these)

### 1. `model` — ORM entity definition (P0)

**Why:** Every backend has DB models. Without this, KERN describes interfaces but not persistence.

**fitVT evidence:** 11 models, each with columns, constraints, relationships, computed properties, cascade rules, abstract inheritance.

**Proposed syntax:**
```kern
model name=User table=users extends=TimestampedModel
  column name=email type=string unique=true index=true
  column name=height type=number nullable=true
  column name=gender type=Gender nullable=true
  relationship name=credentials target=UserCredential kind=one-to-many cascade="all, delete-orphan"
  relationship name=goal target=UserGoal kind=one-to-one cascade="all, delete-orphan"
  constraint unique columns="user_id, recorded_date"
  computed name=age type=number
    handler <<<
      if (!this.birthDate) return null;
      const today = new Date();
      return today.getFullYear() - this.birthDate.getFullYear();
    >>>
```

**Generates:**
- **Express/TS:** Prisma schema OR Drizzle schema OR TypeORM entity (configurable)
- **FastAPI/Python:** SQLAlchemy model class

**Children:** `column`, `relationship`, `constraint`, `index`, `computed`

**Open questions for forge:**
- Should `model` replace `interface` for DB-backed types, or coexist?
- Should we support abstract base models (`abstract=true`)?
- One ORM per target, or configurable? (Prisma vs Drizzle vs TypeORM for TS)
- Should migrations be in-scope? (Alembic/Prisma migrate)

---

### 2. `repository` — typed data access layer (P0)

**Why:** Services are empty shells without query logic. The repository pattern is universal.

**fitVT evidence:** 11 repositories all extending a generic base with CRUD + custom queries. Dynamic filter pattern, aggregate queries, eager loading, upsert.

**Proposed syntax:**
```kern
repository name=UserRepository model=User
  method name=findByEmail params="email:string" returns="User | null"
    handler <<<
      return this.getOneByFilters({ email });
    >>>
  method name=findWithCredentials params="userId:string" returns=User
    handler <<<
      return this.findById(userId, { include: ['credentials', 'goal'] });
    >>>
  method name=softDelete params="userId:string" returns=void
    handler <<<
      await this.update(userId, { isActive: false });
    >>>
```

**Generates:**
- **TS:** class extending a generic `BaseRepository<Model>` with typed CRUD
- **Python:** async class with SQLAlchemy `select`, `update`, `delete`

**Open questions for forge:**
- Should KERN generate the base repository class, or just concrete ones?
- How to express eager loading / joins declaratively vs in handler code?
- Should filter queries be declarative (`filter email=params.email`) or handler-based?
- Is `repository` the right name? Alternatives: `query`, `dao`, `store` (conflicts with existing `store`)

---

### 3. `dependency` — DI wiring / provider factory (P1)

**Why:** Routes need services, services need repositories, repositories need DB sessions. This wiring is ~15 factory functions in fitVT.

**fitVT evidence:** FastAPI `Depends()` chains, 15+ dependency factories connecting services to repositories to DB.

**Proposed syntax:**
```kern
dependency name=authService
  inject db from=database
  inject userRepo type=UserRepository with=(db)
  inject authCodeRepo type=AuthCodeRepository with=(db)
  return AuthService with=(userRepo, authCodeRepo)
```

**Generates:**
- **Express/TS:** Factory function or constructor injection
- **FastAPI/Python:** `async def get_auth_service(db = Depends(get_db)): return AuthService(UserRepository(db), ...)`

**Open questions for forge:**
- Is this even needed as a node, or should route `auth` and `validate` nodes just wire implicitly?
- Should it support scopes (request-scoped, singleton, transient)?
- Could this be a prop on `service` instead? (`service name=AuthService inject="userRepo:UserRepository, authCodeRepo:AuthCodeRepository"`)

---

### 4. `cache` — caching abstraction (P1)

**Why:** Redis is the second most common backend dependency. Rate limiting, sessions, computed cache, tag invalidation.

**fitVT evidence:** 4 Redis components — connection manager, cache patterns with tag-based invalidation, session store, token store. Rate limiting via sorted sets.

**Proposed syntax:**
```kern
cache name=userCache backend=redis prefix="user:"
  entry name=profile key="user:{id}" ttl=3600
  entry name=stats key="user:{id}:stats" ttl=1800
  invalidate tags=["user:{id}"] on="userUpdate"

cache name=rateLimit backend=redis strategy=sliding-window
  rule name=ipLimit limit=100 window=60 by=ip
  rule name=authLimit limit=10 window=60 by=ip scope="/api/auth/*"
```

**Generates:**
- **TS:** `ioredis` client with typed get/set/invalidate
- **Python:** `aioredis` client with async get/set, ZSET rate limiting

**Open questions for forge:**
- Should rate limiting be a separate node (`ratelimit`) or part of `cache`?
- How to express the session store pattern (TTL extension on access, bulk revocation)?
- Should `cache` generate a decorator for method-level caching?
- Redis-specific or abstract? (What about Memcached, in-memory?)

---

## Tier 2 Nodes (lower priority, mention for completeness)

### `job` — background tasks
```kern
job name=processDeleteions schedule="0 2 * * *" retry=3 timeout=300
  handler <<<...>>>
```
Generates: BullMQ (TS), arq/Celery (Python)

### `storage` — file/blob storage
```kern
storage name=uploads provider=s3 bucket="fitvt-uploads"
  policy name=images maxSize="50mb" types=["image/jpeg", "image/png"]
```
Generates: `@aws-sdk/client-s3` (TS), `aioboto3` (Python)

### `email` — transactional email
```kern
email name=authCode provider=brevo
  template subject="Your login code" to="{{email}}"
    body <<<Your code is {{code}}>>>
```
Generates: Brevo/SendGrid SDK calls

---

## Forge Questions

1. **Priority order** — Is model→repository→dependency→cache the right sequence? Or should dependency come first since it wires everything?

2. **Abstraction level** — Should KERN's `model` be ORM-agnostic (compile to Prisma OR TypeORM OR Drizzle) or pick one per target? Prisma has its own schema language — does KERN compete with it or generate it?

3. **Handler escape hatch** — All proposals include `handler <<<>>>` for complex logic. Is this the right balance, or should we push for more declarative primitives (e.g., `filter`, `aggregate`, `join` nodes)?

4. **Naming** — `model` vs `entity` vs `table`? `repository` vs `query` vs `dao`? Names signal intent.

5. **Scope** — Should KERN aim to express 100% of a backend (including Redis internals, S3 presigning, email templates) or stop at ~85% and let handler blocks cover the rest?

---

## Raw Data

- fitVT pattern catalog: 53 patterns documented (available on request)
- KERN node inventory: 58 core + 17 server + 5 CLI + 26 UI + 8 terminal node types
- Generated output: `fitvt-auth.kern` (140 lines) → 27 Express files + 11 FastAPI files (working, typechecks)
