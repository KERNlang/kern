import { KERN_STDLIB } from './codegen/kern-stdlib.js';
import {
  PORTABLE_LOGIC_PRIMITIVE_IDS,
  PORTABLE_LOGIC_PRIMITIVES,
  type PortableLogicPrimitiveId,
  type PortableLogicSupport,
  type PortableLogicTarget,
} from './codegen/portable-logic-primitives.js';
import { CORE_TYPE_CONTRACTS, type CoreOperationReturns, contractToGraphEdges } from './core-contracts/index.js';
import type { NodeContract } from './ir/semantics/index.js';
import { snapshotRegistry } from './ir/semantics/index.js';

export type KernSemanticSubstrateSource = 'codegen-from-ts' | 'native-kern';
export type KernSemanticSubstrateTarget = PortableLogicTarget;

export interface KernSemanticSupport {
  readonly ts: PortableLogicSupport;
  readonly python: PortableLogicSupport;
  readonly go: PortableLogicSupport;
}

export interface KernSemanticCoreOperation {
  readonly id: string;
  readonly kind: string;
  readonly args: readonly string[];
  readonly returns: readonly string[];
  readonly lowerings: Readonly<Record<string, string>>;
  readonly fixtureCount: number;
  readonly reviewSummary: string;
  readonly reviewTags: readonly string[];
}

export interface KernSemanticCoreType {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly strict: true;
  readonly operations: readonly KernSemanticCoreOperation[];
}

export interface KernSemanticPrimitive {
  readonly id: PortableLogicPrimitiveId;
  readonly kernName: string;
  readonly domain: string;
  readonly description: string;
  readonly intent: string;
  readonly purity: string;
  readonly hostPatterns: readonly string[];
  readonly portabilityNotes: readonly string[];
  readonly support: KernSemanticSupport;
}

export interface KernSemanticStdlibOperation {
  readonly id: string;
  readonly module: string;
  readonly method: string;
  readonly arity: number;
  readonly support: KernSemanticSupport;
}

export interface KernSemanticIrContract {
  readonly nodeType: string;
  readonly forbiddenRewrites: readonly string[];
  readonly fixtureCount: number;
}

export interface KernSemanticSubstrate {
  readonly schemaVersion: 1;
  readonly generatedBy: 'kern-semantic-substrate';
  readonly source: KernSemanticSubstrateSource;
  readonly coreTypes: readonly KernSemanticCoreType[];
  readonly coreGraphEdges: readonly {
    readonly from: string;
    readonly relation: string;
    readonly to: string;
    readonly operation?: string;
    readonly index?: number;
  }[];
  readonly portablePrimitives: readonly KernSemanticPrimitive[];
  readonly stdlibOperations: readonly KernSemanticStdlibOperation[];
  readonly irContracts: readonly KernSemanticIrContract[];
}

export interface BuildKernSemanticSubstrateOptions {
  readonly source?: KernSemanticSubstrateSource;
  readonly irContracts?: ReadonlyMap<string, NodeContract>;
}

export function buildKernSemanticSubstrate(options: BuildKernSemanticSubstrateOptions = {}): KernSemanticSubstrate {
  const coreTypes = Object.values(CORE_TYPE_CONTRACTS.types).map((contract) => ({
    id: `core.type.${contract.name}`,
    name: contract.name,
    kind: contract.kind,
    strict: contract.strict,
    operations: contract.operations.map((operation) => ({
      id: operation.id,
      kind: operation.kind,
      args: [...operation.args],
      returns: normalizeReturns(operation.returns),
      lowerings: operation.lowers ? { ...operation.lowers } : {},
      fixtureCount: operation.fixtures.length,
      reviewSummary: operation.review.summary,
      reviewTags: [...operation.review.graph],
    })),
  }));

  return {
    schemaVersion: 1,
    generatedBy: 'kern-semantic-substrate',
    source: options.source ?? 'codegen-from-ts',
    coreTypes,
    coreGraphEdges: Object.values(CORE_TYPE_CONTRACTS.types).flatMap((contract) => contractToGraphEdges(contract)),
    portablePrimitives: PORTABLE_LOGIC_PRIMITIVE_IDS.map((id) => {
      const primitive = PORTABLE_LOGIC_PRIMITIVES[id];
      return {
        id,
        kernName: kernPrimitiveName(id),
        domain: id.split('.')[0],
        description: primitive.description,
        intent: primitive.intent,
        purity: primitive.purity,
        hostPatterns: [...primitive.hostPatterns],
        portabilityNotes: [...primitive.portabilityNotes],
        support: { ...primitive.targets },
      };
    }),
    stdlibOperations: Object.entries(KERN_STDLIB).flatMap(([module, entries]) =>
      Object.entries(entries).map(([method, entry]) => ({
        id: `stdlib.${module}.${method}`,
        module,
        method,
        arity: entry.arity,
        support: {
          ts: entry.ts ? 'stable' : 'unsupported',
          python: entry.py ? 'stable' : 'unsupported',
          go: 'unsupported',
        },
      })),
    ),
    irContracts: options.irContracts
      ? snapshotRegistry(options.irContracts).contracts.map((contract) => ({
          nodeType: contract.nodeType,
          forbiddenRewrites: [...contract.forbiddenRewrites],
          fixtureCount: contract.fixtureCount,
        }))
      : [],
  };
}

export function lookupSemanticPrimitive(
  substrate: KernSemanticSubstrate,
  id: PortableLogicPrimitiveId,
): KernSemanticPrimitive {
  const primitive = substrate.portablePrimitives.find((candidate) => candidate.id === id);
  if (!primitive) {
    throw new Error(`KERN semantic substrate missing portable primitive '${id}'.`);
  }
  return primitive;
}

export function semanticPrimitiveSupportSummary(
  primitive: KernSemanticPrimitive,
  targets: readonly KernSemanticSubstrateTarget[],
): string {
  const bySupport: Record<PortableLogicSupport, string[]> = {
    preview: [],
    stable: [],
    unsupported: [],
  };
  for (const target of targets) {
    bySupport[primitive.support[target] ?? 'unsupported'].push(target);
  }

  const parts: string[] = [];
  for (const support of ['stable', 'preview', 'unsupported'] satisfies PortableLogicSupport[]) {
    const targetNames = bySupport[support];
    if (targetNames.length > 0) parts.push(`${support}: ${targetNames.join(', ')}`);
  }
  return parts.join('; ');
}

function normalizeReturns(returns: CoreOperationReturns): readonly string[] {
  return typeof returns === 'string' ? [returns] : [...returns];
}

const KERN_PRIMITIVE_NAMES = {
  'collection.has': 'includes',
  'collection.count': 'count',
  'collection.filter': 'filter',
  'collection.compact': 'compact',
  'collection.pluck': 'pluck',
  'collection.take': 'take',
  'collection.drop': 'drop',
  'collection.slice': 'slice',
  'collection.reverse': 'reverse',
  'collection.at': 'at',
  'collection.join': 'join',
  'collection.concat': 'concat',
  'collection.includes': 'includes',
  'collection.indexOf': 'indexOf',
  'collection.lastIndexOf': 'lastIndexOf',
  'collection.sort': 'sort',
  'collection.uniqueBy': 'uniqueBy',
  'collection.groupBy': 'groupBy',
  'collection.partition': 'partition',
  'collection.indexBy': 'indexBy',
  'collection.countBy': 'countBy',
  'logic.firstTruthy': 'firstTruthy',
  'logic.coalesce': 'coalesce',
  'time.epochMs': 'epochMs',
  'logic.not': 'not',
  'number.clamp': 'clamp',
  'object.keys': 'objectKeys',
  'object.values': 'objectValues',
  'object.entries': 'objectEntries',
  'object.merge': 'objectMerge',
  'object.omit': 'objectOmit',
  'object.pick': 'objectPick',
  'string.trim': 'trim',
  'string.split': 'split',
  'string.replaceFirst': 'replaceFirst',
  'string.replaceAll': 'replaceAll',
  'logic.firstDefined': 'firstDefined',
  'string.coerce': 'string',
} as const satisfies Record<PortableLogicPrimitiveId, string>;

function kernPrimitiveName(id: PortableLogicPrimitiveId): string {
  const name = KERN_PRIMITIVE_NAMES[id];
  if (!name) throw new Error(`KERN semantic substrate missing KERN primitive name for '${id}'.`);
  return name;
}
