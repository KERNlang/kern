import type { ReviewConfig, ReviewPolicy } from './types.js';

export interface ReviewPolicyProfile {
  policy: ReviewPolicy;
  crossStackMode: 'guard' | 'audit';
  minConfidence: number;
  maxErrors?: number;
  maxWarnings?: number;
  strict?: false | 'inline' | 'all';
  strictParse?: boolean;
  description: string;
}

export interface ReviewPolicyExplicitOptions {
  crossStackMode?: boolean;
  minConfidence?: boolean;
  maxErrors?: boolean;
  maxWarnings?: boolean;
  strict?: boolean;
  strictParse?: boolean;
}

const REVIEW_POLICY_PROFILES: Record<ReviewPolicy, ReviewPolicyProfile> = {
  guard: {
    policy: 'guard',
    crossStackMode: 'guard',
    minConfidence: 0,
    description: 'Low-noise review posture for local guardrails and PR feedback.',
  },
  ci: {
    policy: 'ci',
    crossStackMode: 'guard',
    minConfidence: 0.75,
    maxErrors: 0,
    maxWarnings: 0,
    strict: 'inline',
    strictParse: true,
    description: 'Strict CI posture: high-confidence findings only, no warnings by default, strict parsing.',
  },
  audit: {
    policy: 'audit',
    crossStackMode: 'audit',
    minConfidence: 0,
    description: 'Broad exploratory posture for local investigations and rule calibration.',
  },
};

export function getReviewPolicyProfile(policy: ReviewPolicy): ReviewPolicyProfile {
  return REVIEW_POLICY_PROFILES[policy];
}

export function inferReviewPolicy(config?: Pick<ReviewConfig, 'policy' | 'crossStackMode'>): ReviewPolicy {
  if (config?.policy) return config.policy;
  return config?.crossStackMode === 'audit' ? 'audit' : 'guard';
}

export function applyReviewPolicyDefaults(
  config: ReviewConfig,
  explicit: ReviewPolicyExplicitOptions = {},
): ReviewConfig {
  const policy = inferReviewPolicy(config);
  const profile = getReviewPolicyProfile(policy);

  return {
    ...config,
    policy,
    crossStackMode: explicit.crossStackMode ? config.crossStackMode : profile.crossStackMode,
    minConfidence: explicit.minConfidence ? config.minConfidence : profile.minConfidence,
    maxErrors: explicit.maxErrors ? config.maxErrors : (profile.maxErrors ?? config.maxErrors),
    maxWarnings: explicit.maxWarnings ? config.maxWarnings : (profile.maxWarnings ?? config.maxWarnings),
    strict: explicit.strict ? config.strict : (profile.strict ?? config.strict),
    strictParse: explicit.strictParse ? config.strictParse : (profile.strictParse ?? config.strictParse),
  };
}
