/**
 * Structural Detectors — import-agnostic pattern detection.
 *
 * These detectors find structural patterns (models, repositories, DI, caching,
 * conditionals, selects) regardless of which library is used.
 * They have empty packageNames[] so they run on all files.
 */

import type { SourceFile } from 'ts-morph';
import type { DetectorPack, DetectionResult, ExtractedParam } from '../types.js';

function lineOf(fullText: string, index: number): number {
  return fullText.substring(0, index).split('\n').length;
}

function extractSnippet(fullText: string, start: number, maxLen = 300): string {
  return fullText.substring(start, Math.min(start + maxLen, fullText.length));
}

// ── structural-model ─────────────────────────────────────────────────────
// Detects Prisma models, TypeORM entities, Drizzle tables, plain TS class entities

const structuralModel: DetectorPack = {
  id: 'structural-model',
  libraryName: 'structural',
  packageNames: [],
  patternKind: 'structural',
  detect(sourceFile: SourceFile, fullText: string): DetectionResult[] {
    const results: DetectionResult[] = [];

    // Prisma-style: model in schema, or TS interface/class with @Entity, @model decorators
    // Pattern: class with decorators like @Entity, @Table, or Prisma model references
    const entityPatterns = [
      // TypeORM/MikroORM @Entity() class
      /@Entity\s*\([^)]*\)\s*(?:export\s+)?class\s+(\w+)/g,
      // Sequelize @Table class
      /@Table\s*(?:\([^)]*\))?\s*(?:export\s+)?class\s+(\w+)/g,
      // Drizzle pgTable/mysqlTable/sqliteTable
      /(?:const|export\s+const)\s+(\w+)\s*=\s*(?:pgTable|mysqlTable|sqliteTable)\s*\(/g,
      // Prisma client usage: prisma.user.findMany() etc
      /prisma\.(\w+)\.\w+\s*\(/g,
    ];

    for (const pattern of entityPatterns) {
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(fullText)) !== null) {
        const startLine = lineOf(fullText, match.index);
        const params: ExtractedParam[] = [{
          name: 'modelName',
          slotType: 'identifier',
          value: match[1],
          optional: false,
        }];
        results.push({
          anchorImport: '',
          startLine,
          endLine: startLine + 5,
          snippet: extractSnippet(fullText, match.index),
          extractedParams: params,
          confidencePct: 75,
        });
      }
    }

    return results;
  },
};

// ── structural-repository ────────────────────────────────────────────────
// Detects CRUD wrapper classes/functions

const structuralRepository: DetectorPack = {
  id: 'structural-repository',
  libraryName: 'structural',
  packageNames: [],
  patternKind: 'structural',
  detect(sourceFile: SourceFile, fullText: string): DetectionResult[] {
    const results: DetectionResult[] = [];

    // Classes ending in Repository, Repo, Store, DAO
    const repoPattern = /(?:export\s+)?class\s+(\w+(?:Repository|Repo|Store|DAO))\s*(?:extends|implements|{)/g;
    let match: RegExpExecArray | null;
    while ((match = repoPattern.exec(fullText)) !== null) {
      const startLine = lineOf(fullText, match.index);
      results.push({
        anchorImport: '',
        startLine,
        endLine: startLine + 10,
        snippet: extractSnippet(fullText, match.index),
        extractedParams: [{
          name: 'repoName',
          slotType: 'identifier',
          value: match[1],
          optional: false,
        }],
        confidencePct: 80,
      });
    }

    return results;
  },
};

// ── structural-dependency ────────────────────────────────────────────────
// Detects constructor injection, factory functions

const structuralDependency: DetectorPack = {
  id: 'structural-dependency',
  libraryName: 'structural',
  packageNames: [],
  patternKind: 'structural',
  detect(sourceFile: SourceFile, fullText: string): DetectionResult[] {
    const results: DetectionResult[] = [];

    // Constructor injection: constructor(private readonly userRepo: UserRepository)
    const ctorInjection = /constructor\s*\(\s*((?:private|protected|public)\s+(?:readonly\s+)?\w+\s*:\s*\w+(?:\s*,\s*(?:private|protected|public)\s+(?:readonly\s+)?\w+\s*:\s*\w+)*)\s*\)/g;
    let match: RegExpExecArray | null;
    while ((match = ctorInjection.exec(fullText)) !== null) {
      const params = match[1].split(',').map(p => p.trim());
      if (params.length >= 2) {
        const startLine = lineOf(fullText, match.index);
        results.push({
          anchorImport: '',
          startLine,
          endLine: startLine + 3,
          snippet: extractSnippet(fullText, match.index),
          extractedParams: [{
            name: 'injectionCount',
            slotType: 'expr',
            value: String(params.length),
            optional: false,
          }],
          confidencePct: 70,
        });
      }
    }

    // @Injectable() / @Inject() decorators
    const injectPattern = /@(?:Injectable|Inject)\s*\(/g;
    while ((match = injectPattern.exec(fullText)) !== null) {
      const startLine = lineOf(fullText, match.index);
      results.push({
        anchorImport: '',
        startLine,
        endLine: startLine + 2,
        snippet: extractSnippet(fullText, match.index),
        extractedParams: [],
        confidencePct: 85,
      });
    }

    return results;
  },
};

// ── structural-cache ─────────────────────────────────────────────────────
// Detects Redis/memory cache patterns

const structuralCache: DetectorPack = {
  id: 'structural-cache',
  libraryName: 'structural',
  packageNames: [],
  patternKind: 'structural',
  detect(sourceFile: SourceFile, fullText: string): DetectionResult[] {
    const results: DetectionResult[] = [];

    const cachePatterns = [
      // Redis client usage
      /(?:redis|cache|cacheClient|cacheManager)\s*\.\s*(?:get|set|del|setex|expire|hget|hset)\s*\(/g,
      // Cache decorator
      /@(?:Cache|Cacheable|CacheEvict|CacheInvalidate)\s*\(/g,
      // Map/Object as cache with TTL
      /new\s+Map\s*<[^>]+>\s*\(\)\s*;?\s*\/\/\s*cache/gi,
    ];

    for (const pattern of cachePatterns) {
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(fullText)) !== null) {
        const startLine = lineOf(fullText, match.index);
        results.push({
          anchorImport: '',
          startLine,
          endLine: startLine + 3,
          snippet: extractSnippet(fullText, match.index),
          extractedParams: [],
          confidencePct: 70,
        });
      }
    }

    return results;
  },
};

// ── structural-conditional ───────────────────────────────────────────────
// Detects conditional rendering, feature flags

const structuralConditional: DetectorPack = {
  id: 'structural-conditional',
  libraryName: 'structural',
  packageNames: [],
  patternKind: 'structural',
  detect(sourceFile: SourceFile, fullText: string): DetectionResult[] {
    const results: DetectionResult[] = [];

    // Feature flag patterns: if (featureFlag) / isEnabled('feature') / useFeatureFlag
    const featureFlagPatterns = [
      /(?:useFeatureFlag|useFeature|isFeatureEnabled|featureFlags)\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
      /if\s*\(\s*(?:features|flags)\s*\.\s*(\w+)\s*\)/g,
    ];

    for (const pattern of featureFlagPatterns) {
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(fullText)) !== null) {
        const startLine = lineOf(fullText, match.index);
        results.push({
          anchorImport: '',
          startLine,
          endLine: startLine + 5,
          snippet: extractSnippet(fullText, match.index),
          extractedParams: [{
            name: 'flagName',
            slotType: 'identifier',
            value: match[1],
            optional: false,
          }],
          confidencePct: 65,
        });
      }
    }

    // JSX conditional rendering: {condition && <Component />}
    const jsxConditional = /\{(\w+)\s*&&\s*</g;
    let match: RegExpExecArray | null;
    while ((match = jsxConditional.exec(fullText)) !== null) {
      const startLine = lineOf(fullText, match.index);
      results.push({
        anchorImport: '',
        startLine,
        endLine: startLine + 3,
        snippet: extractSnippet(fullText, match.index),
        extractedParams: [{
          name: 'condition',
          slotType: 'expr',
          value: match[1],
          optional: false,
        }],
        confidencePct: 60,
      });
    }

    return results;
  },
};

// ── structural-select ────────────────────────────────────────────────────
// Detects HTML select/option, headless UI selects

const structuralSelect: DetectorPack = {
  id: 'structural-select',
  libraryName: 'structural',
  packageNames: [],
  patternKind: 'structural',
  detect(sourceFile: SourceFile, fullText: string): DetectionResult[] {
    const results: DetectionResult[] = [];

    const selectPatterns = [
      // HTML <select> tag
      /<select\s[^>]*name=['"](\w+)['"]/g,
      // Headless UI Listbox
      /(?:Listbox|Select|Dropdown)\s*(?:\.\w+\s*)?(?:value|onChange)\s*=/g,
    ];

    for (const pattern of selectPatterns) {
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(fullText)) !== null) {
        const startLine = lineOf(fullText, match.index);
        results.push({
          anchorImport: '',
          startLine,
          endLine: startLine + 8,
          snippet: extractSnippet(fullText, match.index),
          extractedParams: match[1] ? [{
            name: 'selectName',
            slotType: 'identifier',
            value: match[1],
            optional: false,
          }] : [],
          confidencePct: 65,
        });
      }
    }

    return results;
  },
};

/** All structural detectors for registration. */
export const detectors: DetectorPack[] = [
  structuralModel,
  structuralRepository,
  structuralDependency,
  structuralCache,
  structuralConditional,
  structuralSelect,
];
