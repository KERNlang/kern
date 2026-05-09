import type { ConceptEdge, ConceptMap, ConceptNode } from '@kernlang/core';
import { conceptId } from '@kernlang/core';
import { collectBackgroundTaskParams } from './extractors/background-tasks.js';
import { addDependency } from './extractors/dependency.js';
import { classifyExceptDisposition, errorStatusCodesFromBody } from './extractors/error.js';
import { paginationStrategyFromSignature } from './extractors/fastapi-pagination.js';
import { collectFullDecoratorText, successStatusCodesFromDecoratorAndBody } from './extractors/fastapi-status.js';
import { collectPydanticModels, fallbackBodyValidation } from './extractors/pydantic.js';
import { functionBody, routeMethod, routeName, routePath, routeResponseModel } from './extractors/routes.js';
import {
  addNode,
  containerForLine,
  findFunctionBlocks,
  indentation,
  lineSpan,
  nextFunctionAfter,
  splitLines,
} from './helpers/lines.js';
import {
  DB_COLLECTION_RE,
  DB_METHODS,
  DB_WRITE_RE,
  EXTRACTOR_VERSION,
  IDEMPOTENCY_RE,
  NETWORK_METHODS,
  NETWORK_MODULES,
  PAGINATION_RE,
} from './signatures.js';

export function extractPythonConceptsFallback(source: string, filePath: string): ConceptMap {
  const lines = splitLines(source);
  const functionBlocks = findFunctionBlocks(lines, filePath);
  const pydanticModels = collectPydanticModels(lines);
  const backgroundTaskParams = collectBackgroundTaskParams(lines, functionBlocks);
  const nodes: ConceptNode[] = [];
  const edges: ConceptEdge[] = [];
  const globalNames = new Set<string>();

  for (const info of lines) {
    const trimmed = info.text.trim();
    const block = containerForLine(functionBlocks, info.line);
    const span = lineSpan(filePath, info);
    const containerId = block?.id;

    if (!trimmed || trimmed.startsWith('#')) continue;

    const fn = functionBlocks.find((candidate) => candidate.startLine === info.line);
    if (fn) {
      const body = lines
        .filter((line) => line.line > fn.startLine && line.line <= fn.endLine)
        .map((line) => line.text)
        .join('\n');
      addNode(nodes, {
        id: fn.id,
        kind: 'function_declaration',
        primarySpan: span,
        evidence: trimmed,
        confidence: 0.8,
        language: 'py',
        payload: {
          kind: 'function_declaration',
          name: fn.name,
          async: fn.async,
          hasAwait: /\bawait\b/.test(body),
          isComponent: false,
          isExport: false,
        },
      });
    }

    if (trimmed.startsWith('global ')) {
      for (const name of trimmed.replace(/^global\s+/, '').split(',')) {
        const normalized = name.trim();
        if (normalized) globalNames.add(normalized);
      }
    }

    if (/^(?:import|from)\s+/.test(trimmed)) {
      const fromMatch = trimmed.match(/^from\s+([.\w]+)\s+import\s+/);
      if (fromMatch) {
        addDependency(edges, filePath, info, fromMatch[1]);
      } else {
        const importList = trimmed.replace(/^import\s+/, '').split(',');
        for (const item of importList) {
          const specifier = item
            .trim()
            .split(/\s+as\s+/)[0]
            ?.trim();
          if (specifier) addDependency(edges, filePath, info, specifier);
        }
      }
    }

    if (/^@(app|router|bp)\.(route|get|post|put|delete|patch)\s*\(/.test(trimmed)) {
      const method = routeMethod(trimmed);
      const path = routePath(trimmed) ?? routeName(lines, info.line - 1);
      const responseModel = routeResponseModel(trimmed);
      const routeFn = nextFunctionAfter(functionBlocks, info.line);
      const body = functionBody(lines, routeFn);
      const validation = fallbackBodyValidation(routeFn, lines, pydanticModels);
      // Codex impl-review #3: multi-line decorators put `status_code=` on
      // continuation lines. Collect the full decorator text across lines
      // until the outer `(` closes.
      const decoratorFullText = collectFullDecoratorText(lines, info.line - 1);
      const success = successStatusCodesFromDecoratorAndBody(decoratorFullText, body);
      const pagination = paginationStrategyFromSignature(routeFn, lines);
      addNode(nodes, {
        id: conceptId(filePath, 'entrypoint', info.offset),
        kind: 'entrypoint',
        primarySpan: span,
        evidence: trimmed,
        confidence: 0.9,
        language: 'py',
        containerId,
        payload: {
          kind: 'entrypoint',
          subtype: 'route',
          name: path,
          httpMethod: method,
          responseModel,
          errorStatusCodes: errorStatusCodesFromBody(body),
          successStatusCodes: success.codes,
          successStatusCodesResolved: success.resolved,
          paginationStrategy: pagination.strategy,
          paginationStrategyResolved: pagination.resolved,
          hasUnboundedCollectionQuery:
            method === 'GET' &&
            !/[{:]/.test(path) &&
            !PAGINATION_RE.test(body) &&
            DB_COLLECTION_RE.test(body) &&
            (responseModel ? /^(list|List|Sequence|Iterable)\s*\[/.test(responseModel) : true),
          hasDbWrite: DB_WRITE_RE.test(body),
          hasIdempotencyProtection: IDEMPOTENCY_RE.test(body),
          hasBodyValidation: validation.has,
          validatedBodyFields: validation.fields,
          bodyValidationResolved: validation.resolved,
          validatedBodyFieldTypes: validation.types,
        },
      });
    }

    if (/@(login_required|requires_auth|permission_required|auth_required|authenticated)/.test(trimmed)) {
      addNode(nodes, {
        id: conceptId(filePath, 'guard', info.offset),
        kind: 'guard',
        primarySpan: span,
        evidence: trimmed,
        confidence: 0.9,
        language: 'py',
        containerId,
        payload: { kind: 'guard', subtype: 'auth', name: trimmed.replace('@', '').split('(')[0] },
      });
    }

    if (
      /\bDepends\s*\(\s*(?:auth_required|requires_auth|authenticated|current_user|get_current_user)\b/.test(trimmed)
    ) {
      addNode(nodes, {
        id: conceptId(filePath, 'guard', info.offset),
        kind: 'guard',
        primarySpan: span,
        evidence: trimmed,
        confidence: 0.85,
        language: 'py',
        containerId,
        payload: { kind: 'guard', subtype: 'auth', name: 'Depends(auth)' },
      });
    }

    if (/\bmodel_validate\s*\(/.test(trimmed)) {
      addNode(nodes, {
        id: conceptId(filePath, 'guard', info.offset),
        kind: 'guard',
        primarySpan: span,
        evidence: trimmed,
        confidence: 0.85,
        language: 'py',
        containerId,
        payload: { kind: 'guard', subtype: 'validation', name: 'pydantic' },
      });
    }

    if (/^if\b.*\b(user|auth|request\.user)\b/.test(trimmed)) {
      const next = lines.find((line) => line.line > info.line && line.text.trim());
      if (next && indentation(next.text) > indentation(info.text) && /^\s*(raise|return)\b/.test(next.text)) {
        addNode(nodes, {
          id: conceptId(filePath, 'guard', info.offset),
          kind: 'guard',
          primarySpan: span,
          evidence: trimmed,
          confidence: 0.75,
          language: 'py',
          containerId,
          payload: { kind: 'guard', subtype: 'auth' },
        });
      }
    }

    if (/^raise\b/.test(trimmed)) {
      addNode(nodes, {
        id: conceptId(filePath, 'error_raise', info.offset),
        kind: 'error_raise',
        primarySpan: span,
        evidence: trimmed,
        confidence: 0.9,
        language: 'py',
        containerId,
        payload: { kind: 'error_raise', subtype: 'throw', errorType: trimmed.match(/^raise\s+([A-Za-z_]\w*)/)?.[1] },
      });
    }

    if (/^except\b/.test(trimmed)) {
      addNode(nodes, {
        id: conceptId(filePath, 'error_handle', info.offset),
        kind: 'error_handle',
        primarySpan: span,
        evidence: trimmed,
        confidence: 0.75,
        language: 'py',
        containerId,
        payload: classifyExceptDisposition(lines, info.line - 1),
      });
    }

    const networkCall = trimmed.match(
      new RegExp(`\\b(${Array.from(NETWORK_MODULES).join('|')})\\.(${Array.from(NETWORK_METHODS).join('|')})\\s*\\(`),
    );
    if (networkCall || /\baiohttp\.request\s*\(|\bfetch\s*\(/.test(trimmed)) {
      addNode(nodes, {
        id: conceptId(filePath, 'effect', info.offset),
        kind: 'effect',
        primarySpan: span,
        evidence: trimmed,
        confidence: 0.75,
        language: 'py',
        containerId,
        payload: { kind: 'effect', subtype: 'network', async: Boolean(block?.async), target: networkCall?.[0] },
      });
    }

    const dbPattern = new RegExp(`\\b([A-Za-z_]\\w*)\\.(${Array.from(DB_METHODS).join('|')})\\s*\\(`);
    const dbCall = trimmed.match(dbPattern);
    if (dbCall && /cursor|conn|db|session|collection/i.test(dbCall[1])) {
      addNode(nodes, {
        id: conceptId(filePath, 'effect', info.offset),
        kind: 'effect',
        primarySpan: span,
        evidence: trimmed,
        confidence: 0.7,
        language: 'py',
        containerId,
        payload: { kind: 'effect', subtype: 'db', async: Boolean(block?.async), target: dbCall[0] },
      });
    }

    if (/\bopen\s*\(/.test(trimmed)) {
      addNode(nodes, {
        id: conceptId(filePath, 'effect', info.offset),
        kind: 'effect',
        primarySpan: span,
        evidence: trimmed,
        confidence: 0.8,
        language: 'py',
        containerId,
        payload: { kind: 'effect', subtype: 'fs', async: Boolean(block?.async), target: 'open' },
      });
    }

    // FastAPI BackgroundTasks dispatch: `<param>.add_task(fn, ...)` where
    // `<param>` is typed `BackgroundTasks` in the enclosing function's
    // signature. Tree-sitter mirror: review-python's background-tasks
    // extractor.
    const addTaskMatch = trimmed.match(/(?:^|[^A-Za-z0-9_])([A-Za-z_]\w*)\.add_task\s*\(\s*([A-Za-z_][\w.]*)?/);
    if (addTaskMatch && block) {
      const params = backgroundTaskParams.get(block.id);
      if (params?.has(addTaskMatch[1])) {
        addNode(nodes, {
          id: conceptId(filePath, 'effect', info.offset),
          kind: 'effect',
          primarySpan: span,
          evidence: trimmed,
          confidence: 0.85,
          language: 'py',
          containerId,
          payload: {
            kind: 'effect',
            subtype: 'background-task',
            async: Boolean(block?.async),
            target: addTaskMatch[2],
          },
        });
      }
    }

    const assignment = trimmed.match(/^([A-Za-z_]\w*)\s*(?:=|\+=|-=|\*=|\/=)/);
    if (assignment) {
      const atTopLevel = !block;
      const name = assignment[1];
      if (atTopLevel || globalNames.has(name)) {
        addNode(nodes, {
          id: conceptId(filePath, 'state_mutation', info.offset),
          kind: 'state_mutation',
          primarySpan: span,
          evidence: trimmed,
          confidence: atTopLevel ? 0.7 : 0.85,
          language: 'py',
          containerId,
          payload: { kind: 'state_mutation', target: name, scope: globalNames.has(name) ? 'global' : 'module' },
        });
      }
    }

    const selfAssignment = trimmed.match(/^self\.([A-Za-z_]\w*)\s*(?:=|\+=|-=|\*=|\/=)/);
    if (selfAssignment) {
      addNode(nodes, {
        id: conceptId(filePath, 'state_mutation', info.offset),
        kind: 'state_mutation',
        primarySpan: span,
        evidence: trimmed,
        confidence: 0.8,
        language: 'py',
        containerId,
        payload: { kind: 'state_mutation', target: `self.${selfAssignment[1]}`, scope: 'module' },
      });
    }
  }

  return {
    filePath,
    language: 'py',
    nodes,
    edges,
    extractorVersion: EXTRACTOR_VERSION,
  };
}
