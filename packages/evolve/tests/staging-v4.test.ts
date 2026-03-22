import { existsSync, mkdirSync, rmSync, readdirSync } from 'fs';
import { resolve, join } from 'path';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import {
  stageEvolveV4Proposal,
  listStagedEvolveV4,
  getStagedEvolveV4,
  updateStagedEvolveV4Status,
  cleanRejectedEvolveV4,
  cleanApprovedEvolveV4,
  formatEvolveV4SplitView,
} from '../src/staging.js';
import type { EvolveNodeProposal, EvolveV4ValidationResult } from '../src/evolved-types.js';

let tmpDir: string;
let originalCwd: () => string;

function makeProposal(overrides: Partial<EvolveNodeProposal> = {}): EvolveNodeProposal {
  return {
    id: 'v4-test-1',
    keyword: 'api-route',
    displayName: 'API Route',
    description: 'Declarative REST route handler',
    props: [
      { name: 'method', type: 'string', required: true, description: 'HTTP method' },
      { name: 'path', type: 'string', required: true, description: 'Route path' },
    ],
    childTypes: ['middleware', 'handler'],
    kernExample: 'api-route GET /users\n  handler <<<\n    return db.users.findAll()\n  >>>',
    expectedOutput: 'router.get("/users", async (req, res) => {\n  return db.users.findAll();\n});',
    codegenSource: 'module.exports = function(node, h) { return []; };',
    reason: {
      observation: 'REST routes repeat method+path+handler pattern',
      inefficiency: '15 lines of Express boilerplate per route',
      kernBenefit: '3 lines of declarative KERN',
      frequency: 12,
      avgLines: 15,
      instances: ['routes/users.ts', 'routes/posts.ts'],
    },
    codegenTier: 1,
    proposedAt: new Date().toISOString(),
    evolveRunId: 'test-run-v4',
    ...overrides,
  };
}

function makeValidation(overrides: Partial<EvolveV4ValidationResult> = {}): EvolveV4ValidationResult {
  return {
    schemaOk: true,
    keywordOk: true,
    parseOk: true,
    codegenCompileOk: true,
    codegenRunOk: true,
    typescriptOk: true,
    goldenDiffOk: true,
    dedupOk: true,
    errors: [],
    retryCount: 0,
    ...overrides,
  };
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'kern-staging-v4-'));
  originalCwd = process.cwd;
  process.cwd = () => tmpDir;
});

afterEach(() => {
  process.cwd = originalCwd;
  if (existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true });
  }
});

describe('stageEvolveV4Proposal', () => {
  it('stages a proposal and writes JSON to disk', () => {
    const proposal = makeProposal();
    const validation = makeValidation();

    const staged = stageEvolveV4Proposal(proposal, validation);

    expect(staged.id).toBe('v4-test-1');
    expect(staged.proposal).toEqual(proposal);
    expect(staged.validation).toEqual(validation);
    expect(staged.status).toBe('pending');
    expect(staged.stagedAt).toBeDefined();
    expect(staged.reviewedAt).toBeUndefined();

    const filePath = resolve(tmpDir, '.kern/evolve/staged-v4', `${staged.id}.json`);
    expect(existsSync(filePath)).toBe(true);
  });

  it('returns a valid StagedEvolveProposal', () => {
    const staged = stageEvolveV4Proposal(makeProposal(), makeValidation());

    expect(typeof staged.id).toBe('string');
    expect(typeof staged.stagedAt).toBe('string');
    expect(staged.status).toBe('pending');
  });

  it('generates an ID from keyword when proposal has no id', () => {
    const proposal = makeProposal({ id: '' });
    const staged = stageEvolveV4Proposal(proposal, makeValidation());

    // Empty string is falsy, so it should fallback to keyword-timestamp
    expect(staged.id).toMatch(/^api-route-\d+$/);
  });
});

describe('listStagedEvolveV4', () => {
  it('returns empty array when no proposals exist', () => {
    const result = listStagedEvolveV4();
    expect(result).toEqual([]);
  });

  it('returns empty array when staging dir does not exist', () => {
    // tmpDir is clean, no .kern directory created yet
    const result = listStagedEvolveV4();
    expect(result).toEqual([]);
  });

  it('returns staged proposals sorted by frequency (descending)', () => {
    stageEvolveV4Proposal(
      makeProposal({ id: 'low-freq', keyword: 'low', reason: { observation: 'x', inefficiency: 'x', kernBenefit: 'x', frequency: 3, avgLines: 5, instances: [] } }),
      makeValidation(),
    );
    stageEvolveV4Proposal(
      makeProposal({ id: 'high-freq', keyword: 'high', reason: { observation: 'x', inefficiency: 'x', kernBenefit: 'x', frequency: 20, avgLines: 5, instances: [] } }),
      makeValidation(),
    );
    stageEvolveV4Proposal(
      makeProposal({ id: 'mid-freq', keyword: 'mid', reason: { observation: 'x', inefficiency: 'x', kernBenefit: 'x', frequency: 10, avgLines: 5, instances: [] } }),
      makeValidation(),
    );

    const result = listStagedEvolveV4();

    expect(result).toHaveLength(3);
    expect(result[0].id).toBe('high-freq');
    expect(result[1].id).toBe('mid-freq');
    expect(result[2].id).toBe('low-freq');
  });
});

describe('getStagedEvolveV4', () => {
  it('finds a staged proposal by ID', () => {
    const proposal = makeProposal({ id: 'find-me' });
    stageEvolveV4Proposal(proposal, makeValidation());

    const found = getStagedEvolveV4('find-me');

    expect(found).toBeDefined();
    expect(found!.id).toBe('find-me');
    expect(found!.proposal.keyword).toBe('api-route');
  });

  it('returns undefined for a missing ID', () => {
    const result = getStagedEvolveV4('does-not-exist');
    expect(result).toBeUndefined();
  });

  it('returns undefined when staging dir does not exist', () => {
    const result = getStagedEvolveV4('anything');
    expect(result).toBeUndefined();
  });
});

describe('updateStagedEvolveV4Status', () => {
  it('updates status to approved and sets reviewedAt', () => {
    stageEvolveV4Proposal(makeProposal({ id: 'approve-me' }), makeValidation());

    const updated = updateStagedEvolveV4Status('approve-me', 'approved');

    expect(updated).toBeDefined();
    expect(updated!.status).toBe('approved');
    expect(updated!.reviewedAt).toBeDefined();
    expect(typeof updated!.reviewedAt).toBe('string');
  });

  it('updates status to rejected and sets reviewedAt', () => {
    stageEvolveV4Proposal(makeProposal({ id: 'reject-me' }), makeValidation());

    const updated = updateStagedEvolveV4Status('reject-me', 'rejected');

    expect(updated).toBeDefined();
    expect(updated!.status).toBe('rejected');
    expect(updated!.reviewedAt).toBeDefined();
  });

  it('persists the status change to disk', () => {
    stageEvolveV4Proposal(makeProposal({ id: 'persist-check' }), makeValidation());
    updateStagedEvolveV4Status('persist-check', 'approved');

    // Re-read from disk
    const reloaded = getStagedEvolveV4('persist-check');
    expect(reloaded!.status).toBe('approved');
    expect(reloaded!.reviewedAt).toBeDefined();
  });

  it('returns undefined for a non-existent ID', () => {
    const result = updateStagedEvolveV4Status('ghost', 'approved');
    expect(result).toBeUndefined();
  });
});

describe('cleanRejectedEvolveV4', () => {
  it('removes rejected proposals from disk', () => {
    stageEvolveV4Proposal(makeProposal({ id: 'keep-pending' }), makeValidation());
    stageEvolveV4Proposal(makeProposal({ id: 'keep-approved' }), makeValidation());
    stageEvolveV4Proposal(makeProposal({ id: 'remove-1' }), makeValidation());
    stageEvolveV4Proposal(makeProposal({ id: 'remove-2' }), makeValidation());

    updateStagedEvolveV4Status('keep-approved', 'approved');
    updateStagedEvolveV4Status('remove-1', 'rejected');
    updateStagedEvolveV4Status('remove-2', 'rejected');

    const cleaned = cleanRejectedEvolveV4();

    expect(cleaned).toBe(2);
    expect(getStagedEvolveV4('remove-1')).toBeUndefined();
    expect(getStagedEvolveV4('remove-2')).toBeUndefined();
    expect(getStagedEvolveV4('keep-pending')).toBeDefined();
    expect(getStagedEvolveV4('keep-approved')).toBeDefined();
  });

  it('returns 0 when no rejected proposals exist', () => {
    stageEvolveV4Proposal(makeProposal({ id: 'all-good' }), makeValidation());
    const cleaned = cleanRejectedEvolveV4();
    expect(cleaned).toBe(0);
  });

  it('returns 0 when staging dir does not exist', () => {
    const cleaned = cleanRejectedEvolveV4();
    expect(cleaned).toBe(0);
  });
});

describe('cleanApprovedEvolveV4', () => {
  it('removes a single approved proposal from disk', () => {
    stageEvolveV4Proposal(makeProposal({ id: 'graduated' }), makeValidation());
    updateStagedEvolveV4Status('graduated', 'approved');

    const removed = cleanApprovedEvolveV4('graduated');

    expect(removed).toBe(true);
    expect(getStagedEvolveV4('graduated')).toBeUndefined();
  });

  it('returns false for a non-existent ID', () => {
    const removed = cleanApprovedEvolveV4('nonexistent');
    expect(removed).toBe(false);
  });

  it('does not affect other staged proposals', () => {
    stageEvolveV4Proposal(makeProposal({ id: 'to-remove' }), makeValidation());
    stageEvolveV4Proposal(makeProposal({ id: 'to-keep' }), makeValidation());

    cleanApprovedEvolveV4('to-remove');

    expect(getStagedEvolveV4('to-keep')).toBeDefined();
    expect(getStagedEvolveV4('to-remove')).toBeUndefined();
  });
});

describe('formatEvolveV4SplitView', () => {
  it('produces a non-empty string', () => {
    const staged = stageEvolveV4Proposal(makeProposal(), makeValidation());
    const output = formatEvolveV4SplitView(staged);

    expect(typeof output).toBe('string');
    expect(output.length).toBeGreaterThan(0);
  });

  it('contains the proposal keyword', () => {
    const staged = stageEvolveV4Proposal(makeProposal({ keyword: 'cache-layer' }), makeValidation());
    const output = formatEvolveV4SplitView(staged);

    expect(output).toContain('cache-layer');
  });

  it('shows validation badges', () => {
    const staged = stageEvolveV4Proposal(
      makeProposal(),
      makeValidation({ schemaOk: true, parseOk: false, dedupOk: true }),
    );
    const output = formatEvolveV4SplitView(staged);

    expect(output).toContain('\u2713 Schema');
    expect(output).toContain('\u2717 Parse');
    expect(output).toContain('\u2713 Dedup');
  });

  it('includes approve and reject action hints', () => {
    const staged = stageEvolveV4Proposal(makeProposal({ id: 'action-test' }), makeValidation());
    const output = formatEvolveV4SplitView(staged);

    expect(output).toContain('[a]pprove');
    expect(output).toContain('[r]eject');
    expect(output).toContain('action-test');
  });

  it('includes reason fields', () => {
    const staged = stageEvolveV4Proposal(makeProposal(), makeValidation());
    const output = formatEvolveV4SplitView(staged);

    expect(output).toContain('REASON');
    expect(output).toContain('Observation');
    expect(output).toContain('Inefficiency');
    expect(output).toContain('Benefit');
  });
});
