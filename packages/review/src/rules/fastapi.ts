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
  bodyStartLine: number;
  endLine: number;
  name: string;
  paramText: string;
  method?: string;
  isAsync: boolean;
  decoratorText: string;
  body: string;
}

function lineForIndex(text: string, index: number): number {
  return text.slice(0, index).split('\n').length;
}

function isEscaped(text: string, index: number): boolean {
  let count = 0;
  for (let i = index - 1; i >= 0 && text[i] === '\\'; i--) count++;
  return count % 2 === 1;
}

function routeNodes(concepts: ConceptMap): ConceptNode[] {
  return concepts.nodes
    .filter(
      (node) => node.kind === 'entrypoint' && node.payload.kind === 'entrypoint' && node.payload.subtype === 'route',
    )
    .sort((a, b) => a.primarySpan.startLine - b.primarySpan.startLine);
}

function scanBalancedText(
  lines: string[],
  startLine: number,
  startColumn: number,
): { text: string; endLine: number } | undefined {
  let depth = 1;
  let text = '';
  let quote: string | undefined;
  let tripleQuote = false;

  for (let i = startLine; i < lines.length; i++) {
    const line = lines[i];
    for (let col = i === startLine ? startColumn : 0; col < line.length; col++) {
      const ch = line[col];
      const next = line.slice(col, col + 3);

      if (quote) {
        if (tripleQuote && next === quote.repeat(3)) {
          text += next;
          col += 2;
          quote = undefined;
          tripleQuote = false;
          continue;
        }
        text += ch;
        if (!tripleQuote && ch === quote && !isEscaped(line, col)) quote = undefined;
        continue;
      }

      if (ch === '"' || ch === "'") {
        if (next === ch.repeat(3)) {
          quote = ch;
          tripleQuote = true;
          text += next;
          col += 2;
          continue;
        }
        quote = ch;
        text += ch;
        continue;
      }

      if (ch === '(' || ch === '[' || ch === '{') depth++;
      if (ch === ')' || ch === ']' || ch === '}') depth--;
      if (depth === 0) return { text, endLine: i };
      text += ch;
    }
    text += '\n';
  }

  return undefined;
}

function splitTopLevelPythonParams(paramText: string): string[] {
  const params: string[] = [];
  let depth = 0;
  let start = 0;
  let quote: string | undefined;
  let tripleQuote = false;

  for (let i = 0; i < paramText.length; i++) {
    const ch = paramText[i];
    const next = paramText.slice(i, i + 3);

    if (quote) {
      if (tripleQuote && next === quote.repeat(3)) {
        i += 2;
        quote = undefined;
        tripleQuote = false;
      } else if (!tripleQuote && ch === quote && !isEscaped(paramText, i)) {
        quote = undefined;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      if (next === ch.repeat(3)) {
        quote = ch;
        tripleQuote = true;
        i += 2;
      } else {
        quote = ch;
      }
      continue;
    }

    if (ch === '(' || ch === '[' || ch === '{') depth++;
    if (ch === ')' || ch === ']' || ch === '}') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) {
      params.push(paramText.slice(start, i));
      start = i + 1;
    }
  }

  params.push(paramText.slice(start));
  return params;
}

function maskPythonStringsAndComments(text: string): string {
  let out = '';
  let quote: string | undefined;
  let tripleQuote = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text.slice(i, i + 3);

    if (quote) {
      if (tripleQuote && next === quote.repeat(3)) {
        out += '   ';
        i += 2;
        quote = undefined;
        tripleQuote = false;
        continue;
      }
      out += ch === '\n' ? '\n' : ' ';
      if (!tripleQuote && ch === quote && !isEscaped(text, i)) quote = undefined;
      continue;
    }

    if (ch === '#') {
      while (i < text.length && text[i] !== '\n') {
        out += ' ';
        i++;
      }
      if (i < text.length) out += '\n';
      continue;
    }

    if (ch === '"' || ch === "'") {
      if (next === ch.repeat(3)) {
        quote = ch;
        tripleQuote = true;
        out += '   ';
        i += 2;
      } else {
        quote = ch;
        out += ' ';
      }
      continue;
    }

    out += ch;
  }

  return out;
}

function extractRoutes(source: string, concepts: ConceptMap): RouteBlock[] {
  const lines = source.split('\n');
  const routes: RouteBlock[] = [];

  for (const node of routeNodes(concepts)) {
    const startIdx = node.primarySpan.startLine - 1;
    for (let i = startIdx; i < lines.length; i++) {
      const match = lines[i].match(/^(\s*)(async\s+def|def)\s+([A-Za-z_]\w*)\s*\(/);
      if (!match) continue;

      const params = scanBalancedText(lines, i, match[0].length);
      if (!params) continue;
      const defIndent = match[1].length;
      let endLine = lines.length;
      const bodyStartIdx = params.endLine + 1;
      for (let j = bodyStartIdx; j < lines.length; j++) {
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
        bodyStartLine: bodyStartIdx + 1,
        endLine,
        name: match[3],
        paramText: params.text,
        method: node.payload.kind === 'entrypoint' ? node.payload.httpMethod : undefined,
        isAsync: match[2].startsWith('async'),
        decoratorText: node.evidence,
        body: lines.slice(bodyStartIdx, endLine).join('\n'),
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
  return route.bodyStartLine + lineForIndex(route.body, index) - 1;
}

function routeParamNames(route: RouteBlock): Set<string> {
  const names = new Set<string>();
  for (const raw of splitTopLevelPythonParams(route.paramText)) {
    const trimmed = raw.trim();
    if (!trimmed || trimmed === '/' || trimmed === '*') continue;
    const withoutPrefix = trimmed.replace(/^\*{1,2}/, '');
    if (!withoutPrefix) continue;
    const match = withoutPrefix.match(/^([A-Za-z_]\w*)\s*(?::|=|$)/);
    if (match) names.add(match[1]);
  }
  return names;
}

function firstLocalBindingIndex(route: RouteBlock, name: string): number | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const searchable = maskPythonStringsAndComments(route.body);
  const match = new RegExp(
    `^\\s*(?:${escaped}\\s*(?::[^=\\n]+)?=|for\\s+${escaped}\\s+in\\b|with\\s+.+\\s+as\\s+${escaped}\\b)`,
    'm',
  ).exec(searchable);
  return match?.index;
}

function firstReferenceIndex(route: RouteBlock, name: string): number | undefined {
  const pattern = name === 'req' ? /\breq\b(?:\s*\.|\s*\[|\b)/g : /\bbody\b(?:\s*\.|\s*\[|\b)/g;
  const searchable = maskPythonStringsAndComments(route.body);
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(searchable)) !== null) {
    const previousNonSpace = searchable.slice(0, match.index).match(/\S(?=\s*$)/)?.[0];
    if (previousNonSpace === '.') continue;
    const afterMatch = searchable.slice(match.index + match[0].length).trimStart();
    if (name === 'body' && afterMatch.startsWith('=') && !afterMatch.startsWith('==')) continue;
    const beforeLine = searchable.slice(0, match.index).split('\n').pop() ?? '';
    if (/^\s*(?:#|\/\/)/.test(beforeLine)) continue;
    return match.index;
  }
  return undefined;
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

// ── Rule: fastapi-implicit-request-globals ───────────────────────────────

function implicitRequestGlobals(ctx: FastApiConceptRuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  for (const route of extractRoutes(ctx.source, ctx.concepts)) {
    const params = routeParamNames(route);

    for (const name of ['req', 'body'] as const) {
      if (params.has(name)) continue;
      const index = firstReferenceIndex(route, name);
      if (index === undefined) continue;
      const bindingIndex = firstLocalBindingIndex(route, name);
      if (bindingIndex !== undefined && bindingIndex <= index) continue;

      findings.push(
        finding(
          'fastapi-implicit-request-globals',
          'error',
          'bug',
          `FastAPI route '${route.name}' references '${name}' without declaring it — FastAPI will not inject Express-style globals`,
          ctx.filePath,
          bodyLine(route, index),
          1,
          {
            suggestion:
              name === 'body'
                ? 'Declare a Pydantic body parameter on the route, e.g. body: YourRequestModel'
                : 'Declare request: Request and use request.state/user data, or pass the authenticated user through Depends().',
          },
        ),
      );
    }
  }

  return findings;
}

const FASTAPI_CONCEPT_RULES = [
  missingResponseModel,
  blockingSyncRoute,
  sharedState,
  broadExcept,
  broadCors,
  implicitRequestGlobals,
];

export function runFastapiConceptRules(concepts: ConceptMap, filePath: string, source: string): ReviewFinding[] {
  const ctx: FastApiConceptRuleContext = { concepts, filePath, source };
  return FASTAPI_CONCEPT_RULES.flatMap((rule) => rule(ctx));
}

// FastAPI is executed via reviewPythonSource(), not the TS quality-rule layer.
// The target still needs layer registration for --list-rules / target metadata.
export const fastapiRules: ReviewRule[] = [];
