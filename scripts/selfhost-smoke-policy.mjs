import { readFileSync } from 'node:fs';

function exactKeys(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`self-host smoke policy ${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`self-host smoke policy ${label} fields must be exactly ${wanted.join(', ')}`);
  }
}

export function loadSelfhostSmokePolicy(path) {
  let policy;
  try {
    policy = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(
      `self-host smoke policy is unreadable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  exactKeys(policy, ['schemaVersion', 'timeouts'], 'root');
  if (policy.schemaVersion !== 1) {
    throw new Error('self-host smoke policy schemaVersion must be 1');
  }
  exactKeys(policy.timeouts, ['capstoneCheckerSubsetMs'], 'timeouts');
  const timeout = policy.timeouts.capstoneCheckerSubsetMs;
  if (!Number.isSafeInteger(timeout) || timeout <= 0) {
    throw new Error('self-host smoke policy timeouts.capstoneCheckerSubsetMs must be a positive safe integer');
  }
  return {
    schemaVersion: 1,
    timeouts: { capstoneCheckerSubsetMs: timeout },
  };
}
