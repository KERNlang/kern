#!/usr/bin/env node
import { writeFileSync } from 'node:fs';

import { NODE_SCHEMAS } from '../../packages/core/dist/schema.js';
import { NODE_TYPES } from '../../packages/core/dist/spec.js';
import { buildStructuralConstitution } from './constitution.mjs';

const outputPath = 'scripts/kir-structural/constitution.json';
const constitution = buildStructuralConstitution(NODE_TYPES, NODE_SCHEMAS);
writeFileSync(outputPath, `${JSON.stringify(constitution, null, 2)}\n`, 'utf8');
process.stdout.write(`Wrote ${constitution.counts.sourceNodes} nodes and ${constitution.counts.properties} properties to ${outputPath}.\n`);
