import type { IRNode, TranspileResult } from './types.js';
import { STYLE_SHORTHANDS } from './spec.js';

// ── Mapped CSS properties (mirrors the switch cases in stylesToTailwind) ─

const MAPPED_CSS_PROPERTIES = new Set([
  'padding', 'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight',
  'margin', 'marginTop', 'marginBottom', 'marginLeft', 'marginRight',
  'backgroundColor', 'color', 'fontSize', 'fontWeight', 'borderRadius',
  'width', 'height', 'justifyContent', 'alignItems', 'flexDirection',
  'flex', 'gap', 'borderColor', 'borderWidth', 'overflow',
]);

// ── Handled node types (mirrors renderNode switch in transpiler-tailwind) ─

const HANDLED_NODE_TYPES = new Set([
  'state', 'logic', 'screen', 'section', 'card', 'row', 'col', 'text',
  'divider', 'button', 'slider', 'toggle', 'grid', 'conditional',
  'component', 'icon', 'image', 'list', 'item', 'tabs', 'tab',
  'progress', 'input', 'theme',
]);

// ── Types ────────────────────────────────────────────────────────────────

export interface StyleMetrics {
  totalStyleDecls: number;
  mappedStyleDecls: number;
  escapedStyleDecls: number;
  escapeRatio: number;
  escapedKeys: string[];
}

export interface NodeTypeMetrics {
  type: string;
  count: number;
  styleDecls: number;
}

export interface LanguageMetrics {
  nodeCount: number;
  unknownNodeCount: number;
  nodeTypes: NodeTypeMetrics[];
  styleMetrics: StyleMetrics;
  shorthandCoverage: number;
  themeRefCount: number;
  pseudoStyleCount: number;
  tokenEfficiency: {
    irTokenCount: number;
    tsTokenCount: number;
    tokenReduction: number;
  } | null;
}

// ── Escape detection ─────────────────────────────────────────────────────

export function isEscapedStyleKey(rawKey: string): boolean {
  const expanded = STYLE_SHORTHANDS[rawKey] || rawKey;
  return !MAPPED_CSS_PROPERTIES.has(expanded);
}

// ── Internal accumulator ─────────────────────────────────────────────────

interface MetricsAcc {
  nodeCount: number;
  unknownNodeCount: number;
  nodeTypeCounts: Map<string, { count: number; styleDecls: number }>;
  totalStyleDecls: number;
  mappedStyleDecls: number;
  escapedStyleDecls: number;
  escapedKeys: Set<string>;
  shorthandHits: number;
  totalRawKeys: number;
  themeRefCount: number;
  pseudoStyleCount: number;
}

function walkNode(node: IRNode, acc: MetricsAcc): void {
  acc.nodeCount++;

  if (!HANDLED_NODE_TYPES.has(node.type)) {
    acc.unknownNodeCount++;
  }

  const props = node.props || {};
  const styles = (props.styles as Record<string, string>) || {};
  const styleCount = Object.keys(styles).length;

  // Count node types
  const entry = acc.nodeTypeCounts.get(node.type);
  if (entry) {
    entry.count++;
    entry.styleDecls += styleCount;
  } else {
    acc.nodeTypeCounts.set(node.type, { count: 1, styleDecls: styleCount });
  }

  // Classify style declarations
  for (const rawKey of Object.keys(styles)) {
    acc.totalStyleDecls++;
    acc.totalRawKeys++;

    if (rawKey in STYLE_SHORTHANDS) {
      acc.shorthandHits++;
    }

    const expanded = STYLE_SHORTHANDS[rawKey] || rawKey;
    if (MAPPED_CSS_PROPERTIES.has(expanded)) {
      acc.mappedStyleDecls++;
    } else {
      acc.escapedStyleDecls++;
      acc.escapedKeys.add(expanded);
    }
  }

  // Count theme refs
  const themeRefs = (props.themeRefs as string[]) || [];
  acc.themeRefCount += themeRefs.length;

  // Count pseudo-style declarations
  const pseudoStyles = (props.pseudoStyles as Record<string, Record<string, string>>) || {};
  for (const stateStyles of Object.values(pseudoStyles)) {
    acc.pseudoStyleCount += Object.keys(stateStyles).length;
  }

  // Recurse children
  if (node.children) {
    for (const child of node.children) {
      walkNode(child, acc);
    }
  }
}

// ── Main export ──────────────────────────────────────────────────────────

export function collectLanguageMetrics(root: IRNode, result?: TranspileResult): LanguageMetrics {
  const acc: MetricsAcc = {
    nodeCount: 0,
    unknownNodeCount: 0,
    nodeTypeCounts: new Map(),
    totalStyleDecls: 0,
    mappedStyleDecls: 0,
    escapedStyleDecls: 0,
    escapedKeys: new Set(),
    shorthandHits: 0,
    totalRawKeys: 0,
    themeRefCount: 0,
    pseudoStyleCount: 0,
  };

  walkNode(root, acc);

  const nodeTypes: NodeTypeMetrics[] = [...acc.nodeTypeCounts.entries()]
    .map(([type, data]) => ({ type, count: data.count, styleDecls: data.styleDecls }))
    .sort((a, b) => b.count - a.count);

  return {
    nodeCount: acc.nodeCount,
    unknownNodeCount: acc.unknownNodeCount,
    nodeTypes,
    styleMetrics: {
      totalStyleDecls: acc.totalStyleDecls,
      mappedStyleDecls: acc.mappedStyleDecls,
      escapedStyleDecls: acc.escapedStyleDecls,
      escapeRatio: acc.totalStyleDecls > 0 ? acc.escapedStyleDecls / acc.totalStyleDecls : 0,
      escapedKeys: [...acc.escapedKeys].sort(),
    },
    shorthandCoverage: acc.totalRawKeys > 0 ? acc.shorthandHits / acc.totalRawKeys : 0,
    themeRefCount: acc.themeRefCount,
    pseudoStyleCount: acc.pseudoStyleCount,
    tokenEfficiency: result ? {
      irTokenCount: result.irTokenCount,
      tsTokenCount: result.tsTokenCount,
      tokenReduction: result.tokenReduction,
    } : null,
  };
}

// ── Merge utility (for aggregating across multiple files) ────────────────

export function mergeMetrics(metrics: LanguageMetrics[]): LanguageMetrics {
  if (metrics.length === 0) {
    return collectLanguageMetrics({ type: 'empty' });
  }
  if (metrics.length === 1) return metrics[0];

  let nodeCount = 0;
  let unknownNodeCount = 0;
  let totalStyleDecls = 0;
  let mappedStyleDecls = 0;
  let escapedStyleDecls = 0;
  const escapedKeys = new Set<string>();
  let shorthandHitsSum = 0;
  let totalRawKeysSum = 0;
  let themeRefCount = 0;
  let pseudoStyleCount = 0;
  const nodeTypeMerge = new Map<string, { count: number; styleDecls: number }>();

  for (const m of metrics) {
    nodeCount += m.nodeCount;
    unknownNodeCount += m.unknownNodeCount;
    totalStyleDecls += m.styleMetrics.totalStyleDecls;
    mappedStyleDecls += m.styleMetrics.mappedStyleDecls;
    escapedStyleDecls += m.styleMetrics.escapedStyleDecls;
    for (const k of m.styleMetrics.escapedKeys) escapedKeys.add(k);
    themeRefCount += m.themeRefCount;
    pseudoStyleCount += m.pseudoStyleCount;

    // Approximate shorthand coverage from stored ratio
    const rawKeys = m.styleMetrics.totalStyleDecls;
    shorthandHitsSum += Math.round(m.shorthandCoverage * rawKeys);
    totalRawKeysSum += rawKeys;

    for (const nt of m.nodeTypes) {
      const existing = nodeTypeMerge.get(nt.type);
      if (existing) {
        existing.count += nt.count;
        existing.styleDecls += nt.styleDecls;
      } else {
        nodeTypeMerge.set(nt.type, { count: nt.count, styleDecls: nt.styleDecls });
      }
    }
  }

  const nodeTypes: NodeTypeMetrics[] = [...nodeTypeMerge.entries()]
    .map(([type, data]) => ({ type, count: data.count, styleDecls: data.styleDecls }))
    .sort((a, b) => b.count - a.count);

  return {
    nodeCount,
    unknownNodeCount,
    nodeTypes,
    styleMetrics: {
      totalStyleDecls,
      mappedStyleDecls,
      escapedStyleDecls,
      escapeRatio: totalStyleDecls > 0 ? escapedStyleDecls / totalStyleDecls : 0,
      escapedKeys: [...escapedKeys].sort(),
    },
    shorthandCoverage: totalRawKeysSum > 0 ? shorthandHitsSum / totalRawKeysSum : 0,
    themeRefCount,
    pseudoStyleCount,
    tokenEfficiency: null,
  };
}
