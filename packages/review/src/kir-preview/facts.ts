import { basename } from 'node:path';
import { canonicalJson, compareCodePoints, deepFreeze, sha256 } from './canonical.js';
import type {
  CanonicalKirFactModel,
  CanonicalRecordEntry,
  CanonicalValue,
  KirFact,
  StructuralKirNodeView,
  VerifiedProjectionView,
} from './model.js';
import type { KernReviewTargetProfile } from './types.js';

function properties(entries: readonly CanonicalRecordEntry[]): ReadonlyMap<string, CanonicalValue> {
  return new Map(entries.map((entry) => [entry.key, entry.value]));
}

function text(value: CanonicalValue | undefined): string | undefined {
  return value?.tag === 'text' ? value.value : undefined;
}

function bool(value: CanonicalValue | undefined): boolean | undefined {
  return value?.tag === 'bool' ? value.value : undefined;
}

function record(value: CanonicalValue | undefined): ReadonlyMap<string, CanonicalValue> | undefined {
  return value?.tag === 'record' ? properties(value.value) : undefined;
}

function expression(value: CanonicalValue): { kind: string; fields: ReadonlyMap<string, CanonicalValue> } | undefined {
  const outer = record(value);
  if (!outer) return undefined;
  const kind = text(outer.get('kind'));
  const fields = record(outer.get('fields'));
  return kind && fields ? { kind, fields } : undefined;
}

function renderExpression(value: CanonicalValue): string {
  const parsed = expression(value);
  if (!parsed) return canonicalJson(value);
  const { kind, fields } = parsed;
  if (kind === 'identifier') return text(fields.get('name')) ?? '<dynamic>';
  if (kind === 'text') return JSON.stringify(text(fields.get('value')) ?? '');
  if (kind === 'integer' || kind === 'decimal') return text(fields.get('value')) ?? canonicalJson(value);
  if (kind === 'boolean') return String(bool(fields.get('value')));
  if (kind === 'null') return 'null';
  if (kind === 'call') {
    const callee = fields.get('callee');
    const args = fields.get('args');
    return `${callee ? renderExpression(callee) : '<dynamic>'}(${
      args?.tag === 'list' ? args.value.map(renderExpression).join(',') : ''
    })`;
  }
  if (kind === 'new') {
    const args = fields.get('args');
    return `new ${text(fields.get('constructor')) ?? '<dynamic>'}(${
      args?.tag === 'list' ? args.value.map(renderExpression).join(',') : ''
    })`;
  }
  return canonicalJson(value);
}

function firstText(value: CanonicalValue): string | undefined {
  const parsed = expression(value);
  if (parsed?.kind === 'text') return text(parsed.fields.get('value'));
  if ('value' in value && Array.isArray(value.value)) {
    for (const child of value.value) {
      const candidate = 'key' in child ? firstText(child.value) : firstText(child);
      if (candidate !== undefined) return candidate;
    }
  }
  return undefined;
}

function nodeName(node: StructuralKirNodeView): string | undefined {
  return text(properties(node.properties).get('name'));
}

function ownerKey(moduleId: string, node: StructuralKirNodeView): string {
  return `${moduleId}/${node.kind}/${nodeName(node) ?? '<anonymous>'}`;
}

function identityWithoutRootName(node: StructuralKirNodeView): unknown {
  return {
    kind: node.kind,
    properties: node.properties.filter((entry) => entry.key !== 'name'),
    children: node.children,
  };
}

function originalImportPath(root: StructuralKirNodeView, resolvedSource: string): string {
  const sourceLeaf = basename(resolvedSource).replace(/\.kern$/u, '');
  const candidates = root.kind === 'use' ? [root] : [];
  for (const candidate of candidates) {
    const path = text(properties(candidate.properties).get('path'));
    if (path && basename(path) === sourceLeaf) return path;
  }
  return resolvedSource;
}

function collectCalls(
  value: CanonicalValue,
  moduleId: string,
  owner: string,
  path: string,
  profile: KernReviewTargetProfile,
  facts: KirFact[],
): void {
  const parsed = expression(value);
  if (parsed?.kind === 'call') {
    const display = renderExpression(value);
    facts.push({
      facet: 'calls',
      moduleId,
      key: `${owner}/${path}/${sha256(value)}`,
      matchKey: `${owner}/${path}`,
      value: sha256(value),
      display,
    });
  }
  if (parsed && profile.unsupportedExpressionKinds?.includes(parsed.kind)) {
    const key = `expression:${parsed.kind}`;
    facts.push({
      facet: 'target-compatibility',
      moduleId,
      key,
      matchKey: key,
      value: sha256({ owner, path, expression: value }),
      display: key,
    });
  }
  if (value.tag === 'list') {
    for (const child of value.value) collectCalls(child, moduleId, owner, path, profile, facts);
  } else if (value.tag === 'record') {
    for (const entry of value.value) collectCalls(entry.value, moduleId, owner, `${path}/${entry.key}`, profile, facts);
  } else if (value.tag === 'map') {
    for (const entry of value.value) collectCalls(entry.value, moduleId, owner, path, profile, facts);
  } else if (value.tag === 'error' && value.value.details) {
    collectCalls(value.value.details, moduleId, owner, `${path}/details`, profile, facts);
  }
}

function collectNodeFacts(
  node: StructuralKirNodeView,
  moduleId: string,
  owner: StructuralKirNodeView,
  path: string,
  profile: KernReviewTargetProfile,
  facts: KirFact[],
): void {
  const ownerIdentity = ownerKey(moduleId, owner);
  const props = properties(node.properties);
  for (const entry of node.properties) {
    collectCalls(entry.value, moduleId, ownerIdentity, `${path}/${entry.key}`, profile, facts);
  }

  if (node.kind === 'capability') {
    const namespace = text(props.get('namespace')) ?? '<unknown>';
    const operation = text(props.get('operation')) ?? '<unknown>';
    const name = text(props.get('name')) ?? '<anonymous>';
    const display = `${namespace}/${operation}`;
    const matchKey = `${ownerIdentity}/${name}`;
    facts.push({
      facet: 'capabilities',
      moduleId,
      key: `${matchKey}/${display}`,
      matchKey,
      value: sha256(node),
      display,
    });
    if (profile.unsupportedCapabilities.includes(display)) {
      facts.push({
        facet: 'target-compatibility',
        moduleId,
        key: display,
        matchKey: display,
        value: sha256({ owner: ownerIdentity, capability: display }),
        display,
      });
    }
  }

  if (['capability', 'effect', 'fetch', 'emit', 'throw'].includes(node.kind)) {
    const value = props.get('value');
    const display =
      node.kind === 'capability'
        ? `${text(props.get('namespace')) ?? '<unknown>'}/${text(props.get('operation')) ?? '<unknown>'}`
        : value
          ? (firstText(value) ?? renderExpression(value))
          : node.kind;
    facts.push({
      facet: 'effects',
      moduleId,
      key: `${ownerIdentity}/${node.kind}/${sha256(node)}`,
      matchKey: `${ownerIdentity}/${node.kind}`,
      value: sha256(node),
      display,
    });
  }

  if (profile.unsupportedNodeKinds?.includes(node.kind)) {
    const key = `node:${node.kind}`;
    facts.push({ facet: 'target-compatibility', moduleId, key, matchKey: key, value: ownerIdentity, display: key });
  }

  const named = nodeName(node);
  const structuralKey =
    node === owner
      ? `${node.kind}/${named ?? sha256(node)}`
      : named
        ? `${owner.kind}/${nodeName(owner) ?? '<anonymous>'}/${named}`
        : `${ownerIdentity}/${path}/${sha256(node)}`;
  const structuralDisplay = props.get('value')
    ? renderExpression(props.get('value') as CanonicalValue)
    : canonicalJson(node);
  facts.push({
    facet: 'structure',
    moduleId,
    key: structuralKey,
    matchKey: named ? structuralKey : `${ownerIdentity}/${path}`,
    value: sha256(node),
    display: structuralDisplay,
  });

  for (const child of node.children) {
    collectNodeFacts(child, moduleId, owner, `${path}/${child.kind}`, profile, facts);
  }
}

function moduleFacts(artifact: VerifiedProjectionView['artifact'], profile: KernReviewTargetProfile): KirFact[] {
  const facts: KirFact[] = [];
  for (const module of artifact.modules) {
    facts.push({
      facet: 'modules',
      moduleId: module.id,
      key: module.id,
      matchKey: module.id,
      value: sha256(module),
      display: module.id,
    });

    const rootsBySymbol = new Map(
      module.roots
        .filter((root) => (root.kind === 'class' || root.kind === 'fn') && nodeName(root) !== undefined)
        .map((root) => [`${root.kind}/${nodeName(root) as string}`, root]),
    );
    for (const exported of module.exports) {
      const root = rootsBySymbol.get(`${exported.kind}/${exported.name}`);
      const key = `${module.id}/${exported.kind}/${exported.name}`;
      const signature = root
        ? { properties: root.properties, params: root.children.filter((child) => child.kind === 'param') }
        : exported;
      facts.push({
        facet: 'public-api',
        moduleId: module.id,
        key,
        matchKey: key,
        value: sha256(signature),
        display: exported.name,
        contentIdentity: root
          ? sha256({ kind: root.kind, source: exported.source, content: identityWithoutRootName(root) })
          : undefined,
      });
    }

    const useRoots = module.roots.filter((root) => root.kind === 'use');
    for (const imported of module.imports) {
      const source =
        useRoots
          .map((root) => originalImportPath(root, imported.source))
          .find((candidate) => candidate !== imported.source) ?? imported.source;
      const dependencyDisplay = basename(imported.source);
      facts.push({
        facet: 'dependencies',
        moduleId: module.id,
        key: `${module.id}/${imported.source}`,
        matchKey: module.id,
        value: imported.source,
        display: dependencyDisplay,
      });
      for (const binding of imported.bindings) {
        const identity = `${module.id}/${binding.imported}/${binding.local}/${binding.kind}/${binding.reexport}`;
        facts.push({
          facet: 'imports',
          moduleId: module.id,
          key: `${module.id}/${source}/${binding.imported}/${binding.local}/${binding.kind}/${binding.reexport}`,
          matchKey: identity,
          value: source,
          display: source,
        });
      }
    }

    for (const root of module.roots) {
      if (root.kind === 'class' || root.kind === 'fn')
        collectNodeFacts(root, module.id, root, root.kind, profile, facts);
    }
  }
  return facts;
}

export function buildCanonicalKirFactModel(
  artifact: VerifiedProjectionView['artifact'],
  profile: KernReviewTargetProfile,
): CanonicalKirFactModel {
  const facts = moduleFacts(artifact, profile).sort(
    (left, right) =>
      compareCodePoints(left.facet, right.facet) ||
      compareCodePoints(left.moduleId, right.moduleId) ||
      compareCodePoints(left.key, right.key) ||
      compareCodePoints(left.value, right.value),
  );
  return deepFreeze({ facts, semanticDigest: sha256(facts) });
}
