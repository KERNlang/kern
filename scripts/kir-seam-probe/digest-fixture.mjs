import { createHash } from 'node:crypto';

import { encodeCanonical } from './canonical.mjs';
import { hostileModules } from './fixtures.mjs';
import { projectModules } from './project.mjs';

process.stdout.write(createHash('sha256').update(encodeCanonical(projectModules(hostileModules))).digest('hex'));
