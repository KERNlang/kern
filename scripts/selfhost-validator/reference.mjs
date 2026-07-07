import { isPortableBindingName } from '../../packages/core/dist/ir/semantics/portable-scalar.js';
import { parseDocumentWithDiagnostics } from '../../packages/core/dist/parser.js';
import { executeKernSource, resolveKernMainHandler } from '../../packages/core/dist/runner.js';
import { moduleLinkErrors, ownExplicitExportKinds } from '../../packages/core/dist/runner-module-link.js';
import { UNREADABLE_SOURCE } from './fixtures.mjs';
import { flattenFixture } from './flatten.mjs';

export const PRODUCTION_LINK_ERROR_PREFIX = moduleLinkErrors.importCycle('module').split(':')[0];

function fail(code, subject, rowId) {
  return `FAIL|${code}|${subject}#${rowId}`;
}

function localName(alias, imported) {
  return alias === '' ? imported : alias;
}

function rootPath(rows, module) {
  for (let i = 0; i < rows.moduleId.length; i += 1) {
    if (rows.moduleId[i] === module) return rows.moduleRoot[i];
  }
  return '';
}

function statusOf(rows, module) {
  for (let i = 0; i < rows.moduleId.length; i += 1) {
    if (rows.moduleId[i] === module) return rows.moduleStatus[i];
  }
  return 'missing';
}

function contained(root, candidate) {
  if (root === '') return false;
  return candidate === root || candidate.startsWith(`${root}/`);
}

function paramCount(rows, fnRow) {
  let count = 0;
  for (const owner of rows.paramFn) {
    if (owner === fnRow) count += 1;
  }
  return count;
}

function ownCallable(rows, module, name) {
  for (let i = 0; i < rows.fnModule.length; i += 1) {
    if (rows.fnModule[i] === module && rows.fnName[i] === name) return true;
  }
  for (let i = 0; i < rows.classModule.length; i += 1) {
    if (rows.classModule[i] === module && rows.className[i] === name) return true;
  }
  return false;
}

function ownExportKind(rows, module, name) {
  for (let i = 0; i < rows.fnModule.length; i += 1) {
    if (rows.fnModule[i] === module && rows.fnExport[i] === 1 && rows.fnName[i] === name) return 'fn';
  }
  for (let i = 0; i < rows.classModule.length; i += 1) {
    if (rows.classModule[i] === module && rows.classExport[i] === 1 && rows.className[i] === name) return 'class';
  }
  return '';
}

function containsId(ids, id) {
  return ids.includes(id);
}

function exportKind(rows, module, name, path = []) {
  if (containsId(path, module)) return 'CYCLE';
  const own = ownExportKind(rows, module, name);
  if (own !== '') return own;
  const nextPath = [...path, module];
  for (let i = 0; i < rows.fromUse.length; i += 1) {
    if (rows.fromExport[i] !== 1) continue;
    const local = localName(rows.fromAs[i], rows.fromName[i]);
    if (local !== name) continue;
    for (let u = 0; u < rows.useModule.length; u += 1) {
      if (u + 1 !== rows.fromUse[i]) continue;
      if (rows.useModule[u] !== module) continue;
      if (rows.useTarget[u] !== 0) return exportKind(rows, rows.useTarget[u], rows.fromName[i], nextPath);
    }
  }
  return 'MISSING';
}

function classRow(rows, module, name) {
  for (let i = 0; i < rows.classModule.length; i += 1) {
    if (rows.classModule[i] === module && rows.className[i] === name) return i + 1;
  }
  return 0;
}

function classCycleFrom(rows, row, path = []) {
  if (row === 0) return false;
  if (containsId(path, row)) return true;
  const ext = rows.classExtends[row - 1];
  if (ext === '') return false;
  const module = rows.classModule[row - 1];
  return classCycleFrom(rows, classRow(rows, module, ext), [...path, row]);
}

function hasImportCycleFrom(rows, module, path = []) {
  if (containsId(path, module)) return true;
  const nextPath = [...path, module];
  for (let i = 0; i < rows.useModule.length; i += 1) {
    if (rows.useModule[i] !== module) continue;
    if (rows.useTarget[i] !== 0 && hasImportCycleFrom(rows, rows.useTarget[i], nextPath)) return true;
  }
  return false;
}

export function validateRows(rows) {
  const failures = [];
  if (rows.schemaVersion !== 1) failures.push(fail('SCHEMA_VERSION', 'schema', rows.schemaVersion));

  for (let i = 0; i < rows.moduleId.length; i += 1) {
    if (rows.moduleStatus[i] === 'unreadable') failures.push(fail('MODULE_UNREADABLE', 'module', rows.moduleId[i]));
    if (rows.moduleStatus[i] === 'parse-error') failures.push(fail('MODULE_PARSE', 'module', rows.moduleId[i]));
  }

  let mainCount = 0;
  for (let i = 0; i < rows.fnModule.length; i += 1) {
    const fnRow = i + 1;
    if (rows.fnModule[i] === 1 && rows.fnName[i] === 'main') {
      mainCount += 1;
      if (rows.fnReturns[i] !== 'void') failures.push(fail('MAIN_RETURNS', 'main', fnRow));
      if (rows.fnParams[i] !== '') failures.push(fail('MAIN_PARAMS', 'main', fnRow));
      if (paramCount(rows, fnRow) !== 0) failures.push(fail('MAIN_PARAMS', 'main', fnRow));
      if (rows.fnAsync[i] === 1) failures.push(fail('MAIN_ASYNC', 'main', fnRow));
      if (rows.fnStream[i] === 1) failures.push(fail('MAIN_STREAM', 'main', fnRow));
      if (rows.fnHandlers[i] !== 1) failures.push(fail('MAIN_HANDLER', 'main', fnRow));
    }
    if (rows.fnModule[i] !== 1 && rows.fnName[i] === 'main') failures.push(fail('IMPORTED_MAIN', 'main', fnRow));
  }
  if (mainCount === 0) failures.push(fail('MAIN_MISSING', 'root', 0));
  if (mainCount > 1) failures.push(fail('MAIN_DUPLICATE', 'main', mainCount));

  for (let i = 0; i < rows.fnModule.length; i += 1) {
    const row = i + 1;
    for (let j = i + 1; j < rows.fnModule.length; j += 1) {
      if (rows.fnModule[i] === rows.fnModule[j] && rows.fnName[i] === rows.fnName[j]) {
        failures.push(fail('DUP_FN', rows.fnName[i], row));
      }
    }
    if (rows.fnName[i] !== 'main' && rows.fnParams[i] !== '' && paramCount(rows, row) !== 0) {
      failures.push(fail('PARAM_MIX', rows.fnName[i], row));
    }
  }

  for (let i = 0; i < rows.classModule.length; i += 1) {
    const row = i + 1;
    if (rows.className[i] === 'main') failures.push(fail('CLASS_MAIN', rows.className[i], row));
    for (let j = i + 1; j < rows.classModule.length; j += 1) {
      if (rows.classModule[i] === rows.classModule[j] && rows.className[i] === rows.className[j]) {
        failures.push(fail('DUP_CLASS', rows.className[i], row));
      }
    }
    if (rows.classExtends[i] !== '') {
      if (classRow(rows, rows.classModule[i], rows.classExtends[i]) === 0) {
        failures.push(fail('CLASS_EXTENDS_UNKNOWN', rows.className[i], row));
      }
      if (classCycleFrom(rows, row)) failures.push(fail('CLASS_CYCLE', rows.className[i], row));
    }
  }

  for (let i = 0; i < rows.fnModule.length; i += 1) {
    for (let j = 0; j < rows.classModule.length; j += 1) {
      if (rows.fnModule[i] === rows.classModule[j] && rows.fnName[i] === rows.className[j]) {
        failures.push(fail('CALLABLE_CONFLICT', rows.fnName[i], i + 1));
      }
    }
  }

  for (let i = 0; i < rows.fieldClass.length; i += 1) {
    for (let j = i + 1; j < rows.fieldClass.length; j += 1) {
      if (rows.fieldClass[i] === rows.fieldClass[j] && rows.fieldName[i] === rows.fieldName[j]) {
        failures.push(fail('DUP_FIELD', rows.fieldName[i], i + 1));
      }
    }
  }

  for (let i = 0; i < rows.memberClass.length; i += 1) {
    if (rows.memberAsync[i] === 1 || rows.memberStream[i] === 1 || rows.memberStatic[i] === 1) {
      failures.push(fail('MEMBER_UNSUPPORTED', rows.memberName[i], i + 1));
    }
    if (rows.memberHandlers[i] !== 1) failures.push(fail('MEMBER_HANDLER', rows.memberName[i], i + 1));
    for (let j = i + 1; j < rows.memberClass.length; j += 1) {
      if (
        rows.memberClass[i] === rows.memberClass[j] &&
        rows.memberKind[i] === rows.memberKind[j] &&
        rows.memberName[i] === rows.memberName[j]
      ) {
        failures.push(fail('DUP_MEMBER', rows.memberName[i], i + 1));
      }
    }
  }

  for (let i = 0; i < rows.paramFn.length; i += 1) {
    if (!isPortableBindingName(rows.paramName[i])) failures.push(fail('PARAM_NAME', rows.paramName[i], i + 1));
    if (
      rows.paramHasChildren[i] === 1 ||
      rows.paramHasValue[i] === 1 ||
      rows.paramHasDefault[i] === 1 ||
      rows.paramOptional[i] === 1 ||
      rows.paramVariadic[i] === 1
    ) {
      failures.push(fail('PARAM_UNSUPPORTED', rows.paramName[i], i + 1));
    }
    for (let j = i + 1; j < rows.paramFn.length; j += 1) {
      if (rows.paramFn[i] === rows.paramFn[j] && rows.paramName[i] === rows.paramName[j]) {
        failures.push(fail('DUP_PARAM', rows.paramName[i], i + 1));
      }
    }
  }

  for (let i = 0; i < rows.useModule.length; i += 1) {
    const useRow = i + 1;
    if (rows.usePath[i] === '') failures.push(fail('USE_MISSING_PATH', String(rows.useModule[i]), useRow));
    const root = rootPath(rows, rows.useModule[i]);
    if (rows.useCandidate[i] !== '' && !contained(root, rows.useCandidate[i])) {
      failures.push(fail('IMPORT_ESCAPES_ROOT', rows.usePath[i], useRow));
    }
    if (
      rows.usePath[i] !== '' &&
      rows.useTarget[i] === 0 &&
      (rows.useCandidate[i] === '' || contained(root, rows.useCandidate[i]))
    ) {
      failures.push(fail('CANNOT_RESOLVE', rows.usePath[i], useRow));
    }
  }

  for (let i = 0; i < rows.moduleId.length; i += 1) {
    if (rows.moduleStatus[i] === 'ok' && hasImportCycleFrom(rows, rows.moduleId[i])) {
      failures.push(fail('IMPORT_CYCLE', String(rows.moduleId[i]), rows.moduleId[i]));
    }
  }

  for (let i = 0; i < rows.fromUse.length; i += 1) {
    const fromRow = i + 1;
    const local = localName(rows.fromAs[i], rows.fromName[i]);
    if (!isPortableBindingName(rows.fromName[i])) failures.push(fail('FROM_NAME', rows.fromName[i], fromRow));
    if (!isPortableBindingName(local)) failures.push(fail('ALIAS_NAME', local, fromRow));
    let matchedUse = false;
    for (let u = 0; u < rows.useModule.length; u += 1) {
      if (u + 1 !== rows.fromUse[i]) continue;
      matchedUse = true;
      const module = rows.useModule[u];
      const target = rows.useTarget[u];
      for (let j = i + 1; j < rows.fromUse.length; j += 1) {
        const otherLocal = localName(rows.fromAs[j], rows.fromName[j]);
        for (let ou = 0; ou < rows.useModule.length; ou += 1) {
          if (ou + 1 === rows.fromUse[j] && rows.useModule[ou] === module && otherLocal === local) {
            failures.push(fail('DUP_ALIAS', local, fromRow));
          }
        }
      }
      if (ownCallable(rows, module, local)) failures.push(fail('ALIAS_CONFLICT', local, fromRow));
      if (target !== 0 && statusOf(rows, target) === 'ok') {
        const kind = exportKind(rows, target, rows.fromName[i]);
        if (kind === 'MISSING') failures.push(fail('DOES_NOT_EXPORT', rows.fromName[i], fromRow));
        if (kind !== 'MISSING' && kind !== 'CYCLE' && rows.fromKind[i] !== '' && rows.fromKind[i] !== kind) {
          failures.push(fail('KIND_MISMATCH', rows.fromName[i], fromRow));
        }
      }
      if (rows.fromExport[i] === 1) {
        if (ownExportKind(rows, module, local) !== '') failures.push(fail('DUP_EXPORT', local, fromRow));
        for (let k = 0; k < i; k += 1) {
          if (rows.fromExport[k] !== 1 || localName(rows.fromAs[k], rows.fromName[k]) !== local) continue;
          for (let pu = 0; pu < rows.useModule.length; pu += 1) {
            if (pu + 1 === rows.fromUse[k] && rows.useModule[pu] === module) {
              failures.push(fail('DUP_EXPORT', local, fromRow));
            }
          }
        }
      }
    }
    if (!matchedUse) failures.push(fail('FROM_USE_MISSING', String(rows.fromUse[i]), fromRow));
  }

  return failures.length === 0 ? ['PASS'] : failures.sort();
}

function parseOkSource(source) {
  const parsed = parseDocumentWithDiagnostics(source);
  if (parsed.diagnostics.some((diagnostic) => diagnostic.severity === 'error')) return undefined;
  return parsed.root;
}

export function productionHelperSnapshot(fixture) {
  const snapshots = [];
  for (const module of fixture.modules) {
    if (module.source === UNREADABLE_SOURCE || typeof module.source !== 'string') continue;
    const root = parseOkSource(module.source);
    if (!root) continue;
    snapshots.push({
      path: module.path,
      ownExports: [...ownExplicitExportKinds(root).entries()].map(([name, record]) => `${name}:${record.kind}`).sort(),
      rootEntryOk:
        module === fixture.modules[0]
          ? (() => {
              try {
                resolveKernMainHandler(root);
                return true;
              } catch {
                return false;
              }
            })()
          : undefined,
    });
  }
  return snapshots;
}

export function productionFirstError(fixture) {
  const rootModule = fixture.modules[0];
  if (typeof rootModule.source !== 'string' || rootModule.source === UNREADABLE_SOURCE) {
    return 'root source unavailable';
  }
  const moduleByPath = new Map(fixture.modules.map((module) => [module.path, module]));
  try {
    executeKernSource(rootModule.source, {
      sourcePath: rootModule.path,
      moduleLoader: {
        resolve(specifier, context) {
          const resolution = fixture.resolutions.find(
            (candidate) => candidate.importer === context.importer && candidate.specifier === specifier,
          );
          return resolution?.target ?? null;
        },
        readSource(path) {
          const module = moduleByPath.get(path);
          if (!module || module.source === UNREADABLE_SOURCE) return null;
          return module.source;
        },
      },
    });
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

export function expectedLinesForFixture(fixture) {
  const rows = flattenFixture(fixture);
  return validateRows(rows).map((verdict) => `${fixture.id}|${verdict}`);
}

export function expectedLines(fixtures) {
  return fixtures.flatMap((fixture) => expectedLinesForFixture(fixture));
}
