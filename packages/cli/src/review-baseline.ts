import type { ReviewFinding, ReviewReport } from '@kernlang/review';

export interface ReviewBaselineEntry {
  filePath: string;
  ruleId: string;
  severity: ReviewFinding['severity'];
  fingerprint: string;
  message: string;
}

export interface ReviewBaselineFile {
  version: 1;
  createdAt: string;
  entries: ReviewBaselineEntry[];
}

export interface ReviewBaselineComparison {
  currentCount: number;
  knownCount: number;
  newCount: number;
  resolvedCount: number;
  knownKeys: Set<string>;
  newKeys: Set<string>;
}

export function getReviewBaselineKey(entry: ReviewBaselineEntry): string {
  return [entry.filePath, entry.ruleId, entry.severity, entry.fingerprint, entry.message].join('\u0000');
}

function findingToEntry(filePath: string, finding: ReviewFinding): ReviewBaselineEntry {
  return {
    filePath,
    ruleId: finding.ruleId,
    severity: finding.severity,
    fingerprint: finding.fingerprint,
    message: finding.message,
  };
}

export function createReviewBaseline(reports: ReviewReport[]): ReviewBaselineFile {
  const entries: ReviewBaselineEntry[] = [];
  const seen = new Set<string>();

  for (const report of reports) {
    for (const finding of report.findings) {
      const entry = findingToEntry(report.filePath, finding);
      const key = getReviewBaselineKey(entry);
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push(entry);
    }
  }

  entries.sort((a, b) => {
    const fileCmp = a.filePath.localeCompare(b.filePath);
    if (fileCmp !== 0) return fileCmp;
    const sevOrder: Record<ReviewFinding['severity'], number> = { error: 0, warning: 1, info: 2 };
    const sevCmp = sevOrder[a.severity] - sevOrder[b.severity];
    if (sevCmp !== 0) return sevCmp;
    const ruleCmp = a.ruleId.localeCompare(b.ruleId);
    if (ruleCmp !== 0) return ruleCmp;
    return a.fingerprint.localeCompare(b.fingerprint);
  });

  return {
    version: 1,
    createdAt: new Date().toISOString(),
    entries,
  };
}

export function parseReviewBaseline(raw: string): ReviewBaselineFile {
  const parsed = JSON.parse(raw) as unknown;

  const candidate = Array.isArray(parsed)
    ? { version: 1 as const, createdAt: '', entries: parsed }
    : (parsed as Partial<ReviewBaselineFile> | null | undefined);

  if (!candidate || candidate.version !== 1 || !Array.isArray(candidate.entries)) {
    throw new Error('Invalid baseline format: expected { version: 1, entries: [...] }');
  }

  const entries: ReviewBaselineEntry[] = [];
  for (const entry of candidate.entries) {
    if (
      !entry ||
      typeof entry.filePath !== 'string' ||
      typeof entry.ruleId !== 'string' ||
      typeof entry.severity !== 'string' ||
      typeof entry.fingerprint !== 'string' ||
      typeof entry.message !== 'string'
    ) {
      throw new Error('Invalid baseline entry: expected filePath/ruleId/severity/fingerprint/message strings');
    }
    if (entry.severity !== 'error' && entry.severity !== 'warning' && entry.severity !== 'info') {
      throw new Error(`Invalid baseline entry severity: ${entry.severity}`);
    }
    entries.push(entry);
  }

  return {
    version: 1,
    createdAt: typeof candidate.createdAt === 'string' ? candidate.createdAt : '',
    entries,
  };
}

export function compareReportsToBaseline(
  reports: ReviewReport[],
  baseline: ReviewBaselineFile,
): ReviewBaselineComparison {
  const current = createReviewBaseline(reports);
  const currentKeys = new Set(current.entries.map(getReviewBaselineKey));
  const baselineKeys = new Set(baseline.entries.map(getReviewBaselineKey));

  let knownCount = 0;
  const knownKeys = new Set<string>();
  const newKeys = new Set<string>();
  for (const key of currentKeys) {
    if (baselineKeys.has(key)) {
      knownCount++;
      knownKeys.add(key);
    } else {
      newKeys.add(key);
    }
  }

  let resolvedCount = 0;
  for (const key of baselineKeys) {
    if (!currentKeys.has(key)) resolvedCount++;
  }

  return {
    currentCount: current.entries.length,
    knownCount,
    newCount: newKeys.size,
    resolvedCount,
    knownKeys,
    newKeys,
  };
}

export function getReviewBaselineKeyForFinding(filePath: string, finding: ReviewFinding): string {
  return getReviewBaselineKey(findingToEntry(filePath, finding));
}

export function filterReportsToNewFindings(
  reports: ReviewReport[],
  comparison: ReviewBaselineComparison,
): ReviewReport[] {
  return reports.map((report) => ({
    ...report,
    findings: report.findings.filter((finding) => {
      const key = getReviewBaselineKeyForFinding(report.filePath, finding);
      return comparison.newKeys.has(key);
    }),
    suppressedFindings:
      report.suppressedFindings?.filter((finding) => {
        const key = getReviewBaselineKeyForFinding(report.filePath, finding);
        return comparison.newKeys.has(key);
      }) ?? [],
  }));
}
