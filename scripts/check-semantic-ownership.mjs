#!/usr/bin/env node
import { readFileSync } from 'node:fs';

import { validateSemanticOwnership } from './semantic-ownership/validate.mjs';

const policy = JSON.parse(readFileSync('scripts/semantic-ownership/policy.json', 'utf8'));
validateSemanticOwnership(policy);

process.stdout.write(
  'Semantic ownership proof: PASS (BOOTSTRAP-DEPENDENT; internal KIR v1 frozen; no runtime cutover, public reader export, or semantic self-hosting).\n',
);
