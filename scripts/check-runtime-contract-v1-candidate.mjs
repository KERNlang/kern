import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { assertPublicRuntimeHandlerDeclaration } from './runtime-handler-public-declaration.mjs';
import {
  assertPublicHandlerAbiClosure,
  runtimeJavaScriptImportClosure,
} from './runtime-envelope-import-closure.mjs';
import { validateRuntimeContractV1 } from './runtime-contract-v1/validate-runtime-contract-v1.mjs';

const evidence = validateRuntimeContractV1();
const corePackage = JSON.parse(readFileSync('packages/core/package.json', 'utf8'));
const handlerExport = corePackage.exports?.['./runtime/handler'];
if (
  handlerExport?.types !== './dist/runtime-handler.d.ts' ||
  handlerExport?.default !== './dist/runtime-handler.js'
) {
  throw new Error('runtime contract v1: public package entry drifted');
}

const declaration = readFileSync('packages/core/dist/runtime-handler.d.ts', 'utf8');
const declarationEvidence = assertPublicRuntimeHandlerDeclaration(declaration);
const sourceClosure = assertPublicHandlerAbiClosure(resolve('packages/core/src'));
const builtClosure = runtimeJavaScriptImportClosure(
  [resolve('packages/core/dist/runtime-handler.js')],
  undefined,
  new Set(['decimal.js']),
  false,
);

process.stdout.write(
  `runtime contract v1 candidate: PASS (${evidence.caseCount} literal goldens; ` +
    `${declarationEvidence.symbols.length} public symbols; ${sourceClosure.size} source modules; ` +
    `${builtClosure.size} built modules; promotion=false)\n`,
);
