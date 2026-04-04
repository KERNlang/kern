/**
 * FastAPI review rules — active when target = fastapi.
 *
 * FastAPI uses the Python concept pipeline, so the real checks live in
 * runFastapiConceptRules() below and operate on ConceptMap + source text.
 */

import type { ConceptMap, ConceptNode } from '@kernlang/core';
import type { ReviewFinding, ReviewRule } from '../types.js';
import { finding } from './utils.js';

interface FastApiConceptRuleContext {
  concepts: ConceptMap;
  filePath: string;
  source: string;
}

interface RouteBlock {
  startLine: number;
  headerLine: number;
  endLine: number;
  name: string;
  method?: string;
  isAsync: boolean;
  decoratorText: string;
  body: string;
}

function lineForIndex(text: string, index: number): number {
  return text.slice(0, index).split('\n').length;
}

function routeNodes(concepts: ConceptMap): ConceptNode[] {
  return concepts.nodes
    .filter(
      (node) => node.kind === 'entrypoint' && node.payload.kind === 'entrypoint' && node.payload.subtype === 'route',
    )
    .sort((a, b) => a.primarySpan.startLine - b.primarySpan.startLine);
}

function extractRoutes(source: string, concepts: ConceptMap): RouteBlock[] {
  const lines = source.split('\n');
  const routes: RouteBlock[] = [];

  for (const node of routeNodes(concepts)) {
    const startIdx = node.primarySpan.startLine - 1;
    for (let i = startIdx; i < lines.length; i++) {
      const match = lines[i].match(/^(\s*)(async\s+def|def)\s+([A-Za-z_]\w*)\s*\(/);
      if (!match) continue;

      const defIndent = match[1].length;
      let endLine = lines.length;
      for (let j = i + 1; j < lines.length; j++) {
        const line = lines[j];
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const indent = line.match(/^(\s*)/)?.[1].length ?? 0;
        if (indent <= defIndent) {
          endLine = j;
          break;
        }
      }

      routes.push({
        startLine: node.primarySpan.startLine,
        headerLine: i + 1,
        endLine,
        name: match[3],
        method: node.payload.kind === 'entrypoint' ? node.payload.httpMethod : undefined,
        isAsync: match[2].startsWith('async'),
        decoratorText: node.evidence,
        body: lines.slice(i + 1, endLine).join('\n'),
      });
      break;
    }
  }

  return routes;
}

function nodesInRoute(ctx: FastApiConceptRuleContext, route: RouteBlock, kind: ConceptNode['kind']): ConceptNode[] {
  return ctx.concepts.nodes.filter(
    (node) =>
      node.kind === kind &&
      node.primarySpan.startLine >= route.startLine &&
      node.primarySpan.startLine <= route.endLine,
  );
}

function bodyLine(route: RouteBlock, index: number): number {
  return route.headerLine + lineForIndex(route.body, index);
}

// ── Rule: fastapi-missing-response-model ────────────────────────────────

function missingResponseModel(ctx: FastApiConceptRuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const plainReturn =
    /\breturn\s+(?!None\b)(?!JSONResponse\b)(?!ORJSONResponse\b)(?!UJSONResponse\b)(?!PlainTextResponse\b)(?!StreamingResponse\b)(?!FileResponse\b)(?!RedirectResponse\b)(?!HTMLResponse\b)(?!TemplateResponse\b)(?!Response\b)(?:\{|\[|[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)/;

  for (const route of extractRoutes(ctx.source, ctx.concepts)) {
    if (/response_model\s*=/.test(route.decoratorText)) continue;
    if (!plainReturn.test(route.body)) continue;

    findings.push(
      finding(
        'fastapi-missing-response-model',
        'warning',
        'pattern',
        `FastAPI route '${route.name}' returns data without response_model — response shape is undocumented and easy to over-expose`,
        ctx.filePath,
        route.startLine,
        1,
        {
          suggestion:
            'Declare response_model=YourSchema on the route decorator so FastAPI validates and filters outbound data',
        },
      ),
    );
  }

  return findings;
}

// ── Rule: fastapi-blocking-sync-route ───────────────────────────────────

const BLOCKING_PATTERNS = [
  {
    pattern: /\brequests\.(?:get|post|put|patch|delete|head|options|request)\s*\(/g,
    label: 'requests.*',
    suggestion: 'Use httpx.AsyncClient/aiohttp or move the blocking call to a threadpool',
  },
  { pattern: /\bopen\s*\(/g, label: 'open()', suggestion: 'Use aiofiles or move blocking file I/O off the event loop' },
  {
    pattern: /\b(?:sqlite3|psycopg2)\./g,
    label: 'sync DB client',
    suggestion: 'Use an async database driver inside async FastAPI routes',
  },
  {
    pattern: /\bcursor\.execute\s*\(/g,
    label: 'cursor.execute()',
    suggestion: 'Use an async database client or execute the query in a worker thread',
  },
  {
    pattern: /\bsubprocess\.(?:run|call|check_call|check_output)\s*\(/g,
    label: 'subprocess.*',
    suggestion: 'Use asyncio.create_subprocess_exec() or a worker thread from async routes',
  },
  {
    pattern: /\btime\.sleep\s*\(/g,
    label: 'time.sleep()',
    suggestion: 'Use await asyncio.sleep() in async FastAPI routes',
  },
];

function blockingSyncRoute(ctx: FastApiConceptRuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  for (const route of extractRoutes(ctx.source, ctx.concepts)) {
    if (!route.isAsync) continue;

    for (const { pattern, label, suggestion } of BLOCKING_PATTERNS) {
      pattern.lastIndex = 0;
      const match = pattern.exec(route.body);
      if (!match) continue;

      findings.push(
        finding(
          'fastapi-blocking-sync-route',
          'warning',
          'bug',
          `Async FastAPI route '${route.name}' uses blocking ${label} — the event loop will stall under load`,
          ctx.filePath,
          bodyLine(route, match.index),
          1,
          { suggestion },
        ),
      );
      break;
    }
  }

  return findings;
}

// ── Rule: fastapi-shared-state ──────────────────────────────────────────

function sharedState(ctx: FastApiConceptRuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  for (const route of extractRoutes(ctx.source, ctx.concepts)) {
    for (const mutation of nodesInRoute(ctx, route, 'state_mutation')) {
      const payload = mutation.payload;
      if (payload.kind !== 'state_mutation') continue;
      if (payload.scope !== 'global' && payload.scope !== 'module') continue;

      findings.push(
        finding(
          'fastapi-shared-state',
          'error',
          'bug',
          `FastAPI route '${route.name}' mutates ${payload.scope} state '${payload.target}' — concurrent requests can race and leak state across users`,
          ctx.filePath,
          mutation.primarySpan.startLine,
          1,
          {
            suggestion:
              'Move per-request data into function scope, a dependency, or a database/cache with explicit concurrency control',
          },
        ),
      );
    }
  }

  return findings;
}

// ── Rule: fastapi-broad-except ──────────────────────────────────────────

function broadExcept(ctx: FastApiConceptRuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const broad = /^\s*except(?:\s+Exception(?:\s+as\s+\w+)?)?\s*:/gm;

  for (const route of extractRoutes(ctx.source, ctx.concepts)) {
    const handlers = nodesInRoute(ctx, route, 'error_handle');
    if (handlers.length === 0) continue;

    let match: RegExpExecArray | null;
    while ((match = broad.exec(route.body)) !== null) {
      const line = bodyLine(route, match.index);
      const conceptMatch = handlers.find((node) => node.primarySpan.startLine === line);
      if (!conceptMatch) continue;

      const block = route.body.slice(match.index, match.index + 220);
      if (/\braise\s+HTTPException\b|\braise\b/.test(block)) continue;

      findings.push(
        finding(
          'fastapi-broad-except',
          'warning',
          'bug',
          `FastAPI route '${route.name}' catches broad exceptions without re-raising — real failures get flattened into generic responses`,
          ctx.filePath,
          line,
          1,
          {
            suggestion:
              "Catch specific exceptions and re-raise HTTPException (or let FastAPI's exception handlers deal with them)",
          },
        ),
      );
    }
  }

  return findings;
}

// ── Rule: fastapi-broad-cors ──────────────────────────────────────────────

function broadCors(ctx: FastApiConceptRuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const corsRegex = /allow_origins\s*=\s*\[([^\]]*)\]/g;

  let match: RegExpExecArray | null;
  while ((match = corsRegex.exec(ctx.source)) !== null) {
    if (!match[1].includes('"*"') && !match[1].includes("'*'")) continue;

    const line = lineForIndex(ctx.source, match.index);
    findings.push(
      finding(
        'fastapi-broad-cors',
        'warning',
        'pattern',
        'CORSMiddleware uses allow_origins=["*"] — any origin can make credentialed requests if allow_credentials is also True',
        ctx.filePath,
        line,
        1,
        { suggestion: 'Restrict allow_origins to specific trusted domains instead of wildcard' },
      ),
    );
  }

  return findings;
}

const FASTAPI_CONCEPT_RULES = [missingResponseModel, blockingSyncRoute, sharedState, broadExcept, broadCors];

export function runFastapiConceptRules(concepts: ConceptMap, filePath: string, source: string): ReviewFinding[] {
  const ctx: FastApiConceptRuleContext = { concepts, filePath, source };
  return FASTAPI_CONCEPT_RULES.flatMap((rule) => rule(ctx));
}

// FastAPI is executed via reviewPythonSource(), not the TS quality-rule layer.
// The target still needs layer registration for --list-rules / target metadata.
export const fastapiRules: ReviewRule[] = [];
