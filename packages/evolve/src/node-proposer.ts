/**
 * Node Proposer — generates IR node proposals from structural gap patterns.
 *
 * Deterministic: no LLM needed (--llm is optional enhancement).
 * Maps detected structural patterns to proposed KERN node types.
 */

import type { AnalyzedPattern, ExpressibilityScore, NodeProposal } from './types.js';

let _nodeProposalCounter = 0;

function nextNodeProposalId(): string {
  return `node-proposal-${++_nodeProposalCounter}`;
}

export function resetNodeProposalIds(): void {
  _nodeProposalCounter = 0;
}

/**
 * Derive a KERN node name from a structural pattern's detector ID.
 */
export function deriveNodeName(pattern: AnalyzedPattern): string {
  // Strip gap- prefix and trailing counter: gap-structural-model-1 → structural-model
  const detectorId = pattern.gapIds[0]?.replace(/^gap-/, '').replace(/-\d+$/, '') || pattern.templateName;

  const nameMap: Record<string, string> = {
    'structural-model': 'model',
    'structural-repository': 'repository',
    'structural-dependency': 'dependency',
    'structural-cache': 'cache',
    'structural-conditional': 'conditional',
    'structural-select': 'select',
  };

  // Direct match on stripped detector ID
  if (nameMap[detectorId]) return nameMap[detectorId];

  // Try to match from template name
  for (const [prefix, name] of Object.entries(nameMap)) {
    if (pattern.templateName.includes(prefix.replace('structural-', ''))) {
      return name;
    }
  }

  // Fallback: derive from template name
  const cleaned = pattern.templateName.replace(/^structural-?/, '').replace(/-\w+$/, '');
  return cleaned || 'unknown';
}

/**
 * Generate example KERN syntax for a proposed node.
 */
export function generateKernSyntaxExample(nodeName: string, _pattern: AnalyzedPattern): string {
  const examples: Record<string, string> = {
    model: [
      `model name=Example table=examples`,
      `  column name=id type=uuid primary=true`,
      `  column name=name type=string`,
    ].join('\n'),
    repository: [
      `repository name=ExampleRepo model=Example`,
      `  method name=findById params="id:string" returns="Example|null"`,
      `    handler <<<return this.findOne({ id });>>>`,
    ].join('\n'),
    dependency: [
      `dependency name=exampleService scope=singleton`,
      `  inject name=repo type=ExampleRepository`,
      `  returns ExampleService with=repo`,
    ].join('\n'),
    cache: [
      `cache name=exampleCache backend=redis prefix="ex:" ttl=3600`,
      `  entry name=item key="ex:{id}"`,
      `    strategy read-through`,
    ].join('\n'),
    conditional: [`conditional if=isEnabled`, `  text value="Feature enabled"`].join('\n'),
    select: [
      `select name=status value=current placeholder="Choose"`,
      `  option value=active label="Active"`,
      `  option value=inactive label="Inactive"`,
    ].join('\n'),
  };

  return examples[nodeName] || `${nodeName} name=example\n  // TODO: define syntax`;
}

/**
 * Generate a codegen stub for a proposed node.
 */
export function generateCodegenStub(nodeName: string, _pattern: AnalyzedPattern): string {
  const fnName = `generate${nodeName[0].toUpperCase()}${nodeName.slice(1)}`;
  return [
    `export function ${fnName}(node: IRNode): string[] {`,
    `  const props = p(node);`,
    `  const name = props.name as string;`,
    `  const lines: string[] = [];`,
    `  // TODO: implement codegen for ${nodeName}`,
    `  lines.push(\`// ${nodeName}: \${name}\`);`,
    `  return lines;`,
    `}`,
  ].join('\n');
}

/**
 * Propose new IR nodes from analyzed structural patterns.
 *
 * Each pattern with an expressibility score above the threshold
 * gets a deterministic node proposal.
 */
export function proposeNodes(patterns: AnalyzedPattern[], scores: Map<string, ExpressibilityScore>): NodeProposal[] {
  const proposals: NodeProposal[] = [];

  for (const pattern of patterns) {
    const score = scores.get(pattern.structuralHash);
    if (!score) continue;

    const nodeName = deriveNodeName(pattern);
    const kernSyntax = generateKernSyntaxExample(nodeName, pattern);
    const codegenStub = generateCodegenStub(nodeName, pattern);

    proposals.push({
      id: nextNodeProposalId(),
      nodeName,
      kernSyntax,
      codegenStub,
      targetStubs: {},
      expressibilityScore: score,
      frequency: pattern.instanceCount,
      qualityScore: pattern.qualityScore.overallScore,
      supportingGapIds: pattern.gapIds,
    });
  }

  // Sort by quality score descending
  proposals.sort((a, b) => b.qualityScore - a.qualityScore);
  return proposals;
}
