/**
 * Markdown analyzer + outline extractor — parallel non-ts-morph analysis
 * path for `.md` files. Produces two outputs from a single parse:
 *
 *   1. ReviewFinding[] — structural issues (skipped heading levels, missing
 *      image alt text). Flow through the engine's standard pipeline so both
 *      kern-sight (editor diagnostics) and kern-guard (Check annotations)
 *      consume them without API changes.
 *
 *   2. MarkdownOutline — heading tree shaped for kern-sight's Current File
 *      webview. Exported separately because kern-guard has no use for it
 *      (only findings get posted to GitHub); keeping it off the engine's
 *      ReviewReport keeps the worker-side surface minimal.
 *
 * Broken-link / fs-existence checks are intentionally deferred. They need
 * project-root knowledge and edge-case handling for anchors / absolute /
 * external URLs — a Phase 2 follow-up where ProjectContext is threaded in.
 *
 * Fingerprint policy mirrors json.ts: structural keys (heading path,
 * image alt-text bucket), NEVER line numbers, so kern-guard's baseline
 * dedup does not re-post on whitespace edits.
 */

import type { Heading, Image, Root, RootContent } from 'mdast';
import { fromMarkdown } from 'mdast-util-from-markdown';
import type { ReviewFinding, SourceSpan } from '../types.js';

/** A single heading in the outline tree, with nesting. */
export interface MarkdownOutlineHeading {
  level: 1 | 2 | 3 | 4 | 5 | 6;
  text: string;
  /** GitHub-style slug (lowercase, hyphenated, alphanumerics + hyphens). */
  slug: string;
  /** 1-based start line of the heading marker. */
  line: number;
  children: MarkdownOutlineHeading[];
}

export interface MarkdownOutline {
  /** Flat list of headings in source order. */
  flat: MarkdownOutlineHeading[];
  /** Nested heading tree (each heading owns the higher-level headings under it). */
  tree: MarkdownOutlineHeading[];
}

/** Extract inline text from a heading node. mdast headings can contain
 *  inline code, emphasis, links — flatten to a plain string for the outline. */
function inlineText(node: { children?: unknown[] }): string {
  const parts: string[] = [];
  function walk(n: { value?: unknown; children?: unknown[] }) {
    if (typeof n.value === 'string') parts.push(n.value);
    const kids = n.children;
    if (Array.isArray(kids)) {
      for (const k of kids) walk(k as { value?: unknown; children?: unknown[] });
    }
  }
  walk(node);
  return parts.join('').trim();
}

/** GitHub-style heading slug — lowercase, strip non-letter / non-digit
 *  punctuation across the full Unicode range (so `Café`, `中文`, `Привет`
 *  survive), then replace each whitespace char (not runs) with one hyphen.
 *  Per-char (not collapsed) replacement matches GitHub's behavior: "API &
 *  Usage" becomes "api--usage" because `&` is dropped while both
 *  surrounding spaces survive as separate hyphens.
 *
 *  The `/u` flag enables Unicode property escapes — without it, `\w`
 *  matches only `[A-Za-z0-9_]` and non-Latin letters are stripped,
 *  collapsing headings like `## 中文` to an empty slug. */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s/g, '-');
}

/** Convert mdast point.line (already 1-based) safely. */
function startLineOf(node: { position?: { start?: { line?: number } } }): number {
  return node.position?.start?.line ?? 1;
}

function spanFromNode(
  filePath: string,
  node: { position?: { start?: { line?: number; column?: number }; end?: { line?: number; column?: number } } },
): SourceSpan {
  const sl = node.position?.start?.line ?? 1;
  const sc = node.position?.start?.column ?? 1;
  const el = node.position?.end?.line ?? sl;
  const ec = node.position?.end?.column ?? sc + 1;
  return { file: filePath, startLine: sl, startCol: sc, endLine: el, endCol: ec };
}

/** Type guard for mdast parent-like nodes (those that may carry `children`).
 *  Used by `walkNodes` instead of bare `as RootContent` casts so a malformed
 *  AST (e.g. caller passing in something that isn't mdast) cannot silently
 *  invoke the visitor with a non-node value. */
function isMdastNode(value: unknown): value is { type: string; children?: unknown[] } {
  return typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string';
}

/** Walk children of an mdast Root or Parent recursively. Visitor sees one
 *  call per descendant. Mixed-leaf nodes (text, code, image) without
 *  children short-circuit; the type guard prevents bogus visits. */
function walkNodes(root: Root, visit: (node: RootContent) => void) {
  function go(node: { children?: unknown[] }) {
    const kids = node.children;
    if (!Array.isArray(kids)) return;
    for (const k of kids) {
      if (!isMdastNode(k)) continue;
      visit(k as RootContent);
      go(k);
    }
  }
  go(root);
}

/**
 * Parse markdown once and emit both findings and outline. Internal — public
 * entry points (`reviewMarkdownFile`, `extractMarkdownOutline`) share this.
 */
function analyze(source: string, filePath: string): { findings: ReviewFinding[]; outline: MarkdownOutline } {
  const tree = fromMarkdown(source);

  const headings: Heading[] = [];
  const images: Image[] = [];
  walkNodes(tree, (n) => {
    if (n.type === 'heading') headings.push(n);
    else if (n.type === 'image') images.push(n);
  });

  const findings: ReviewFinding[] = [];

  // ── Skipped heading levels ──────────────────────────────────────────
  // h1 → h3 is a structural smell (screen-readers, TOC generators get confused).
  // The first heading sets the baseline; after that, level must not jump by
  // more than 1 deeper. Going shallower (h3 → h2) is always fine.
  //
  // The running heading path tracks (level, slug) tuples — NOT just slugs by
  // index. The naive `length >= depth` pop is wrong when levels are skipped:
  // after `# A` + `### B`, the stack length is 2 but B is at depth 3, so a
  // subsequent sibling `### B2` would not pop B and would instead nest
  // *under* B. That would make B2's fingerprint depend on B's text, so
  // renaming B would change B2's fingerprint — kern-guard would re-post B2
  // as a "new" finding on the next PR. Comparing on `.level` avoids that.
  let prevLevel: number | null = null;
  const headingPath: Array<{ level: number; slug: string }> = [];
  for (const h of headings) {
    const text = inlineText(h);
    const slug = slugify(text) || `heading-${startLineOf(h)}`;

    while (headingPath.length > 0 && headingPath[headingPath.length - 1]!.level >= h.depth) {
      headingPath.pop();
    }
    headingPath.push({ level: h.depth, slug });

    if (prevLevel !== null && h.depth > prevLevel + 1) {
      const ruleId = 'md/skipped-heading-level';
      const path = headingPath.map((p) => p.slug).join('/');
      findings.push({
        source: 'kern',
        ruleId,
        severity: 'warning',
        category: 'structure',
        message: `Heading jumps from h${prevLevel} to h${h.depth} — skipping levels breaks document outline and assistive tech navigation.`,
        primarySpan: spanFromNode(filePath, h),
        confidence: 95,
        fingerprint: `${ruleId}:${path}`,
      });
    }
    prevLevel = h.depth;
  }

  // ── Images missing alt text ─────────────────────────────────────────
  // Empty alt text on an image is an a11y red flag. Decorative images
  // should use alt="" intentionally; mdast can't distinguish, so we flag
  // all empty-alt images and let the author confirm/suppress.
  let imageIdx = 0;
  for (const img of images) {
    const alt = (img.alt ?? '').trim();
    if (alt.length === 0) {
      const ruleId = 'md/image-missing-alt';
      // Fingerprint by URL when present (stable across line shifts), index fallback otherwise.
      const key = img.url || `idx-${imageIdx}`;
      findings.push({
        source: 'kern',
        ruleId,
        severity: 'warning',
        category: 'structure',
        message: `Image is missing alt text${img.url ? ` (\`${img.url}\`)` : ''}. Provide a description, or use \`![](…)\` only for purely decorative images.`,
        primarySpan: spanFromNode(filePath, img),
        confidence: 90,
        fingerprint: `${ruleId}:${key}`,
      });
    }
    imageIdx++;
  }

  // ── Build outline ───────────────────────────────────────────────────
  const flat: MarkdownOutlineHeading[] = headings.map((h) => ({
    level: h.depth as MarkdownOutlineHeading['level'],
    text: inlineText(h),
    slug: slugify(inlineText(h)) || `heading-${startLineOf(h)}`,
    line: startLineOf(h),
    children: [],
  }));

  // Nest into a tree by level — each heading owns subsequent deeper-level
  // headings until a shallower heading closes the chain. Standard outline algo.
  const outlineTree: MarkdownOutlineHeading[] = [];
  const stack: MarkdownOutlineHeading[] = [];
  for (const h of flat) {
    while (stack.length > 0 && stack[stack.length - 1]!.level >= h.level) stack.pop();
    if (stack.length === 0) outlineTree.push(h);
    else stack[stack.length - 1]!.children.push(h);
    stack.push(h);
  }

  return { findings, outline: { flat, tree: outlineTree } };
}

/** Entry point for the engine dispatcher — findings only. */
export function reviewMarkdownFile(source: string, filePath: string): ReviewFinding[] {
  return analyze(source, filePath).findings;
}

/** Public outline extractor — kern-sight only. */
export function extractMarkdownOutline(source: string): MarkdownOutline {
  return analyze(source, '<inline>').outline;
}
