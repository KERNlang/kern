import type { ConceptNode } from '@kernlang/core';
import { conceptId } from '@kernlang/core';
import type Parser from 'tree-sitter';
import { getContainerId, nodeSpan, nodeText, walkNodes } from '../helpers/ast.js';

export function extractGuards(root: Parser.SyntaxNode, source: string, filePath: string, nodes: ConceptNode[]): void {
  // 1. Auth decorators (tree-sitter: decorated_definition → decorator + function_definition)
  walkNodes(root, 'decorated_definition', (node) => {
    for (const child of node.children) {
      if (child.type !== 'decorator') continue;
      const decText = source.substring(child.startIndex, child.endIndex);
      if (/@(login_required|requires_auth|permission_required|auth_required|authenticated)/.test(decText)) {
        nodes.push({
          id: conceptId(filePath, 'guard', child.startIndex),
          kind: 'guard',
          primarySpan: nodeSpan(filePath, child),
          evidence: nodeText(source, child, 100),
          confidence: 1.0,
          language: 'py',
          containerId: getContainerId(node, filePath),
          payload: {
            kind: 'guard',
            subtype: 'auth',
            name: decText.replace('@', '').split('(')[0].trim(),
          },
        });
      }
    }
  });

  // 2. Pydantic validation: BaseModel.model_validate()
  walkNodes(root, 'call', (node) => {
    const func = node.childForFieldName('function');
    if (func?.text.includes('model_validate')) {
      nodes.push({
        id: conceptId(filePath, 'guard', node.startIndex),
        kind: 'guard',
        primarySpan: nodeSpan(filePath, node),
        evidence: nodeText(source, node, 100),
        confidence: 0.9,
        language: 'py',
        containerId: getContainerId(node, filePath),
        payload: { kind: 'guard', subtype: 'validation', name: 'pydantic' },
      });
    }
  });

  // 3. FastAPI `Depends(...)` injection — route handler parameter with a
  //    `Depends` default is the idiomatic FastAPI auth/validation guard.
  //    Example:
  //      @router.get("/me")
  //      def me(user: User = Depends(get_current_user)):
  //    Classified by the dependency function name:
  //      - `get_current_user` / `current_user` / `require_auth` / `*_user` → 'auth'
  //      - `verify_*` / `validate_*` → 'validation'
  //      - `rate_limit_*` / `check_rate_limit` → 'rate-limit'
  //      - everything else → 'policy'
  //    Feeds the `auth-drift` cross-stack rule.
  walkNodes(root, 'default_parameter', (node) => {
    const val = node.childForFieldName('value');
    if (!val || val.type !== 'call') return;
    const func = val.childForFieldName('function');
    if (!func || func.text !== 'Depends') return;
    const args = val.childForFieldName('arguments');
    if (!args) return;
    const posArg = args.namedChildren.find((c) => c.type === 'identifier' || c.type === 'attribute');
    const depName = posArg ? posArg.text : 'Depends';
    const subtype = classifyDependency(depName);
    nodes.push({
      id: conceptId(filePath, 'guard', node.startIndex),
      kind: 'guard',
      primarySpan: nodeSpan(filePath, node),
      evidence: nodeText(source, node, 120),
      confidence: 0.85,
      language: 'py',
      containerId: getContainerId(node, filePath),
      payload: { kind: 'guard', subtype, name: depName },
    });
  });

  // 4. Early return/raise after auth check: if not request.user: raise/return
  walkNodes(root, 'if_statement', (node) => {
    const cond = node.childForFieldName('condition');
    if (cond && /\b(user|auth|request\.user)\b/.test(cond.text)) {
      const block = node.namedChildren.find((c) => c.type === 'block');
      if (block) {
        const firstStmt = block.namedChildren[0];
        if (firstStmt && (firstStmt.type === 'return_statement' || firstStmt.type === 'raise_statement')) {
          nodes.push({
            id: conceptId(filePath, 'guard', node.startIndex),
            kind: 'guard',
            primarySpan: nodeSpan(filePath, node),
            evidence: nodeText(source, node, 100),
            confidence: 0.8,
            language: 'py',
            containerId: getContainerId(node, filePath),
            payload: { kind: 'guard', subtype: 'auth' },
          });
        }
      }
    }
  });
}

function classifyDependency(depName: string): 'auth' | 'validation' | 'rate-limit' | 'policy' {
  // Strip module prefix (`auth.get_current_user` → `get_current_user`) so the
  // heuristic looks at the final identifier where intent usually lives.
  const tail = depName.split('.').pop() ?? depName;
  if (/^(get_current_user|current_user|require_auth|authenticated|is_authenticated)$/i.test(tail)) return 'auth';
  if (/_user$|^user$|auth/i.test(tail)) return 'auth';
  if (/^(verify_|validate_)/i.test(tail)) return 'validation';
  if (/rate_?limit/i.test(tail)) return 'rate-limit';
  return 'policy';
}
