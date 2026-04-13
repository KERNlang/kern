# KERN Architecture

KERN is a pnpm monorepo with one semantic center and several delivery surfaces. Shared meaning lives low in the graph, while user-facing orchestration lives at the edges.

## Package Layers

| Layer | Packages | Responsibility |
|-------|----------|----------------|
| Semantic core | `@kernlang/core` | Parser, AST/IR, schema, target config, codegen helpers, runtime helpers |
| Analysis and semantic tooling | `@kernlang/review`, `@kernlang/review-python`, `@kernlang/review-mcp`, `@kernlang/evolve`, `@kernlang/metrics`, `@kernlang/protocol` | Static analysis, taint tracking, language inference, Python and MCP review surfaces, metrics, draft AI protocol |
| Target adapters | `@kernlang/react`, `@kernlang/vue`, `@kernlang/express`, `@kernlang/fastapi`, `@kernlang/mcp`, `@kernlang/native`, `@kernlang/terminal` | Emit code for one runtime or framework family from shared KERN semantics |
| Orchestration and product surfaces | `@kernlang/cli`, `@kernlang/mcp-server`, `@kernlang/playground`, `kern-lang` | Aggregate lower packages into command-line, MCP, browser, and compatibility entrypoints |

## Dependency Rules

1. `@kernlang/core` is the bottom of the graph. It should not depend on any other workspace package.
2. Target adapter packages should depend on `@kernlang/core` only.
3. Analysis packages may depend on `@kernlang/core`, and on `@kernlang/review` when extending the review engine for a domain like Python or MCP.
4. Orchestration packages may aggregate many lower-layer packages, but lower layers must not depend on `@kernlang/cli`, `@kernlang/mcp-server`, `@kernlang/playground`, or `kern-lang`.
5. New user-facing commands, APIs, or hosted surfaces belong in orchestration packages, not in `@kernlang/core`.
6. New target-specific code generation belongs in a target adapter package, not in `@kernlang/cli`.
7. New review rules belong in `@kernlang/review` unless they are explicitly domain-specific to MCP or Python.

## Current Shape

The repo already mostly follows this layering:

- `@kernlang/core` has no workspace dependencies and acts as the semantic hub.
- Most transpiler packages depend only on `@kernlang/core`.
- `@kernlang/review` depends on `@kernlang/core`, and the Python and MCP review packages extend that review layer.
- `@kernlang/cli` and `@kernlang/mcp-server` are deliberate aggregation points.
- `@kernlang/playground` is a private product surface and should stay out of lower-layer dependency chains.

## Where To Put New Work

| If you are adding... | Put it in... |
|----------------------|--------------|
| AST, schema, parsing, codegen primitives, target registry, shared runtime helpers | `@kernlang/core` |
| A new compile target or framework emitter | a new or existing target adapter package |
| A general static analysis rule | `@kernlang/review` |
| Python-specific review logic | `@kernlang/review-python` |
| MCP security review logic | `@kernlang/review-mcp` |
| A CLI command, scaffold flow, or release/dev UX | `@kernlang/cli` |
| A new MCP tool, resource, or prompt | `@kernlang/mcp-server` |
| Browser-only interactive product behavior | `@kernlang/playground` |

## Contributor Heuristics

- If a change would be useful to more than one surface, it probably belongs below the orchestration layer.
- If a package needs half the monorepo to do its job, it is probably an orchestration package and should be treated as one.
- If a target package starts importing another target package, stop and move the shared logic down into `@kernlang/core`.
- If a doc or workflow describes KERN as one thing, make sure the package boundaries still support that story.

## Release Boundary

The release path should treat orchestration as thin and shared logic as stable:

- CI proves the commit on `main`.
- `Release Preflight` runs the same install, build, test, and publish path without publishing.
- `Version & Publish` reuses that same pipeline for the tagged release.

That keeps release engineering aligned with the package graph instead of inventing a separate deployment-only path.
