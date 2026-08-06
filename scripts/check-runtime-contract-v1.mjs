import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { assertPublicRuntimeHandlerDeclaration } from "./runtime-handler-public-declaration.mjs";
import {
  assertPublicHandlerBuiltAbiClosure,
  assertPublicHandlerAbiClosure,
} from "./runtime-envelope-import-closure.mjs";
import { validateRuntimeContractV1Authority } from "./runtime-contract-v1/validate-runtime-contract-v1-authority.mjs";
import { validateRuntimeContractV1ProofFloor } from "./runtime-contract-v1/validate-runtime-contract-v1-proof-floor.mjs";

const floor = validateRuntimeContractV1ProofFloor();
const evidence = validateRuntimeContractV1Authority();
const declaration = readFileSync(
  "packages/core/dist/runtime-handler.d.ts",
  "utf8",
);
const declarationEvidence = assertPublicRuntimeHandlerDeclaration(declaration);
const sourceClosure = assertPublicHandlerAbiClosure(
  resolve("packages/core/src"),
);
const builtClosure = assertPublicHandlerBuiltAbiClosure(
  resolve("packages/core/dist"),
);

process.stdout.write(
  `runtime contract v1: PASS (anchor ${evidence.introductionCommit}; ${floor.behaviorCount} literal goldens; ` +
    `${declarationEvidence.symbols.length} public symbols; ${sourceClosure.size} source modules; ` +
    `${builtClosure.size} built modules; frozen=true; contract-local-KIR-v1-claim=false)\n`,
);
