import { assertM4149CanonicalSurfaceAnalysis } from './coverage-m4-149-central.mjs';
import { formatM4150QuotesourceRewriteStatus } from './coverage-status-m4-150.mjs';
import { assertM4150QuotesourceRewrite } from './quotesource-rewrite-m4-150.mjs';

export function assertM4150QuotesourceImplementation(coverage, prerequisite) {
  const m4149Status = assertM4149CanonicalSurfaceAnalysis();
  const rewrite = assertM4150QuotesourceRewrite();
  const m4150Status = formatM4150QuotesourceRewriteStatus(
    rewrite,
    coverage,
    prerequisite,
  );
  return `${m4149Status} ${m4150Status}`;
}
