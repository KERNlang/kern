import type { ConceptNode } from '@kernlang/core';
import { conceptId } from '@kernlang/core';
import { type SourceFile, SyntaxKind } from 'ts-morph';
import { getContainerId, isInAsyncContext, span } from '../helpers/ast.js';
import { buildConstLiteralMap } from '../helpers/const-resolution.js';
import { extractHandledErrorStatusCodes, extractHandlesApiErrors, isResponseAsserted } from '../helpers/error-paths.js';
import {
  extractAuthPropagation,
  extractBodyKind,
  extractHasAuthHeader,
  extractHost,
  extractHttpMethod,
  extractQueryParams,
  extractSentFields,
  extractTarget,
} from '../helpers/network-call.js';
import { collectClientIdentifiers } from '../helpers/wrapped-client.js';
import { CLIENT_HTTP_METHODS, DB_CALLS, FS_CALLS, NETWORK_CALLS, NETWORK_METHODS } from '../signatures.js';

export function extractEffects(sf: SourceFile, filePath: string, nodes: ConceptNode[]): void {
  const clientIdents = collectClientIdentifiers(sf);
  const constLiterals = buildConstLiteralMap(sf);

  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    let funcName = '';
    let objName = '';

    if (callee.getKind() === SyntaxKind.Identifier) {
      funcName = callee.getText();
    } else if (callee.getKind() === SyntaxKind.PropertyAccessExpression) {
      const pa = callee as import('ts-morph').PropertyAccessExpression;
      funcName = pa.getName();
      objName = pa.getExpression().getText();
    }

    // Network effects.
    //
    // Reject calls whose receiver is a well-known Web API accessor that
    // exposes synchronous `.get(name)` / `.has(name)` returning a scalar (not
    // a Promise). Without this gate, `request.headers.get("Authorization")`
    // is misclassified as a network call because `objName` ("request.headers")
    // contains the substring "request" — matching the library regex below —
    // and `get` is in NETWORK_METHODS. See RULE-FEEDBACK.md entry #3.
    //
    // The list is narrow on purpose (Gemini review): `.params`, `.body`,
    // `.query` were dropped because tRPC / GraphQL clients legitimately use
    // those as sub-namespaces carrying network methods (`client.query.get(...)`).
    // Only the three confirmed-synchronous Web API accessors stay.
    const isWebApiAccessor = /\.(headers|cookies|searchParams)$/.test(objName);

    const isDirectNetwork = NETWORK_CALLS.has(funcName);
    const isKnownLibraryMethod =
      !isWebApiAccessor && NETWORK_METHODS.has(funcName) && /axios|got|ky|http|request|superagent/i.test(objName);
    const isWrappedClientCall = CLIENT_HTTP_METHODS.has(funcName) && clientIdents.has(objName);

    if (isDirectNetwork || isKnownLibraryMethod || isWrappedClientCall) {
      const isAsync = isInAsyncContext(call);
      const target = extractTarget(call, constLiterals);
      const sentFieldsInfo = extractSentFields(call, funcName);
      const queryParamsInfo = extractQueryParams(call, constLiterals);
      const hasAuthHeader = extractHasAuthHeader(call, funcName);
      nodes.push({
        id: conceptId(filePath, 'effect', call.getStart()),
        kind: 'effect',
        primarySpan: span(filePath, call),
        evidence: call.getText().substring(0, 120),
        confidence: isDirectNetwork ? 1.0 : isWrappedClientCall ? 0.75 : 0.8,
        language: 'ts',
        containerId: getContainerId(call, filePath),
        payload: {
          kind: 'effect',
          subtype: 'network',
          async: isAsync,
          target,
          host: extractHost(target),
          handledErrorStatusCodes: extractHandledErrorStatusCodes(call),
          responseAsserted: isResponseAsserted(call, isWrappedClientCall),
          bodyKind: extractBodyKind(call, funcName),
          method: extractHttpMethod(call, funcName, isDirectNetwork, isKnownLibraryMethod, isWrappedClientCall),
          hasAuthHeader,
          sentFields: sentFieldsInfo.fields,
          sentFieldsResolved: sentFieldsInfo.resolved,
          sentFieldTypes: sentFieldsInfo.types,
          handlesApiErrors: extractHandlesApiErrors(call, isWrappedClientCall),
          authPropagation: extractAuthPropagation(call, funcName, objName, isWrappedClientCall, hasAuthHeader),
          queryParams: queryParamsInfo.params,
          queryParamsResolved: queryParamsInfo.resolved,
        },
      });
      continue;
    }

    // DB effects
    if (DB_CALLS.has(funcName) && /db|prisma|mongo|pool|client|knex|sequelize|typeorm|drizzle/i.test(objName)) {
      nodes.push({
        id: conceptId(filePath, 'effect', call.getStart()),
        kind: 'effect',
        primarySpan: span(filePath, call),
        evidence: call.getText().substring(0, 120),
        confidence: 0.85,
        language: 'ts',
        containerId: getContainerId(call, filePath),
        payload: { kind: 'effect', subtype: 'db', async: isInAsyncContext(call) },
      });
      continue;
    }

    // FS effects
    if (FS_CALLS.has(funcName)) {
      nodes.push({
        id: conceptId(filePath, 'effect', call.getStart()),
        kind: 'effect',
        primarySpan: span(filePath, call),
        evidence: call.getText().substring(0, 120),
        confidence: 0.95,
        language: 'ts',
        containerId: getContainerId(call, filePath),
        payload: { kind: 'effect', subtype: 'fs', async: funcName.includes('Sync') ? false : isInAsyncContext(call) },
      });
    }
  }
}
