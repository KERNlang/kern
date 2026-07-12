#!/usr/bin/env node
import { readFileSync } from 'node:fs';

import { validateSemanticOwnership } from './semantic-ownership/validate.mjs';

const policy = JSON.parse(readFileSync('scripts/semantic-ownership/policy.json', 'utf8'));
validateSemanticOwnership(policy);

process.stdout.write(
  'Semantic ownership proof: PASS (BOOTSTRAP-DEPENDENT; no runtime cutover, KIR v1 freeze, public reader export, or semantic self-hosting).\n',
);
