import { parseDocumentWithDiagnostics } from '../../packages/core/dist/parser.js';
import { kernStringLiteral } from '../capstone/flatten.mjs';
import { SCHEMA_VERSION, UNREADABLE_SOURCE } from './fixtures.mjs';

export { kernStringLiteral };

export function normalizePath(path) {
  return String(path).replace(/\\/g, '/');
}

function isTrueProp(value) {
  return value === true || value === 'true';
}

function propString(node, name) {
  const value = node?.props?.[name];
  return typeof value === 'string' ? value : '';
}

function flag(node, name) {
  return isTrueProp(node?.props?.[name]) ? 1 : 0;
}

function handlerCount(node) {
  return (node.children ?? []).filter((child) => child.type === 'handler' && child.props?.lang === 'kern').length;
}

function topLevel(root) {
  return root?.type === 'document' ? (root.children ?? []) : [];
}

function hasErrorDiagnostic(diagnostics) {
  return diagnostics.some((diagnostic) => diagnostic.severity === 'error');
}

function blankRows() {
  return {
    schemaVersion: SCHEMA_VERSION,
    moduleId: [],
    moduleRoot: [],
    moduleStatus: [],
    fnModule: [],
    fnName: [],
    fnReturns: [],
    fnAsync: [],
    fnStream: [],
    fnHandlers: [],
    fnParams: [],
    fnExport: [],
    paramFn: [],
    paramName: [],
    paramHasChildren: [],
    paramHasValue: [],
    paramHasDefault: [],
    paramOptional: [],
    paramVariadic: [],
    classModule: [],
    className: [],
    classExtends: [],
    classExport: [],
    fieldClass: [],
    fieldName: [],
    memberClass: [],
    memberKind: [],
    memberName: [],
    memberAsync: [],
    memberStream: [],
    memberStatic: [],
    memberHandlers: [],
    useModule: [],
    usePath: [],
    useTarget: [],
    useCandidate: [],
    fromUse: [],
    fromName: [],
    fromAs: [],
    fromKind: [],
    fromExport: [],
  };
}

function pushParam(rows, fnRow, param) {
  rows.paramFn.push(fnRow);
  rows.paramName.push(propString(param, 'name'));
  rows.paramHasChildren.push((param.children ?? []).length > 0 ? 1 : 0);
  rows.paramHasValue.push(param.props?.value === undefined ? 0 : 1);
  rows.paramHasDefault.push(param.props?.default === undefined ? 0 : 1);
  rows.paramOptional.push(flag(param, 'optional'));
  rows.paramVariadic.push(flag(param, 'variadic'));
}

function pushFunction(rows, moduleId, node) {
  rows.fnModule.push(moduleId);
  rows.fnName.push(propString(node, 'name'));
  rows.fnReturns.push(propString(node, 'returns'));
  rows.fnAsync.push(flag(node, 'async'));
  rows.fnStream.push(flag(node, 'stream'));
  rows.fnHandlers.push(handlerCount(node));
  rows.fnParams.push(propString(node, 'params'));
  rows.fnExport.push(flag(node, 'export'));
  const fnRow = rows.fnModule.length;
  for (const child of node.children ?? []) {
    if (child.type === 'param') pushParam(rows, fnRow, child);
  }
}

function pushClass(rows, moduleId, node) {
  rows.classModule.push(moduleId);
  rows.className.push(propString(node, 'name'));
  rows.classExtends.push(propString(node, 'extends'));
  rows.classExport.push(flag(node, 'export'));
  const classRow = rows.classModule.length;
  for (const child of node.children ?? []) {
    if (child.type === 'field') {
      rows.fieldClass.push(classRow);
      rows.fieldName.push(propString(child, 'name'));
      continue;
    }
    if (child.type === 'constructor' || child.type === 'method' || child.type === 'getter') {
      rows.memberClass.push(classRow);
      rows.memberKind.push(child.type);
      rows.memberName.push(child.type === 'constructor' ? 'constructor' : propString(child, 'name'));
      rows.memberAsync.push(flag(child, 'async'));
      rows.memberStream.push(flag(child, 'stream'));
      rows.memberStatic.push(flag(child, 'static'));
      rows.memberHandlers.push(handlerCount(child));
    }
  }
}

function resolutionFor(fixture, importer, specifier) {
  return fixture.resolutions.find(
    (resolution) => resolution.importer === importer && resolution.specifier === specifier,
  );
}

function pushUse(rows, moduleId, modulePath, pathToId, fixture, node) {
  const rawPath = propString(node, 'path');
  const resolution = rawPath === '' ? undefined : resolutionFor(fixture, modulePath, rawPath);
  const candidate = resolution ? normalizePath(resolution.candidate) : '';
  const target = resolution?.target ? (pathToId.get(resolution.target) ?? 0) : 0;
  rows.useModule.push(moduleId);
  rows.usePath.push(rawPath);
  rows.useTarget.push(target);
  rows.useCandidate.push(candidate);
  const useRow = rows.useModule.length;
  for (const child of node.children ?? []) {
    if (child.type !== 'from') continue;
    rows.fromUse.push(useRow);
    rows.fromName.push(propString(child, 'name'));
    rows.fromAs.push(propString(child, 'as'));
    rows.fromKind.push(propString(child, 'kind'));
    rows.fromExport.push(flag(child, 'export'));
  }
}

function parseModule(module) {
  if (module.source === UNREADABLE_SOURCE || typeof module.source !== 'string') {
    return { status: 'unreadable', root: undefined, diagnostics: [] };
  }
  const parsed = parseDocumentWithDiagnostics(module.source);
  if (hasErrorDiagnostic(parsed.diagnostics)) {
    return { status: 'parse-error', root: undefined, diagnostics: parsed.diagnostics };
  }
  return { status: 'ok', root: parsed.root, diagnostics: parsed.diagnostics };
}

function permuteParallel(rows, keys, order) {
  const snapshots = Object.fromEntries(keys.map((key) => [key, rows[key].slice()]));
  for (const key of keys) {
    rows[key] = order.map((index) => snapshots[key][index]);
  }
}

function maybeShuffleRows(rows) {
  if (rows.useModule.length > 1) {
    const order = rows.useModule.map((_, index) => index).reverse();
    const oldToNew = new Map(order.map((oldIndex, newIndex) => [oldIndex + 1, newIndex + 1]));
    permuteParallel(rows, ['useModule', 'usePath', 'useTarget', 'useCandidate'], order);
    rows.fromUse = rows.fromUse.map((oldUse) => oldToNew.get(oldUse) ?? oldUse);
  }
  if (rows.fnModule.length > 1) {
    const order = rows.fnModule.map((_, index) => index).reverse();
    const oldToNew = new Map(order.map((oldIndex, newIndex) => [oldIndex + 1, newIndex + 1]));
    permuteParallel(
      rows,
      ['fnModule', 'fnName', 'fnReturns', 'fnAsync', 'fnStream', 'fnHandlers', 'fnParams', 'fnExport'],
      order,
    );
    rows.paramFn = rows.paramFn.map((oldFn) => oldToNew.get(oldFn) ?? oldFn);
  }
}

export function flattenFixture(fixture) {
  const rows = blankRows();
  rows.schemaVersion = fixture.schemaVersion ?? SCHEMA_VERSION;
  const pathToId = new Map();
  fixture.modules.forEach((module, index) => {
    pathToId.set(module.path, index + 1);
  });

  const parsedModules = fixture.modules.map((module, index) => {
    const parsed = parseModule(module);
    rows.moduleId.push(index + 1);
    rows.moduleRoot.push(normalizePath(module.root));
    rows.moduleStatus.push(parsed.status);
    return parsed;
  });

  fixture.modules.forEach((module, index) => {
    const parsed = parsedModules[index];
    if (parsed.status !== 'ok') return;
    const moduleId = index + 1;
    for (const node of topLevel(parsed.root)) {
      if (node.type === 'fn') pushFunction(rows, moduleId, node);
      else if (node.type === 'class') pushClass(rows, moduleId, node);
      else if (node.type === 'use') pushUse(rows, moduleId, module.path, pathToId, fixture, node);
    }
  });

  if (fixture.shuffleRows) maybeShuffleRows(rows);
  return rows;
}

export function flattenFixtures(fixtures) {
  return fixtures.map((fixture) => ({ fixture, rows: flattenFixture(fixture) }));
}
