/**
 * React HTML element correctness — high-precision rules for common JSX
 * authoring footguns that ship to production:
 *   - controlled-input-no-onchange   — `<input value={x}>` is read-only without onChange
 *   - form-onsubmit-no-preventdefault — submit handler that doesn't preventDefault triggers a page reload
 *   - submit-button-implicit-type     — `<button>` inside a form submits implicitly without explicit type
 *   - target-blank-no-rel-noopener    — `<a target="_blank">` without rel="noopener noreferrer" leaks window.opener
 */

import type { JsxAttribute, JsxOpeningElement, JsxSelfClosingElement } from 'ts-morph';
import { Node, SyntaxKind } from 'ts-morph';
import type { ReviewFinding, RuleContext } from '../types.js';
import { finding, insertAfterSpan, shouldSkipHookRules } from './utils.js';

type JsxElementLike = JsxOpeningElement | JsxSelfClosingElement;

function getAttribute(jsx: JsxElementLike, name: string): JsxAttribute | undefined {
  for (const attr of jsx.getAttributes()) {
    if (Node.isJsxAttribute(attr) && attr.getNameNode().getText() === name) return attr;
  }
  return undefined;
}

/** True when an attribute exists with a defined initializer (`name="x"` or `name={x}`)
 *  vs. a bare boolean attribute or absent. Used to detect "value is set" vs. "value is missing". */
function hasAttributeWithValue(jsx: JsxElementLike, name: string): boolean {
  const attr = getAttribute(jsx, name);
  if (!attr) return false;
  return attr.getInitializer() !== undefined;
}

/** True when the attribute is present at all — bare boolean attributes count.
 *  Used for boolean modifier attrs like readOnly / disabled where shorthand `<input readOnly />` is common. */
function hasAttribute(jsx: JsxElementLike, name: string): boolean {
  return getAttribute(jsx, name) !== undefined;
}

function getAllJsxElements(ctx: RuleContext): JsxElementLike[] {
  return [
    ...ctx.sourceFile.getDescendantsOfKind(SyntaxKind.JsxOpeningElement),
    ...ctx.sourceFile.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement),
  ];
}

// ── Rule: controlled-input-no-onchange ──────────────────────────────────
// `<input value={x}>` / `<select value={x}>` / `<textarea value={x}>` without
// an onChange or readOnly attribute renders a read-only input that React
// warns about at runtime. defaultValue is fine — that is uncontrolled.

const CONTROLLABLE_TAGS = new Set(['input', 'select', 'textarea']);
/** Input types that don't carry a free-text value the user can edit — not controlled-input footguns. */
const NON_CONTROLLED_INPUT_TYPES = new Set(['button', 'submit', 'reset', 'hidden', 'file', 'image']);

function controlledInputNoOnChange(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  for (const jsx of getAllJsxElements(ctx)) {
    const tag = jsx.getTagNameNode().getText();
    if (!CONTROLLABLE_TAGS.has(tag)) continue;

    // For <input>, classify the controlled attribute by `type`.
    // checkbox/radio use `checked`; the non-controlled types skip the rule.
    let usesChecked = false;
    if (tag === 'input') {
      const typeAttr = getAttribute(jsx, 'type');
      const init = typeAttr?.getInitializer();
      if (init && Node.isStringLiteral(init)) {
        const t = init.getLiteralValue();
        if (NON_CONTROLLED_INPUT_TYPES.has(t)) continue;
        if (t === 'checkbox' || t === 'radio') usesChecked = true;
      }
    }

    if (usesChecked) {
      if (!hasAttributeWithValue(jsx, 'checked')) continue;
    } else {
      if (!hasAttributeWithValue(jsx, 'value')) continue;
    }
    if (hasAttributeWithValue(jsx, 'onChange')) continue;
    if (hasAttributeWithValue(jsx, 'onInput')) continue; // alternative event name some projects use
    if (hasAttribute(jsx, 'readOnly')) continue;
    if (hasAttribute(jsx, 'disabled')) continue;
    // Spread attributes can cover onChange — give them the benefit of the doubt
    if (jsx.getAttributes().some((a) => Node.isJsxSpreadAttribute(a))) continue;

    const controlledAttr = usesChecked ? 'checked' : 'value';
    findings.push(
      finding(
        'controlled-input-no-onchange',
        'warning',
        'bug',
        `<${tag} ${controlledAttr}={...}> without onChange creates a read-only field — React will warn at runtime and user input is silently dropped`,
        ctx.filePath,
        jsx.getStartLineNumber(),
        1,
        {
          suggestion:
            'Add an onChange handler that updates the bound state, or use defaultValue for an uncontrolled input, or add readOnly if the field is intentionally not editable',
        },
      ),
    );
  }

  return findings;
}

// ── Rule: form-onsubmit-no-preventdefault ───────────────────────────────
// `<form onSubmit={handler}>` where handler doesn't call e.preventDefault()
// triggers a page reload, defeating SPA behavior. Conservative: only flags
// when the handler is a local arrow/function expression (so we can read its
// body) AND there's no e.preventDefault() / event.preventDefault() call.

function flagsFormOnSubmitNoPreventDefault(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  for (const jsx of getAllJsxElements(ctx)) {
    if (jsx.getTagNameNode().getText() !== 'form') continue;
    const onSubmit = getAttribute(jsx, 'onSubmit');
    if (!onSubmit) continue;
    const init = onSubmit.getInitializer();
    if (!init || !Node.isJsxExpression(init)) continue;
    const expr = init.getExpression();
    if (!expr) continue;
    if (!Node.isArrowFunction(expr) && !Node.isFunctionExpression(expr)) continue;

    // Skip when action= or method= is also set — user clearly wants
    // native form submission (Gemini review: comment said "method" but
    // code only checked "action").
    if (hasAttributeWithValue(jsx, 'action')) continue;
    if (hasAttributeWithValue(jsx, 'method')) continue;

    const params = expr.getParameters();
    const eventName = params.length > 0 ? params[0].getName() : 'e';

    const body = expr.getBody();
    if (!body) continue;
    // AST-based preventDefault() detection (Gemini review: regex on text
    // matched commented-out calls). Walk all CallExpressions in the body
    // and look for any call whose property is named 'preventDefault'.
    let hasPreventDefault = false;
    for (const callExpr of body.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const callee = callExpr.getExpression();
      if (Node.isPropertyAccessExpression(callee)) {
        if (callee.getName() === 'preventDefault') {
          hasPreventDefault = true;
          break;
        }
      } else if (Node.isIdentifier(callee) && callee.getText() === 'preventDefault') {
        // destructured: const { preventDefault } = e; preventDefault();
        hasPreventDefault = true;
        break;
      }
    }
    if (hasPreventDefault) continue;

    findings.push(
      finding(
        'form-onsubmit-no-preventdefault',
        'warning',
        'bug',
        `<form onSubmit={...}> handler does not call ${eventName}.preventDefault() — the browser will perform a full-page navigation on submit`,
        ctx.filePath,
        onSubmit.getStartLineNumber(),
        1,
        {
          suggestion: `Call ${eventName}.preventDefault() at the top of the handler, or add an explicit action= attribute if a native submission is intended`,
        },
      ),
    );
  }

  return findings;
}

// ── Rule: submit-button-implicit-type ───────────────────────────────────
// `<button>` inside `<form>` without `type="..."` defaults to type="submit".
// A click on any such button inside the form triggers submission, which is
// almost never the intent for ancillary buttons (cancel, toggle, dropdown).

function submitButtonImplicitType(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  for (const jsx of getAllJsxElements(ctx)) {
    if (jsx.getTagNameNode().getText() !== 'button') continue;
    if (hasAttributeWithValue(jsx, 'type')) continue;
    // Spread attributes might supply type — be conservative
    if (jsx.getAttributes().some((a) => Node.isJsxSpreadAttribute(a))) continue;

    // Only fire when the button is structurally inside a <form> in the same JSX subtree.
    let inForm = false;
    let cur: Node | undefined = jsx.getParent();
    while (cur) {
      if (Node.isJsxElement(cur)) {
        const open = cur.getOpeningElement();
        if (open.getTagNameNode().getText() === 'form') {
          inForm = true;
          break;
        }
      }
      cur = cur.getParent();
    }
    if (!inForm) continue;

    findings.push(
      finding(
        'submit-button-implicit-type',
        'warning',
        'bug',
        '<button> inside <form> without an explicit type attribute defaults to type="submit" — clicks will submit the form',
        ctx.filePath,
        jsx.getStartLineNumber(),
        1,
        {
          suggestion: 'Add type="button" for ancillary controls, or type="submit" to make the intent explicit',
          autofix: {
            type: 'insert-after',
            span: insertAfterSpan(jsx.getTagNameNode(), ctx.filePath),
            replacement: ' type="button"',
            description: 'Insert type="button" — REVIEW: change to type="submit" if this IS the submit button',
          },
        },
      ),
    );
  }

  return findings;
}

// ── Rule: target-blank-no-rel-noopener ──────────────────────────────────
// `<a target="_blank">` without rel="noopener noreferrer" leaks window.opener
// to the destination page (tab-jacking) and prevents browser perf isolation.
// Modern browsers default to noopener for target="_blank", but the rule
// still fires because (a) older browsers don't and (b) the explicit attribute
// is the documented best practice.

function isBlankTarget(attr: JsxAttribute): boolean {
  const init = attr.getInitializer();
  if (!init) return false;
  if (Node.isStringLiteral(init)) return init.getLiteralValue() === '_blank';
  if (Node.isJsxExpression(init)) {
    const expr = init.getExpression();
    if (expr && Node.isStringLiteral(expr)) return expr.getLiteralValue() === '_blank';
    if (expr && Node.isNoSubstitutionTemplateLiteral(expr)) return expr.getLiteralValue() === '_blank';
  }
  return false;
}

function relIncludesNoopener(attr: JsxAttribute): boolean {
  const init = attr.getInitializer();
  if (!init) return false;
  let value: string | undefined;
  if (Node.isStringLiteral(init)) value = init.getLiteralValue();
  if (Node.isJsxExpression(init)) {
    const expr = init.getExpression();
    if (expr && Node.isStringLiteral(expr)) value = expr.getLiteralValue();
    if (expr && Node.isNoSubstitutionTemplateLiteral(expr)) value = expr.getLiteralValue();
  }
  if (!value) return false;
  const tokens = value.split(/\s+/);
  return tokens.includes('noopener') || tokens.includes('noreferrer');
}

function targetBlankNoRelNoopener(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  for (const jsx of getAllJsxElements(ctx)) {
    if (jsx.getTagNameNode().getText() !== 'a') continue;

    const targetAttr = getAttribute(jsx, 'target');
    if (!targetAttr || !isBlankTarget(targetAttr)) continue;

    const relAttr = getAttribute(jsx, 'rel');
    if (relAttr && relIncludesNoopener(relAttr)) continue;
    // Spread attributes might supply rel — be conservative
    if (jsx.getAttributes().some((a) => Node.isJsxSpreadAttribute(a))) continue;

    findings.push(
      finding(
        'target-blank-no-rel-noopener',
        'warning',
        'bug',
        '<a target="_blank"> without rel="noopener noreferrer" — opened tab can navigate the opener (tab-jacking) and degrades browser process isolation',
        ctx.filePath,
        jsx.getStartLineNumber(),
        1,
        {
          suggestion: 'Add rel="noopener noreferrer" to any anchor that opens a new tab',
          autofix: relAttr
            ? undefined
            : {
                type: 'insert-after',
                span: insertAfterSpan(targetAttr, ctx.filePath),
                replacement: ' rel="noopener noreferrer"',
                description: 'Insert rel="noopener noreferrer"',
              },
        },
      ),
    );
  }

  return findings;
}

// ── Exported HTML-quality rules ─────────────────────────────────────────

/** All rules in this file assume a client runtime — skip on server/api/middleware
 *  unless the file still has React content (JSX / react import / hook call). */
function clientOnly<T extends (ctx: RuleContext) => ReviewFinding[]>(fn: T): T {
  return ((ctx: RuleContext) => (shouldSkipHookRules(ctx) ? [] : fn(ctx))) as T;
}

export const reactHtmlRules = [
  clientOnly(controlledInputNoOnChange),
  clientOnly(flagsFormOnSubmitNoPreventDefault),
  clientOnly(submitButtonImplicitType),
  clientOnly(targetBlankNoRelNoopener),
];
