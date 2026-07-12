#!/usr/bin/env node
import { readFileSync } from 'node:fs';

import { NODE_SCHEMAS } from '../packages/core/dist/schema.js';
import { NODE_TYPES } from '../packages/core/dist/spec.js';
import { validateStructuralConstitution } from './kir-structural/constitution.mjs';

const constitution = JSON.parse(readFileSync('scripts/kir-structural/constitution.json', 'utf8'));
const counts = validateStructuralConstitution(constitution, NODE_TYPES, NODE_SCHEMAS);
process.stdout.write(
  `Structural KIR constitution: PASS (ALPHA-NO-GO; ${counts.boundNodes}/${counts.sourceNodes} schema-bound nodes; ${counts.properties} property dispositions; ${counts.missingSchemas} explicit missing-schema exclusions; ${counts.nonCatalogSchemas} non-catalog schemas).\n`,
);
