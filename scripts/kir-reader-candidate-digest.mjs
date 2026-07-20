import { createHash } from 'node:crypto';

import { encodeKirReaderCandidate } from '../packages/core/dist/kir-reader-candidate/canonical.js';
import { hostileModules } from './kir-seam-probe/fixtures.mjs';
import { projectModules } from './kir-seam-probe/project.mjs';

const bytes = encodeKirReaderCandidate(projectModules(hostileModules));
process.stdout.write(`${createHash('sha256').update(bytes).digest('hex')}\n`);
