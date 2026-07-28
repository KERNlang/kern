import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatCurrentResidualAnalysisStatus,
  formatCoverageWinnerStatus,
  formatHistoricalResidualAnalysisStatus,
  formatM442ResidualAnalysisStatus,
  formatM443ResidualAnalysisStatus,
  formatM446ResidualAnalysisStatus,
  formatM447NodeRowHeadroomStatus,
  formatM450ResidualAnalysisStatus,
  formatM451PropertyRowHeadroomStatus,
  formatM453ParameterMigrationStatus,
  formatM454ResidualAnalysisStatus,
  formatM455DualRowHeadroomStatus,
  formatM457ParameterMigrationStatus,
  formatM458WhilePrerequisiteStatus,
  formatM461ParameterMigrationStatus,
  formatM462ResidualAnalysisStatus,
  formatM463NodeRowHeadroomStatus,
  formatM465ParameterMigrationStatus,
  formatM466ResidualAnalysisStatus,
  formatM467NodeRowHeadroomStatus,
  formatM470ResidualAnalysisStatus,
  formatM471DualRowHeadroomStatus,
  formatM474ResidualAnalysisStatus,
  formatM475DualRowHeadroomStatus,
  formatM478ResidualAnalysisStatus,
  formatM479PropertyRowHeadroomStatus,
  formatM480RuntimeCostStatus,
  formatM481PropertyRowPromotionStatus,
  formatM482ParameterMigrationStatus,
  formatM483ResidualAnalysisStatus,
  formatM484ValueRowHeadroomStatus,
  formatM485ValueRowPromotionStatus,
  formatM486ParameterMigrationStatus,
  formatM487ResidualAnalysisStatus,
  formatM488DualRowHeadroomStatus,
  formatM489RuntimeCostStatus,
  formatM490DualRowPromotionStatus,
  formatM491ParameterMigrationStatus,
  formatM492ResidualAnalysisStatus,
  formatM493RuntimeCostStatus,
  formatM494ParameterMigrationStatus,
  formatM495ResidualAnalysisStatus,
  formatM496RuntimeBottleneckStatus,
  formatM497RuntimeCostStatus,
  formatM498RuntimeCostStatus,
  formatM499DualRowPromotionStatus,
  formatM4100ParameterMigrationStatus,
  formatM4101ResidualAnalysisStatus,
  formatM4102TripleRowHeadroomStatus,
  formatM4103RuntimeBottleneckStatus,
  formatM4104RuntimeCostStatus,
  formatM4105RuntimeBottleneckStatus,
  formatM4106RuntimeCostStatus,
  formatM4107TripleRowPromotionStatus,
  formatM4109ResidualAnalysisStatus,
  formatM4110ProjectionAnalysisStatus,
  formatM4111KirDepthHeadroomStatus,
  formatM4112KirDepthPromotionStatus,
  formatM4113ParameterMigrationStatus,
  formatPublishedResidualAnalysisStatus,
} from './coverage-status.mjs';

test('coverage status formats current and historical release decisions', () => {
  assert.equal(formatCoverageWinnerStatus(null), 'no tranche selected');
  assert.equal(formatCoverageWinnerStatus({ id: 'binary-expression' }), 'binary-expression tranche selected');
  assert.equal(
    formatHistoricalResidualAnalysisStatus(null),
    'M4.31 historical analysis found no actionable profile widening.',
  );
  assert.equal(
    formatHistoricalResidualAnalysisStatus({
      changedLimits: ['maxValueRows'],
      completeFunctions: 12,
    }),
    'M4.31 historical analysis selected 12 functions by maxValueRows widening.',
  );
  assert.equal(
    formatCurrentResidualAnalysisStatus(null),
    'Current residual analysis found no actionable profile widening.',
  );
  assert.equal(
    formatCurrentResidualAnalysisStatus({
      changedLimits: ['maxValueRows'],
      completeFunctions: 11,
    }),
    'Current residual analysis selected 11 functions by maxValueRows widening.',
  );
  assert.equal(
    formatM442ResidualAnalysisStatus(null),
    'M4.42 published analysis found no actionable profile widening.',
  );
  assert.equal(
    formatM442ResidualAnalysisStatus({
      changedLimits: ['maxValueRows'],
      completeFunctions: 2,
    }),
    'M4.42 published analysis selected 2 functions by maxValueRows widening.',
  );
});

test('coverage status records the M4.46 published recommendation and M4.47 headroom', () => {
  assert.equal(
    formatM446ResidualAnalysisStatus(null),
    'M4.46 published analysis found no actionable profile widening.',
  );
  assert.equal(
    formatM446ResidualAnalysisStatus({
      completeFunctions: 4,
      changedLimits: ['maxNodeRows'],
    }),
    'M4.46 published analysis selected 4 functions by maxNodeRows widening; M4.47 authenticates structural runtime headroom.',
  );
  assert.equal(
    formatM447NodeRowHeadroomStatus({ summary: { maxExactFloor: 15_236, witnessCount: 4 } }),
    'M4.47 structural headroom authenticated 4 witnesses at a 15236 maximum floor; M4.48 authenticates the node-row profile promotion.',
  );
});

test('coverage status records the M4.43 optimized promotion handoff', () => {
  assert.equal(
    formatM443ResidualAnalysisStatus({
      completeFunctions: 2,
      changedLimits: ['maxValueRows'],
    }),
    'M4.43 published analysis selected 2 functions by maxValueRows widening; M4.44 authenticates the profile promotion.',
  );
});

test('coverage status records the M4.92 residual recommendation', () => {
  assert.equal(
    formatM492ResidualAnalysisStatus(null),
    'M4.92 published analysis found no actionable profile widening.',
  );
  assert.equal(
    formatM492ResidualAnalysisStatus({
      completeFunctions: 1,
      changedLimits: ['maxPropertyRows', 'maxValueRows'],
    }),
    'M4.92 published analysis selected 1 function by maxPropertyRows+maxValueRows widening; M4.93 authenticates structural runtime headroom.',
  );
});

test('coverage status records the M4.93 table-validation reduction boundary', () => {
  assert.equal(
    formatM493RuntimeCostStatus({
      baseline: { attemptedLoopEntries: 30_261, measurementBudget: 1_000 },
      result: { exactFloor: 1_075 },
      promotion: {
        parameterMigration: { completeFunctions: 1, migratedParameterRows: 12 },
      },
      witness: {
        id: 'examples/capstone-checker-subset/checker-while.kern#15:comparisonOperandsOk',
      },
    }),
    'M4.93 reduces examples/capstone-checker-subset/checker-while.kern#15:comparisonOperandsOk ' +
      'table validation from 30261 attempted loop entries at budget 1000 to exact floor 1075; ' +
      'publishes the exact 1-function/12-row parameter queue; production headroom remains unproven.',
  );
});

test('coverage status records the M4.94 tablesok parameter migration', () => {
  assert.equal(
    formatM494ParameterMigrationStatus({
      promotion: {
        parameterMigration: { completeFunctions: 1, migratedParameterRows: 12 },
      },
    }),
    'M4.94 consumes the exact M4.93 1-function/12-row parameter queue and advances the cumulative ' +
      'base to 89/109; M4.95 remeasures the bounded residual frontier.',
  );
});

test('coverage status records the M4.95 structural recommendation without claiming headroom', () => {
  assert.equal(
    formatM495ResidualAnalysisStatus({
      completeFunctions: 1,
      changedLimits: ['maxPropertyRows', 'maxValueRows'],
    }),
    'M4.95 published analysis selected 1 function by maxPropertyRows+maxValueRows widening; ' +
      'M4.96 investigates the remaining runtime bottleneck before any profile promotion.',
  );
});

test('coverage status records the M4.96 bounded runtime-bottleneck diagnosis', () => {
  assert.equal(
    formatM496RuntimeBottleneckStatus({
      diagnosis: {
        additionalExpressionsourcesExecutions: 91,
        additionalRetainedIterations: 500,
        additionalRolledBackIterations: 78_379,
      },
    }),
    'M4.96 attributes 78379 rolled-back loop entries and 91 additional expressionsources executions ' +
      'across 500 retained iterations; M4.97 evaluates removal of parent-frame replay before any ' +
      'headroom measurement.',
  );
});

test('coverage status records the M4.97 resumable-frame reduction and promotion NO-GO', () => {
  assert.equal(
    formatM497RuntimeCostStatus({
      result: {
        exactFloor: 53_086,
        productionHeadroom: 12_450,
        promotionBudgetDeficit: 3_934,
      },
    }),
    'M4.97 removes parent-frame replay and authenticates exact floor 53086 with 12450 production ' +
      'headroom, but misses the promotion budget by 3934; M4.98 reduces the remaining runtime cost.',
  );
});

test('coverage status records the M4.98 property-row reduction and promotion headroom', () => {
  assert.equal(
    formatM498RuntimeCostStatus({
      result: {
        exactFloor: 46_381,
        floorReduction: 6_705,
        promotionBudgetHeadroom: 2_771,
      },
    }),
    'M4.98 authenticates property-row ordering and reduces the exact floor by 6705 to 46381, ' +
      'leaving 2771 promotion-budget headroom; M4.99 authenticates the profile promotion.',
  );
});

test('coverage status records the M4.99 property and value row promotion', () => {
  assert.equal(
    formatM499DualRowPromotionStatus({
      parameterMigration: { completeFunctions: 1, migratedParameterRows: 24 },
      profileLimits: { maxNodeRows: 74, maxPropertyRows: 95, maxValueRows: 832 },
    }),
    'M4.99 promotes maxPropertyRows/maxValueRows to 95/832 and publishes the exact ' +
      '1-function/24-row parameter queue; M4.100 consumes it.',
  );
});

test('coverage status records M4.100 consumption of the immutable M4.99 queue', () => {
  assert.equal(
    formatM4100ParameterMigrationStatus({
      parameterMigration: { completeFunctions: 1, migratedParameterRows: 24 },
    }),
    'M4.100 consumes the exact M4.99 1-function/24-row parameter queue and advances the ' +
      'cumulative base to 90/109; M4.101 remeasures the bounded residual frontier.',
  );
});

test('coverage status records the M4.101 structural recommendation', () => {
  assert.equal(
    formatM4101ResidualAnalysisStatus({
      completeFunctions: 1,
      changedLimits: ['maxNodeRows', 'maxPropertyRows', 'maxValueRows'],
    }),
    'M4.101 published analysis selected 1 function by ' +
      'maxNodeRows+maxPropertyRows+maxValueRows widening; ' +
      'M4.102 authenticates structural runtime headroom.',
  );
});

test('coverage status records the M4.109 terminal profile frontier', () => {
  assert.equal(
    formatM4109ResidualAnalysisStatus(null),
    'M4.109 published analysis found no actionable profile widening; ' +
      'M4.110 investigates the authenticated projection blockers.',
  );
  assert.equal(
    formatM4109ResidualAnalysisStatus({
      completeFunctions: 1,
      changedLimits: ['maxNodeRows'],
    }),
    'M4.109 published analysis selected 1 function by maxNodeRows widening.',
  );
});

test('coverage status records the M4.110 projection recommendation', () => {
  assert.equal(
    formatM4110ProjectionAnalysisStatus({
      completeFunctions: 9,
      completeTools: 4,
      kirLimits: { maxDepth: 76 },
      migratedParameterRows: 134,
    }),
    'M4.110 projection analysis selects maxDepth 76 for 9 functions/134 rows across 4 tools; ' +
      'M4.111 authenticates structural KIR and runtime-envelope safety.',
  );
});

test('coverage status records the M4.111 structural KIR and runtime headroom GO', () => {
  assert.equal(
    formatM4111KirDepthHeadroomStatus({
      limits: { candidateKir: { maxDepth: 76 } },
      summary: {
        maxExactFloor: 31_028,
        minimumPromotionHeadroom: 18_124,
        witnessCount: 9,
      },
    }),
    'M4.111 authenticates maxDepth 76 across 9 witnesses at maximum floor 31028 with ' +
      '18124 promotion headroom; M4.112 promotes structural KIR depth.',
  );
});

test('coverage status records the M4.112 structural KIR depth promotion', () => {
  assert.equal(
    formatM4112KirDepthPromotionStatus({
      kirLimits: { maxBytes: 262_144, maxDepth: 76, maxNodes: 4_096 },
      parameterMigration: {
        completeFunctions: 9,
        completeTools: 4,
        migratedParameterRows: 134,
      },
    }),
    'M4.112 promotes structural KIR maxDepth to 76 and publishes the exact ' +
      '9-function/134-row parameter queue across 4 tools; M4.113 consumes it.',
  );
});

test('coverage status records the M4.113 parameter migration', () => {
  assert.equal(
    formatM4113ParameterMigrationStatus({
      migratedFunctions: 9,
      migratedRows: 134,
    }),
    'M4.113 consumes the exact M4.112 9-function/134-row parameter queue and advances the ' +
      'cumulative base to 101/111 with 6 legacy-parameter blockers; ' +
      'M4.114 remeasures the bounded residual frontier.',
  );
});

test('coverage status records the M4.102 production-ceiling rejection', () => {
  assert.equal(
    formatM4102TripleRowHeadroomStatus({
      limits: {
        candidateProfile: { maxNodeRows: 89, maxPropertyRows: 125, maxValueRows: 2100 },
      },
      summary: {
        maxExactFloor: 72_195,
        productionCeilingDeficit: 6_659,
        promotionBudgetDeficit: 23_043,
      },
    }),
    'M4.102 structural runtime rejects the 89/125/2100 candidate: exact floor 72195 ' +
      'exceeds production by 6659 and promotion budget by 23043; ' +
      'M4.103 investigates the runtime bottleneck.',
  );
});

test('coverage status records the M4.103 committed-loop bottleneck diagnosis', () => {
  assert.equal(
    formatM4103RuntimeBottleneckStatus({
      diagnosis: {
        additionalBudget: 6_659,
        additionalRetainedForIterations: 6_659,
        additionalRolledBackIterations: 0,
        additionalParentRestarts: 0,
      },
    }),
    'M4.103 attributes the 6659-step production deficit to 6659 retained for-iterations with ' +
      '0 rolled back and 0 parent restarts; M4.104 reduces statement validation and emission ' +
      'traversal cost.',
  );
});

test('coverage status records the M4.104 production-headroom reduction', () => {
  assert.equal(
    formatM4104RuntimeCostStatus({
      result: {
        exactFloor: 62_830,
        floorReduction: 9_365,
        productionHeadroom: 2_706,
        promotionBudgetDeficit: 13_678,
      },
    }),
    'M4.104 reduces the exact validstatement floor by 9365 to 62830, leaving 2706 production ' +
      'headroom, but misses the promotion budget by 13678; M4.105 investigates the residual ' +
      'runtime bottleneck.',
  );
});

test('coverage status records the M4.105 validation bottleneck diagnosis', () => {
  assert.equal(
    formatM4105RuntimeBottleneckStatus({
      diagnosis: {
        additionalRetainedIterations: 13_678,
        additionalRolledBackIterations: 0,
        emissionExecutionsAtPromotionBudget: 0,
        validstatementExecutionsAtExactFloor: 73,
        validstatementExecutionsAtPromotionBudget: 34,
      },
    }),
    'M4.105 attributes the 13678-step promotion deficit to retained validation work before ' +
    'emission: 34/73 validstatement helper executions are observed at the budget versus the floor, ' +
      '0 emission helpers execute, and 0 iterations roll back; M4.106 consolidates authenticated ' +
      'statement property and child-count access.',
  );
});

test('coverage status records M4.106 promotion-budget headroom', () => {
  assert.equal(
    formatM4106RuntimeCostStatus({
      result: {
        exactFloor: 39_016,
        floorReduction: 23_814,
        promotionBudgetHeadroom: 10_136,
      },
    }),
    'M4.106 reduces the exact validstatement floor by 23814 to 39016, leaving 10136 ' +
      'promotion-budget headroom with one statement-table projection execution; M4.107 ' +
      'authenticates the profile promotion.',
  );
});

test('coverage status records the M4.107 triple-row promotion and exact queue', () => {
  assert.equal(
    formatM4107TripleRowPromotionStatus({
      parameterMigration: {
        completeFunctions: 1,
        migratedParameterRows: 14,
      },
      profileLimits: {
        maxNodeRows: 89,
        maxPropertyRows: 125,
        maxValueRows: 2100,
      },
    }),
    'M4.107 promotes maxNodeRows/maxPropertyRows/maxValueRows to 89/125/2100 and publishes ' +
      'the exact 1-function/14-row parameter queue; M4.108 consumes it.',
  );
});

test('coverage status records the M4.50 recommendation and M4.51 headroom', () => {
  assert.equal(
    formatM450ResidualAnalysisStatus(null),
    'M4.50 published analysis found no actionable profile widening.',
  );
  assert.equal(
    formatM450ResidualAnalysisStatus({
      completeFunctions: 1,
      changedLimits: ['maxPropertyRows'],
    }),
    'M4.50 published analysis selected 1 function by maxPropertyRows widening; M4.51 authenticates structural runtime headroom.',
  );
  assert.equal(
    formatM451PropertyRowHeadroomStatus({ summary: { maxExactFloor: 11_951, witnessCount: 1 } }),
    'M4.51 structural headroom authenticated 1 witness at an 11951 exact floor; M4.52 authenticates the property-row profile promotion.',
  );
});

test('coverage status records M4.53 consumption of the M4.52 parameter queue', () => {
  assert.equal(
    formatM453ParameterMigrationStatus({
      parameterMigration: { completeFunctions: 1, migratedParameterRows: 6 },
    }),
    'M4.53 consumes the exact M4.52 1-function/6-row parameter queue.',
  );
});

test('coverage status records M4.57 consumption of the M4.56 parameter queue', () => {
  assert.equal(
    formatM457ParameterMigrationStatus({
      parameterMigration: { completeFunctions: 7, migratedParameterRows: 102 },
    }),
    'M4.57 consumes the exact M4.56 7-functions/102-row parameter queue.',
  );
});

test('coverage status records the M4.58 while-iteration handoff boundary', () => {
  assert.equal(
    formatM458WhilePrerequisiteStatus({
      record: {
        snapshot: {
          selectedPrerequisite: {
            catalogFacts: 2,
            family: 'while-iteration',
            occurrences: 2,
          },
        },
      },
    }),
    'M4.58 freezes the exact M4.57 while-iteration prerequisite (2 catalog facts/2 occurrences); M4.59 owns canonicalizer implementation; M4.60 promotes it into the cumulative base.',
  );
});

test('coverage status records M4.61 consumption of the immutable M4.60 queue', () => {
  assert.equal(
    formatM461ParameterMigrationStatus({
      record: {
        parameterMigration: { completeFunctions: 1, migratedParameterRows: 1 },
      },
    }),
    'M4.61 consumes the exact M4.60 1-function/1-row parameter queue.',
  );
});

test('coverage status records the M4.62 residual recommendation', () => {
  assert.equal(
    formatM462ResidualAnalysisStatus(null),
    'M4.62 published analysis found no actionable profile widening.',
  );
  assert.equal(
    formatM462ResidualAnalysisStatus({
      completeFunctions: 4,
      changedLimits: ['maxNodeRows'],
    }),
    'M4.62 published analysis selected 4 functions by maxNodeRows widening; M4.63 authenticates structural runtime headroom.',
  );
});

test('coverage status records the M4.63 structural headroom handoff', () => {
  assert.equal(
    formatM463NodeRowHeadroomStatus({
      summary: { maxExactFloor: 27_076, witnessCount: 4 },
    }),
    'M4.63 structural headroom authenticated 4 witnesses at a 27076 maximum floor; M4.64 authenticates the node-row profile promotion.',
  );
});

test('coverage status records M4.65 consumption of the immutable M4.64 queue', () => {
  assert.equal(
    formatM465ParameterMigrationStatus({
      record: {
        parameterMigration: { completeFunctions: 4, migratedParameterRows: 37 },
      },
    }),
    'M4.65 consumes the exact M4.64 4-functions/37-row parameter queue.',
  );
});

test('coverage status records the M4.66 residual recommendation', () => {
  assert.equal(
    formatM466ResidualAnalysisStatus(null),
    'M4.66 published analysis found no actionable profile widening.',
  );
  assert.equal(
    formatM466ResidualAnalysisStatus({
      completeFunctions: 1,
      changedLimits: ['maxNodeRows'],
    }),
    'M4.66 published analysis selected 1 function by maxNodeRows widening; M4.67 authenticates structural runtime headroom.',
  );
});

test('coverage status records the M4.67 structural headroom handoff', () => {
  assert.equal(
    formatM467NodeRowHeadroomStatus({
      summary: { maxExactFloor: 17_552, witnessCount: 1 },
    }),
    'M4.67 structural headroom authenticated 1 witness at exact floor 17552; M4.68 authenticates the node-row profile promotion.',
  );
});

test('coverage status records the M4.70 residual recommendation', () => {
  assert.equal(
    formatM470ResidualAnalysisStatus(null),
    'M4.70 published analysis found no actionable profile widening.',
  );
  assert.equal(
    formatM470ResidualAnalysisStatus({
      completeFunctions: 1,
      changedLimits: ['maxNodeRows', 'maxPropertyRows'],
    }),
    'M4.70 published analysis selected 1 function by maxNodeRows+maxPropertyRows widening; M4.71 authenticates structural runtime headroom.',
  );
});

test('coverage status records the M4.74 residual recommendation', () => {
  assert.equal(
    formatM474ResidualAnalysisStatus(null),
    'M4.74 published analysis found no actionable profile widening.',
  );
  assert.equal(
    formatM474ResidualAnalysisStatus({
      completeFunctions: 1,
      changedLimits: ['maxNodeRows', 'maxValueRows'],
    }),
    'M4.74 published analysis selected 1 function by maxNodeRows+maxValueRows widening; M4.75 authenticates structural runtime headroom.',
  );
});

test('coverage status records the M4.78 residual recommendation', () => {
  assert.equal(
    formatM478ResidualAnalysisStatus(null),
    'M4.78 published analysis found no actionable profile widening.',
  );
  assert.equal(
    formatM478ResidualAnalysisStatus({
      completeFunctions: 1,
      changedLimits: ['maxPropertyRows'],
    }),
    'M4.78 published analysis selected 1 function by maxPropertyRows widening; M4.79 authenticates structural runtime headroom.',
  );
});

test('coverage status records the M4.83 residual recommendation', () => {
  assert.equal(
    formatM483ResidualAnalysisStatus(null),
    'M4.83 published analysis found no actionable profile widening.',
  );
  assert.equal(
    formatM483ResidualAnalysisStatus({
      completeFunctions: 1,
      changedLimits: ['maxValueRows'],
    }),
    'M4.83 published analysis selected 1 function by maxValueRows widening; M4.84 authenticates structural runtime headroom.',
  );
});

test('coverage status records the M4.87 residual recommendation', () => {
  assert.equal(
    formatM487ResidualAnalysisStatus(null),
    'M4.87 published analysis found no actionable profile widening.',
  );
  assert.equal(
    formatM487ResidualAnalysisStatus({
      completeFunctions: 3,
      changedLimits: ['maxNodeRows', 'maxPropertyRows'],
    }),
    'M4.87 published analysis selected 3 functions by maxNodeRows+maxPropertyRows widening; M4.88 authenticates structural runtime headroom.',
  );
});

test('coverage status records the M4.88 production-ceiling NO-GO', () => {
  assert.equal(
    formatM488DualRowHeadroomStatus({
      limits: { candidateProfile: { maxNodeRows: 74, maxPropertyRows: 77, maxValueRows: 580 } },
      summary: {
        maxExactFloor: 107_594,
        productionCeilingDeficit: 42_058,
        promotionBudgetDeficit: 58_442,
      },
    }),
    'M4.88 structural runtime rejects the 74/77/580 candidate: maximum floor 107594 exceeds production by 42058 and promotion budget by 58442; M4.89 reduces canonicalizer runtime cost.',
  );
});

test('coverage status records the M4.89 runtime-cost reduction', () => {
  assert.equal(
    formatM489RuntimeCostStatus({
      baseline: { maxExactFloor: 107_594 },
      result: { floorReduction: 80_080, maxExactFloor: 27_514, promotionHeadroom: 21_638 },
    }),
    'M4.89 reduces the exact three-witness maximum floor from 107594 to 27514 by 80080 steps with 21638 promotion headroom; M4.90 authenticates the dual-row profile promotion.',
  );
});

test('coverage status records the M4.90 dual-row promotion', () => {
  assert.equal(
    formatM490DualRowPromotionStatus({
      parameterMigration: {
        completeFunctions: 4,
        migratedParameterRows: 47,
      },
    }),
    'M4.90 promotes maxNodeRows/maxPropertyRows to 74/77 and publishes the exact 4-function/47-row parameter queue; M4.91 consumes it.',
  );
});

test('coverage status records M4.91 consumption of the immutable M4.90 queue', () => {
  assert.equal(
    formatM491ParameterMigrationStatus({
      parameterMigration: {
        completeFunctions: 4,
        migratedParameterRows: 47,
      },
    }),
    'M4.91 consumes the exact M4.90 4-function/47-row parameter queue and advances the cumulative base to 88/106.',
  );
});

test('coverage status records the M4.71 structural headroom handoff', () => {
  assert.equal(
    formatM471DualRowHeadroomStatus({
      summary: { maxExactFloor: 36_193, witnessCount: 1 },
    }),
    'M4.71 structural headroom authenticated 1 witness at exact floor 36193; M4.72 authenticates the dual-row profile promotion.',
  );
});

test('coverage status records the M4.75 structural headroom handoff', () => {
  assert.equal(
    formatM475DualRowHeadroomStatus({
      summary: { maxExactFloor: 46_255, witnessCount: 1 },
    }),
    'M4.75 structural headroom authenticated 1 witness at exact floor 46255; M4.76 authenticates the node+value profile promotion.',
  );
});

test('coverage status records the M4.79 property-row promotion NO-GO', () => {
  assert.equal(
    formatM479PropertyRowHeadroomStatus({
      summary: { maxExactFloor: 56_238, promotionBudgetDeficit: 7_086 },
    }),
    'M4.79 structural runtime floor 56238 rejects property-row promotion by 7086 steps; M4.80 reduces canonicalizer runtime cost.',
  );
});

test('coverage status records the M4.80 runtime-cost reduction', () => {
  assert.equal(
    formatM480RuntimeCostStatus({
      baseline: { exactFloor: 56_238 },
      result: { exactFloor: 35_998, floorReduction: 20_240, promotionHeadroom: 13_154 },
    }),
    'M4.80 reduces the exact structural runtime floor from 56238 to 35998 by 20240 steps with 13154 promotion headroom; M4.81 authenticates the property-row profile promotion.',
  );
});

test('coverage status records the M4.81 property-row promotion', () => {
  assert.equal(
    formatM481PropertyRowPromotionStatus({
      parameterMigration: { completeFunctions: 1, migratedParameterRows: 22 },
    }),
    'M4.81 promotes maxPropertyRows to 61 and publishes the exact 1-function/22-row parameter queue; M4.82 consumes it.',
  );
});

test('coverage status records M4.82 consumption of the immutable M4.81 queue', () => {
  assert.equal(
    formatM482ParameterMigrationStatus({
      record: { parameterMigration: { completeFunctions: 1, migratedParameterRows: 22 } },
    }),
    'M4.82 consumes the exact M4.81 1-function/22-row parameter queue and advances the cumulative base to 82/105.',
  );
});

test('coverage status records the M4.84 value-row structural headroom', () => {
  assert.equal(
    formatM484ValueRowHeadroomStatus({
      summary: { maxExactFloor: 38_773, minimumPromotionHeadroom: 10_379, witnessCount: 1 },
    }),
    'M4.84 structural headroom authenticates 1 witness at exact floor 38773 with 10379 promotion headroom; M4.85 authenticates the value-row profile promotion.',
  );
});

test('coverage status records the M4.85 value-row promotion', () => {
  assert.equal(
    formatM485ValueRowPromotionStatus({
      parameterMigration: { completeFunctions: 1, migratedParameterRows: 19 },
    }),
    'M4.85 promotes maxValueRows to 580 and publishes the exact 1-function/19-row parameter queue; M4.86 consumes it.',
  );
});

test('coverage status records M4.86 consumption of the immutable M4.85 queue', () => {
  assert.equal(
    formatM486ParameterMigrationStatus({
      parameterMigration: { completeFunctions: 1, migratedParameterRows: 19 },
    }),
    'M4.86 consumes the exact M4.85 1-function/19-row parameter queue and advances the cumulative base to 84/105.',
  );
});

test('coverage status records the M4.54 recommendation', () => {
  assert.equal(
    formatM454ResidualAnalysisStatus(null),
    'M4.54 published analysis found no actionable profile widening.',
  );
  assert.equal(
    formatM454ResidualAnalysisStatus({
      completeFunctions: 7,
      changedLimits: ['maxNodeRows', 'maxPropertyRows'],
    }),
    'M4.54 published analysis selected 7 functions by maxNodeRows+maxPropertyRows widening; M4.55 authenticates structural runtime headroom.',
  );
});

test('coverage status records the M4.55 structural headroom handoff', () => {
  assert.equal(
    formatM455DualRowHeadroomStatus({
      summary: { maxExactFloor: 26_356, witnessCount: 7 },
    }),
    'M4.55 structural headroom authenticated 7 witnesses at a 26356 maximum floor; M4.56 authenticates the dual-row profile promotion.',
  );
});

test('coverage status records the published M4.38 action through M4.41 queue consumption', () => {
  assert.equal(
    formatPublishedResidualAnalysisStatus({ completeFunctions: 11, changedLimits: ['maxValueRows'] }),
    'M4.38 published analysis selected 11 functions by maxValueRows widening; M4.40 authenticated the profile promotion; M4.41 consumes the parameter queue.',
  );
});
