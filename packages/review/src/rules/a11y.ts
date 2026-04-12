/**
 * Accessibility rules (WCAG 2.1 high-signal subset).
 *
 * Mirrors eslint-plugin-jsx-a11y rule shapes but kept intentionally small —
 * only the checks that have a clear right answer and low false-positive rate.
 */

import { Node, SyntaxKind } from 'ts-morph';
import type { JsxAttribute, JsxOpeningElement, JsxSelfClosingElement } from 'ts-morph';
import type { ReviewFinding, RuleContext } from '../types.js';
import { finding } from './utils.js';

// ARIA 1.2 valid role values (subset covering the common ones).
// Source: https://www.w3.org/TR/wai-aria-1.2/#role_definitions
const VALID_ROLES = new Set([
  // Landmark
  'banner',
  'complementary',
  'contentinfo',
  'form',
  'main',
  'navigation',
  'region',
  'search',
  // Document structure
  'article',
  'cell',
  'columnheader',
  'definition',
  'directory',
  'document',
  'feed',
  'figure',
  'group',
  'heading',
  'img',
  'list',
  'listitem',
  'math',
  'none',
  'note',
  'presentation',
  'row',
  'rowgroup',
  'rowheader',
  'separator',
  'table',
  'term',
  'toolbar',
  'tooltip',
  // Widget
  'alert',
  'alertdialog',
  'application',
  'button',
  'checkbox',
  'combobox',
  'dialog',
  'grid',
  'gridcell',
  'link',
  'log',
  'marquee',
  'menu',
  'menubar',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'progressbar',
  'radio',
  'radiogroup',
  'scrollbar',
  'searchbox',
  'slider',
  'spinbutton',
  'status',
  'switch',
  'tab',
  'tablist',
  'tabpanel',
  'textbox',
  'timer',
  'tree',
  'treegrid',
  'treeitem',
  // Live region
  'log',
  'marquee',
  'status',
  'timer',
]);

const INTERACTIVE_EVENTS = new Set([
  'onClick',
  'onKeyDown',
  'onKeyUp',
  'onKeyPress',
  'onMouseDown',
  'onMouseUp',
  'onTouchStart',
  'onTouchEnd',
]);

const NON_INTERACTIVE_ELEMENTS = new Set(['div', 'span', 'section', 'article', 'li', 'p', 'td', 'th']);

type JsxElementLike = JsxOpeningElement | JsxSelfClosingElement;

function getTagName(el: JsxElementLike): string {
  return el.getTagNameNode().getText();
}

function getAttr(el: JsxElementLike, name: string): JsxAttribute | undefined {
  for (const attr of el.getAttributes()) {
    if (Node.isJsxAttribute(attr) && attr.getNameNode().getText() === name) {
      return attr;
    }
  }
  return undefined;
}

function hasAttr(el: JsxElementLike, name: string): boolean {
  return getAttr(el, name) !== undefined;
}

function hasAnyAttr(el: JsxElementLike, names: string[]): boolean {
  return names.some((n) => hasAttr(el, n));
}

function* iterJsxElements(ctx: RuleContext): Generator<JsxElementLike> {
  for (const el of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.JsxOpeningElement)) {
    yield el;
  }
  for (const el of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement)) {
    yield el;
  }
}

// ── Rule: img-missing-alt ────────────────────────────────────────────────

function imgMissingAlt(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  for (const el of iterJsxElements(ctx)) {
    const tag = getTagName(el);
    // Cover both <img> and next/image <Image>
    if (tag !== 'img' && tag !== 'Image') continue;

    // alt="" is valid (decorative image); only flag missing alt
    if (hasAttr(el, 'alt')) continue;
    // Role presentation / none exempts from alt requirement
    const role = getAttr(el, 'role')?.getInitializer();
    if (role && Node.isStringLiteral(role) && (role.getLiteralValue() === 'presentation' || role.getLiteralValue() === 'none')) {
      continue;
    }
    // aria-hidden="true" also exempts
    if (hasAttr(el, 'aria-hidden')) continue;

    findings.push(
      finding(
        'img-missing-alt',
        'error',
        'bug',
        `<${tag}> is missing an alt attribute — screen readers will skip or read the filename`,
        ctx.filePath,
        el.getStartLineNumber(),
        1,
        { suggestion: 'Add alt="description" for meaningful images, or alt="" for decorative images' },
      ),
    );
  }
  return findings;
}

// ── Rule: button-missing-name ────────────────────────────────────────────

function buttonMissingName(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  for (const el of iterJsxElements(ctx)) {
    const tag = getTagName(el);
    if (tag !== 'button') continue;

    // Accept any form of accessible name
    if (hasAnyAttr(el, ['aria-label', 'aria-labelledby', 'title'])) continue;

    // Self-closing <button /> is always unnamed
    if (Node.isJsxSelfClosingElement(el)) {
      findings.push(
        finding(
          'button-missing-name',
          'error',
          'bug',
          '<button /> has no accessible name — add text children, aria-label, or aria-labelledby',
          ctx.filePath,
          el.getStartLineNumber(),
          1,
          { suggestion: 'Add text children, aria-label="Close", or reference a label with aria-labelledby' },
        ),
      );
      continue;
    }

    // For <button>...</button> check children for text / svg with title
    const parent = el.getParent();
    if (!parent) continue;
    if (!Node.isJsxElement(parent)) continue;

    const children = parent.getJsxChildren();
    let hasTextLikeContent = false;
    for (const child of children) {
      if (Node.isJsxText(child) && child.getText().trim().length > 0) {
        hasTextLikeContent = true;
        break;
      }
      if (Node.isJsxExpression(child)) {
        // Any expression child counts — we can't prove it's empty without eval
        hasTextLikeContent = true;
        break;
      }
      if (Node.isJsxElement(child) || Node.isJsxSelfClosingElement(child)) {
        // Nested element might contain accessible content — don't flag
        hasTextLikeContent = true;
        break;
      }
    }

    if (!hasTextLikeContent) {
      findings.push(
        finding(
          'button-missing-name',
          'error',
          'bug',
          '<button> has no accessible name — empty children and no aria-label',
          ctx.filePath,
          el.getStartLineNumber(),
          1,
          { suggestion: 'Add text children, aria-label="Close", or reference a label with aria-labelledby' },
        ),
      );
    }
  }
  return findings;
}

// ── Rule: label-missing-for ──────────────────────────────────────────────

function labelMissingFor(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  for (const el of iterJsxElements(ctx)) {
    const tag = getTagName(el);
    if (tag !== 'label') continue;

    if (hasAnyAttr(el, ['htmlFor', 'for'])) continue;

    // <label><input /></label> — nested control is fine
    const parent = el.getParent();
    if (parent && Node.isJsxElement(parent)) {
      const hasNestedControl = parent
        .getDescendants()
        .some((d) => {
          if (!Node.isJsxSelfClosingElement(d) && !Node.isJsxOpeningElement(d)) return false;
          const name = d.getTagNameNode().getText();
          return name === 'input' || name === 'select' || name === 'textarea';
        });
      if (hasNestedControl) continue;
    }

    findings.push(
      finding(
        'label-missing-for',
        'warning',
        'bug',
        '<label> is not associated with a form control — add htmlFor={id} or nest the control inside the label',
        ctx.filePath,
        el.getStartLineNumber(),
        1,
        { suggestion: 'Add htmlFor="input-id" matching the id prop of the associated input' },
      ),
    );
  }
  return findings;
}

// ── Rule: aria-invalid-role ──────────────────────────────────────────────

function ariaInvalidRole(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  for (const el of iterJsxElements(ctx)) {
    const roleAttr = getAttr(el, 'role');
    if (!roleAttr) continue;
    const init = roleAttr.getInitializer();
    if (!init || !Node.isStringLiteral(init)) continue; // Skip expression roles — can't statically validate

    const value = init.getLiteralValue();
    // role can be space-separated fallback list
    const roles = value.split(/\s+/).filter(Boolean);
    for (const r of roles) {
      if (!VALID_ROLES.has(r)) {
        findings.push(
          finding(
            'aria-invalid-role',
            'error',
            'bug',
            `role="${r}" is not a valid ARIA role — assistive tech will ignore the element`,
            ctx.filePath,
            roleAttr.getStartLineNumber(),
            1,
            { suggestion: `Use a valid ARIA role from the WAI-ARIA 1.2 spec, or remove the role to use the element's implicit role` },
          ),
        );
        break; // one finding per element
      }
    }
  }
  return findings;
}

// ── Rule: interactive-noninteractive ─────────────────────────────────────

function interactiveNonInteractive(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  for (const el of iterJsxElements(ctx)) {
    const tag = getTagName(el);
    if (!NON_INTERACTIVE_ELEMENTS.has(tag)) continue;

    let interactiveEvent: string | undefined;
    for (const attr of el.getAttributes()) {
      if (!Node.isJsxAttribute(attr)) continue;
      const name = attr.getNameNode().getText();
      if (INTERACTIVE_EVENTS.has(name)) {
        interactiveEvent = name;
        break;
      }
    }
    if (!interactiveEvent) continue;

    // Exempt if role + tabIndex present
    const hasRole = hasAttr(el, 'role');
    const hasTabIndex = hasAttr(el, 'tabIndex') || hasAttr(el, 'tabindex');
    if (hasRole && hasTabIndex) continue;

    findings.push(
      finding(
        'interactive-noninteractive',
        'warning',
        'bug',
        `<${tag}> has ${interactiveEvent} but is not keyboard-accessible — keyboard users cannot focus or activate it`,
        ctx.filePath,
        el.getStartLineNumber(),
        1,
        {
          suggestion: `Use a <button> element, or add role="button" and tabIndex={0} plus an onKeyDown handler that maps Enter/Space to the same action`,
        },
      ),
    );
  }
  return findings;
}

// ── Exported a11y rules ──────────────────────────────────────────────────

export const a11yRules = [imgMissingAlt, buttonMissingName, labelMissingFor, ariaInvalidRole, interactiveNonInteractive];
