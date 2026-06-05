/**
 * Markdown analyzer + outline extractor — self-contained line scanner.
 *
 * Replaces the previous `mdast-util-from-markdown` dependency (which pulled
 * ~30 transitive `micromark-*` packages) with a focused state machine. The
 * tradeoff is deliberate: this is NOT a CommonMark parser. It is a config /
 * docs hygiene scanner that covers exactly what kern-sight and kern-guard
 * need today —
 *
 *   • ATX headings (`#` through `######`) outside fenced code
 *   • Image syntax `![alt](url)` on a non-code line
 *   • Fenced-code awareness (backtick and tilde fences, length-matched)
 *   • Outline tree built from heading levels + slugs
 *
 * What we deliberately do NOT handle, because feature surface stays small:
 *
 *   • Setext headings (`===` / `---` underlines) — uncommon in this codebase
 *   • Inline HTML headings (`<h1>…</h1>`)
 *   • Reference-style images (`![alt][label]` + `[label]: url`)
 *   • Indented (4-space) code blocks
 *   • Tab handling beyond the obvious cases
 *   • Inline code spans (`` `![](url)` ``) — image syntax inside backtick
 *     spans on an otherwise non-fenced line can trip the image-alt rule.
 *     False positives here surface as `md/image-missing-alt` on the URL
 *     inside the span. Acceptable for a hygiene scanner; if it becomes
 *     a real noise source, suppress with `kern-ignore` directives.
 *
 * If a doc uses those forms, findings on it are best-effort. The point is
 * predictable diagnostics for the common 95% case, not full CommonMark
 * fidelity, and to keep `@kernlang/review` trending toward zero dependencies.
 *
 * Two outputs from a single pass:
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
 * Fingerprint policy: structural keys (heading path, image alt-text URL),
 * NEVER line numbers, so kern-guard's baseline dedup does not re-post on
 * whitespace edits.
 */

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

// ── Internal: scan results ────────────────────────────────────────────────

interface ScanHeading {
  level: 1 | 2 | 3 | 4 | 5 | 6;
  text: string;
  slug: string;
  line: number; // 1-based
  /** Column where the heading marker starts (1-based). */
  startCol: number;
  /** Column at end of line + 1, for the heading's source span. */
  endCol: number;
}

interface ScanImage {
  /** Raw alt text as written (NOT trimmed). */
  alt: string;
  /** URL portion of `![alt](url)`. */
  url: string;
  /** 1-based source line where the `![…]` starts. */
  line: number;
  /** 1-based start column of the `!`. */
  startCol: number;
  /** 1-based column past the closing `)`. */
  endCol: number;
}

/** GitHub-style heading slug — lowercase, strip non-letter / non-digit
 *  punctuation across the full Unicode range (so `Café`, `中文`, `Привет`
 *  survive), then replace each whitespace char (not runs) with one hyphen.
 *  Per-char (not collapsed) replacement matches GitHub's behavior: "API &
 *  Usage" becomes "api--usage" because `&` is dropped while both
 *  surrounding spaces survive as separate hyphens. */
function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      // Allow Unicode letters, digits, underscores (GitHub keeps `_` in slugs),
      // whitespace (collapsed to hyphens below), and hyphens.
      .replace(/[^\p{L}\p{N}_\s-]/gu, '')
      .trim()
      .replace(/\s/g, '-')
  );
}

// Image syntax: `![alt](url)`. Allowed: empty alt, alt with spaces and
// most punctuation EXCEPT `]`, URL with most chars EXCEPT `)`. Reference-style
// images (`![alt][label]`) are intentionally not matched — see header comment.
const IMAGE_RE = /!\[([^\]\n]*)\]\(([^)\n]*)\)/g;

/**
 * Single-pass scanner. Walks source line by line, tracks open fenced code
 * blocks (backtick or tilde fences), collects ATX headings + image syntax
 * from non-code lines.
 */
function scanMarkdown(source: string): { headings: ScanHeading[]; images: ScanImage[] } {
  const headings: ScanHeading[] = [];
  const images: ScanImage[] = [];

  // Fenced code state. When inside a fence, both heading and image
  // detection are suppressed. The closing fence must match the opening
  // character AND be at least as long as the opener (CommonMark §4.5).
  let inFence = false;
  let fenceChar: '`' | '~' | null = null;
  let fenceLen = 0;

  // Split keeping line numbers 1-based. \r\n is normalized to \n via split
  // on /\r?\n/ so Windows line endings don't break anything.
  const lines = source.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const lineNo = i + 1;

    // Fence detection per CommonMark §4.5:
    //   - up to 3 spaces of leading indent (NOT arbitrary tabs/whitespace —
    //     a 4-space-indented `` ``` `` is part of an indented code block, not
    //     a fence, so it must NOT trigger fence state)
    //   - opening fences may carry an info string after the marker run
    //     (`` ```js ``); closing fences may have ONLY trailing whitespace.
    //
    // Match opening and closing with different regexes so a line like
    // ` ```text ` while already in a fence doesn't bogusly close it. Both
    // anchor on `^ {0,3}` so a 4-space indent is left to the
    // indented-code-block class (which we don't model — those lines simply
    // don't satisfy heading/image detection either, so they're safe).
    const openFenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})/);
    const closeFenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})\s*$/);

    if (inFence) {
      if (closeFenceMatch) {
        const ch = closeFenceMatch[1]!.charAt(0) as '`' | '~';
        if (ch === fenceChar && closeFenceMatch[1]!.length >= fenceLen) {
          inFence = false;
          fenceChar = null;
          fenceLen = 0;
        }
      }
      // Anything else inside a fence is ignored for headings/images.
      continue;
    }

    if (openFenceMatch) {
      inFence = true;
      fenceChar = openFenceMatch[1]!.charAt(0) as '`' | '~';
      fenceLen = openFenceMatch[1]!.length;
      continue;
    }

    // ATX heading: optional ≤3 spaces of indent, 1-6 `#`, REQUIRED space
    // after (per CommonMark) unless the line is just `#` chars. We also
    // strip optional trailing `# …` decoration.
    const headingMatch = line.match(/^ {0,3}(#{1,6})(?:\s+(.*?))?(?:\s+#+\s*)?\s*$/);
    if (headingMatch) {
      const level = headingMatch[1]!.length as 1 | 2 | 3 | 4 | 5 | 6;
      // Use the raw heading text as-is — do NOT globally strip ``, *, _
      // characters. That would turn `API_KEY` into `APIKEY` (breaking
      // outline labels) and was a regression vs the prior mdast-backed
      // implementation. A proper inline-span parser would distinguish
      // paired delimiters from literal underscores; we accept that the
      // outline shows raw markdown for headings with inline emphasis and
      // leave true delimiter handling out of scope (matches the module's
      // "hygiene scanner, not CommonMark" contract).
      const text = (headingMatch[2] ?? '').trim();
      const slug = slugify(text) || `heading-${lineNo}`;
      // startCol = where the first `#` sits.
      const startCol = line.length - line.replace(/^ */, '').length + 1;
      headings.push({
        level,
        text,
        slug,
        line: lineNo,
        startCol,
        endCol: line.length + 1,
      });
      continue;
    }

    // Image syntax. matchAll gives us all occurrences on the line with
    // their positions; we collect each as a ScanImage.
    for (const m of line.matchAll(IMAGE_RE)) {
      const idx = m.index ?? 0;
      images.push({
        alt: m[1] ?? '',
        url: (m[2] ?? '').trim(),
        line: lineNo,
        startCol: idx + 1,
        endCol: idx + m[0].length + 1,
      });
    }
  }

  return { headings, images };
}

function makeSpan(filePath: string, line: number, startCol: number, endCol: number): SourceSpan {
  return { file: filePath, startLine: line, startCol, endLine: line, endCol };
}

/**
 * Parse markdown once and emit both findings and outline. Internal — public
 * entry points (`reviewMarkdownFile`, `extractMarkdownOutline`) share this.
 */
function analyze(source: string, filePath: string): { findings: ReviewFinding[]; outline: MarkdownOutline } {
  const { headings, images } = scanMarkdown(source);

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
    while (headingPath.length > 0 && headingPath[headingPath.length - 1]!.level >= h.level) {
      headingPath.pop();
    }
    headingPath.push({ level: h.level, slug: h.slug });

    if (prevLevel !== null && h.level > prevLevel + 1) {
      const ruleId = 'md/skipped-heading-level';
      const path = headingPath.map((p) => p.slug).join('/');
      findings.push({
        source: 'kern',
        ruleId,
        severity: 'warning',
        category: 'structure',
        message: `Heading jumps from h${prevLevel} to h${h.level} — skipping levels breaks document outline and assistive tech navigation.`,
        primarySpan: makeSpan(filePath, h.line, h.startCol, h.endCol),
        confidence: 95,
        fingerprint: `${ruleId}:${path}`,
      });
    }
    prevLevel = h.level;
  }

  // ── Images missing alt text ─────────────────────────────────────────
  // Empty alt text on an image is an a11y red flag. Decorative images
  // should use alt="" intentionally; the scanner can't distinguish, so we
  // flag all empty-alt images and let the author confirm/suppress.
  for (let i = 0; i < images.length; i++) {
    const img = images[i]!;
    const alt = img.alt.trim();
    if (alt.length === 0) {
      const ruleId = 'md/image-missing-alt';
      // Fingerprint by URL (stable across line shifts); falls back to a
      // sequence-based key only if the image has no URL at all.
      const key = img.url || `idx-${i}`;
      findings.push({
        source: 'kern',
        ruleId,
        severity: 'warning',
        category: 'structure',
        message: `Image is missing alt text${img.url ? ` (\`${img.url}\`)` : ''}. Provide a description, or use \`![](…)\` only for purely decorative images.`,
        primarySpan: makeSpan(filePath, img.line, img.startCol, img.endCol),
        confidence: 90,
        fingerprint: `${ruleId}:${key}`,
      });
    }
  }

  // ── Build outline ───────────────────────────────────────────────────
  const flat: MarkdownOutlineHeading[] = headings.map((h) => ({
    level: h.level,
    text: h.text,
    slug: h.slug,
    line: h.line,
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
