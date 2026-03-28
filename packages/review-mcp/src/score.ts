/**
 * Security Score Engine for KERN MCP Security.
 *
 * Pure computation — zero VS Code imports. Must work in worker thread.
 *
 * Score formula:
 *   Guard coverage:    40% — % of effects with preceding guards
 *   Input validation:  25% — % of action handlers with validation guards
 *   Rule compliance:   20% — 100 - (criticals × 10) - (warnings × 5)
 *   Auth posture:      15% — auth guards present for HTTP/SSE transport
 */

interface IRNode {
  type: string;
  loc?: { line: number; col: number };
  props?: Record<string, unknown>;
  children?: IRNode[];
}

interface Finding {
  ruleId: string;
  severity: 'error' | 'warning' | 'info';
}

export interface ToolScore {
  toolName: string;
  effects: number;
  guards: number;
  guardCoverage: number;
  hasValidation: boolean;
  hasAuth: boolean;
  total: number;
  grade: Grade;
}

export type Grade = 'A' | 'B' | 'C' | 'D' | 'F';

export interface SecurityScore {
  total: number;
  grade: Grade;
  guardCoverage: number;
  inputValidation: number;
  ruleCompliance: number;
  authPosture: number;
  perTool: ToolScore[];
}

function toGrade(score: number): Grade {
  if (score >= 90) return 'A';
  if (score >= 75) return 'B';
  if (score >= 60) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

export function gradeColor(grade: Grade): string {
  switch (grade) {
    case 'A': return '#22c55e';
    case 'B': return '#84cc16';
    case 'C': return '#f97316';
    case 'D': return '#f59e0b';
    case 'F': return '#ef4444';
  }
}

export function computeSecurityScore(irNodes: IRNode[], findings: Finding[]): SecurityScore {
  const actions = irNodes.filter(n => n.type === 'action');

  let totalEffects = 0;
  let guardedEffects = 0;
  for (const action of actions) {
    const children = action.children ?? [];
    const effects = children.filter(c => c.type === 'effect');
    const guards = children.filter(c => c.type === 'guard');
    totalEffects += effects.length;
    guardedEffects += Math.min(guards.length, effects.length);
  }
  const guardCoverage = totalEffects === 0 ? 100 : Math.round((guardedEffects / totalEffects) * 100);

  const actionsWithEffects = actions.filter(a => (a.children ?? []).some(c => c.type === 'effect'));
  let inputValidation: number;
  if (actionsWithEffects.length === 0) {
    inputValidation = 100;
  } else {
    const validated = actionsWithEffects.filter(a =>
      (a.children ?? []).some(c => c.type === 'guard' && c.props?.kind === 'validation'));
    inputValidation = Math.round((validated.length / actionsWithEffects.length) * 100);
  }

  const criticals = findings.filter(f => f.severity === 'error').length;
  const warnings = findings.filter(f => f.severity === 'warning').length;
  const ruleCompliance = Math.max(0, 100 - (criticals * 10) - (warnings * 5));

  const hasNetworkEffects = actions.some(a =>
    (a.children ?? []).some(c => c.type === 'effect' && c.props?.kind === 'network'));
  const hasMissingAuth = findings.some(f => f.ruleId === 'mcp-missing-auth');
  let authPosture: number;
  if (!hasNetworkEffects) {
    authPosture = 100;
  } else {
    const hasAuthGuard = actions.some(a =>
      (a.children ?? []).some(c => c.type === 'guard' && c.props?.kind === 'auth'));
    authPosture = (hasAuthGuard && !hasMissingAuth) ? 100 : 0;
  }

  const total = Math.round(
    guardCoverage * 0.40 +
    inputValidation * 0.25 +
    ruleCompliance * 0.20 +
    authPosture * 0.15,
  );
  const grade = toGrade(total);

  const perTool: ToolScore[] = actions.map(action => {
    const name = (action.props?.name as string) || 'unknown';
    const children = action.children ?? [];
    const effects = children.filter(c => c.type === 'effect');
    const guards = children.filter(c => c.type === 'guard');
    const toolGuardCov = effects.length === 0 ? 100 : Math.round((Math.min(guards.length, effects.length) / effects.length) * 100);
    const hasValidation = guards.some(g => g.props?.kind === 'validation');
    const hasAuth = guards.some(g => g.props?.kind === 'auth');
    const toolTotal = Math.round(
      toolGuardCov * 0.60 +
      (hasValidation ? 100 : 0) * 0.25 +
      (hasAuth ? 100 : 0) * 0.15,
    );

    return {
      toolName: name,
      effects: effects.length,
      guards: guards.length,
      guardCoverage: toolGuardCov,
      hasValidation,
      hasAuth,
      total: toolTotal,
      grade: toGrade(toolTotal),
    };
  });

  return {
    total,
    grade,
    guardCoverage,
    inputValidation,
    ruleCompliance,
    authPosture,
    perTool,
  };
}
