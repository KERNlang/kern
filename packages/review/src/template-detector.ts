/**
 * Template Detector — matches code against known library patterns.
 *
 * Import-anchored detection: look at import sources to identify libraries,
 * then pattern-match the usage and extract slot values for .kern rewrites.
 *
 * When registeredTemplates are provided (from kern.config.ts), the detector
 * generates suggested .kern rewrites with actual slot values filled in.
 */

import { SourceFile, SyntaxKind } from 'ts-morph';
import { countTokens } from '@kernlang/core';
import type { TemplateMatch, ReviewConfig } from './types.js';

interface TemplatePattern {
  templateName: string;
  libraryName: string;
  importSource: string | RegExp;
  anchorImport: string;
  bodyHint?: string | RegExp;
  confidencePct: number;
  /** Extract slot values from source file */
  extractSlots?: (sourceFile: SourceFile, fullText: string) => Record<string, string> | null;
}

// ── Slot Extractors ──────────────────────────────────────────────────────

function extractZustandSlots(sourceFile: SourceFile, fullText: string): Record<string, string> | null {
  // Pattern: const useXStore = create<StateType>((set, get) => ({...}))
  // or: export const useXStore = create<StateType>()(...)
  const match = fullText.match(/(?:export\s+)?const\s+use(\w+)Store\s*=\s*create\s*<\s*(\w+)\s*>/);
  if (match) {
    return { storeName: match[1], stateType: match[2] };
  }
  // Fallback: look for create<X> without the useXStore naming
  const match2 = fullText.match(/create\s*<\s*(\w+)\s*>/);
  if (match2) {
    // Try to find the variable name
    const varMatch = fullText.match(/(?:export\s+)?const\s+(\w+)\s*=\s*create/);
    const storeName = varMatch ? varMatch[1].replace(/^use/, '').replace(/Store$/, '') : match2[1];
    return { storeName, stateType: match2[1] };
  }
  return null;
}

function extractSwrSlots(sourceFile: SourceFile, fullText: string): Record<string, string> | null {
  // Pattern: function useX() { ... useSWR(key, fetcher) ... }
  const fnMatch = fullText.match(/function\s+(use\w+)\s*\(/);
  const swrMatch = fullText.match(/useSWR\s*\(\s*([^,)]+)/);
  if (fnMatch && swrMatch) {
    return { hookName: fnMatch[1], cacheKey: swrMatch[1].trim() };
  }
  return null;
}

function extractQuerySlots(sourceFile: SourceFile, fullText: string): Record<string, string> | null {
  const fnMatch = fullText.match(/function\s+(use\w+)\s*\(/);
  const keyMatch = fullText.match(/queryKey\s*:\s*\[([^\]]+)\]/);
  const fnBodyMatch = fullText.match(/queryFn\s*:\s*(\w+)/);
  if (fnMatch && keyMatch) {
    return {
      hookName: fnMatch[1],
      queryKey: keyMatch[1].trim(),
      ...(fnBodyMatch ? { queryFn: fnBodyMatch[1] } : {}),
    };
  }
  return null;
}

function extractJotaiSlots(sourceFile: SourceFile, fullText: string): Record<string, string> | null {
  const match = fullText.match(/(?:export\s+)?const\s+(\w+)Atom\s*=\s*atom\s*<\s*(\w+)\s*>\s*\(\s*([^)]+)\s*\)/);
  if (match) {
    return { atomName: match[1], atomType: match[2], initialValue: match[3].trim() };
  }
  return null;
}

function extractZodSlots(sourceFile: SourceFile, fullText: string): Record<string, string> | null {
  const match = fullText.match(/(?:export\s+)?const\s+(\w+)(?:Schema)?\s*=\s*z\.object\s*\(/);
  if (match) {
    return { schemaName: match[1] };
  }
  return null;
}

// ── Patterns ─────────────────────────────────────────────────────────────

const PATTERNS: TemplatePattern[] = [
  {
    templateName: 'zustand-store',
    libraryName: 'zustand',
    importSource: 'zustand',
    anchorImport: 'create',
    bodyHint: /create\s*(<|[\s(])/,
    confidencePct: 92,
    extractSlots: extractZustandSlots,
  },
  {
    templateName: 'zustand-selector',
    libraryName: 'zustand',
    importSource: 'zustand',
    anchorImport: 'create',
    bodyHint: /useStore\s*\(\s*\(\s*state\s*\)/,
    confidencePct: 85,
  },
  {
    templateName: 'swr-hook',
    libraryName: 'SWR',
    importSource: 'swr',
    anchorImport: 'useSWR',
    bodyHint: /useSWR\s*\(/,
    confidencePct: 90,
    extractSlots: extractSwrSlots,
  },
  {
    templateName: 'query-hook',
    libraryName: 'TanStack Query',
    importSource: /tanstack\/.*query/,
    anchorImport: 'useQuery',
    bodyHint: /useQuery\s*\(\s*\{/,
    confidencePct: 90,
    extractSlots: extractQuerySlots,
  },
  {
    templateName: 'mutation-hook',
    libraryName: 'TanStack Query',
    importSource: /tanstack\/.*query/,
    anchorImport: 'useMutation',
    bodyHint: /useMutation\s*\(\s*\{/,
    confidencePct: 88,
  },
  {
    templateName: 'xstate-machine',
    libraryName: 'XState',
    importSource: 'xstate',
    anchorImport: 'createMachine',
    bodyHint: /createMachine\s*\(/,
    confidencePct: 90,
  },
  {
    templateName: 'jotai-atom',
    libraryName: 'Jotai',
    importSource: 'jotai',
    anchorImport: 'atom',
    bodyHint: /atom\s*(<|\()/,
    confidencePct: 88,
    extractSlots: extractJotaiSlots,
  },
  {
    templateName: 'trpc-router',
    libraryName: 'tRPC',
    importSource: /@trpc/,
    anchorImport: 'router',
    bodyHint: /\.router\s*\(/,
    confidencePct: 85,
  },
  {
    templateName: 'zod-schema',
    libraryName: 'Zod',
    importSource: 'zod',
    anchorImport: 'z',
    bodyHint: /z\.object\s*\(/,
    confidencePct: 88,
    extractSlots: extractZodSlots,
  },
];

// ── Build .kern suggestion ───────────────────────────────────────────────

function buildKernSuggestion(
  templateName: string,
  slots: Record<string, string>,
): string {
  const parts = [templateName];
  for (const [key, value] of Object.entries(slots)) {
    if (value.includes(' ')) {
      parts.push(`${key}="${value}"`);
    } else {
      parts.push(`${key}=${value}`);
    }
  }
  return parts.join(' ');
}

// ── Main Detector ────────────────────────────────────────────────────────

export function detectTemplates(
  sourceFile: SourceFile,
  config?: ReviewConfig,
): TemplateMatch[] {
  const results: TemplateMatch[] = [];
  const fullText = sourceFile.getFullText();
  const totalTokens = countTokens(fullText);
  const imports = sourceFile.getImportDeclarations();
  const registeredTemplates = new Set(config?.registeredTemplates || []);

  for (const pattern of PATTERNS) {
    const matchingImport = imports.find(imp => {
      const source = imp.getModuleSpecifierValue();
      if (typeof pattern.importSource === 'string') {
        return source === pattern.importSource || source.startsWith(pattern.importSource + '/');
      }
      return pattern.importSource.test(source);
    });

    if (!matchingImport) continue;

    const namedImports = matchingImport.getNamedImports().map(n => n.getName());
    const defaultImport = matchingImport.getDefaultImport()?.getText();
    const hasAnchor = namedImports.includes(pattern.anchorImport) ||
                      defaultImport === pattern.anchorImport;

    if (!hasAnchor) continue;

    let confidence = pattern.confidencePct;
    if (pattern.bodyHint) {
      const bodyMatches = typeof pattern.bodyHint === 'string'
        ? fullText.includes(pattern.bodyHint)
        : pattern.bodyHint.test(fullText);
      if (!bodyMatches) {
        confidence -= 15;
      }
    }

    if (confidence < 50) continue;

    const startLine = matchingImport.getStartLineNumber();
    const endLine = sourceFile.getEndLineNumber();

    // Extract slot values if extractor exists
    const slotValues = pattern.extractSlots
      ? pattern.extractSlots(sourceFile, fullText) ?? undefined
      : undefined;

    // Build .kern suggestion if template is registered and slots extracted
    let suggestedKern: string | undefined;
    let kernTokens: number | undefined;
    const isRegistered = registeredTemplates.has(pattern.templateName);

    if (slotValues) {
      suggestedKern = buildKernSuggestion(pattern.templateName, slotValues);
      kernTokens = countTokens(suggestedKern);

      // Boost confidence when template is registered
      if (isRegistered) {
        confidence = Math.min(confidence + 5, 99);
      }
    }

    results.push({
      templateName: pattern.templateName,
      libraryName: pattern.libraryName,
      anchorImport: pattern.anchorImport,
      confidencePct: confidence,
      startLine,
      endLine,
      slotValues,
      suggestedKern,
      kernTokens,
      tsTokens: totalTokens,
    });
  }

  return results;
}
