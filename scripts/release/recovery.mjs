import { assertRegistryMetadata } from './registry-metadata.mjs';
import { runRestoredEntrySmoke } from './registry-smoke.mjs';
import { assertDeprecationMessage } from './registry-validation.mjs';

async function writeEvidence(journal, event) {
  try {
    await journal.writeEvent(event);
  } catch {
    // The journal is evidence only. Registry-derived recovery must continue.
  }
}

async function observe({ policy, clock, read, accept }) {
  let last;
  for (let attempt = 1; attempt <= policy.retry.attempts; attempt += 1) {
    last = await read();
    if (accept(last)) return last;
    if (attempt < policy.retry.attempts) await clock.sleep(policy.retry.delayMs);
  }
  return last;
}

function deprecationMessage({ policy, plan }) {
  return policy.recovery.deprecationMessage
    .replaceAll('{version}', plan.version)
    .replaceAll('{sourceSha}', plan.sha);
}

function recoveryEntrySet({ plan, policy }) {
  const planNames = new Set(plan.packages.map((pkg) => pkg.name));
  const entries = policy.recovery.entryPackageNames;
  for (const name of entries) {
    if (!planNames.has(name)) throw new Error(`Recovery entry package is not in the release plan: ${name}`);
  }
  return new Set(entries);
}

async function inspectRecoveryState({ plan, policy, manifest, snapshot, registryClient }) {
  const entries = recoveryEntrySet({ plan, policy });
  const manifestByName = new Map(manifest.packages.map((pkg) => [pkg.name, pkg]));
  const states = new Map();
  for (const pkg of plan.packages) {
    const manifestPackage = manifestByName.get(pkg.name);
    if (!manifestPackage) throw new Error(`Recovery manifest is missing ${pkg.name}`);
    const registryInfo = await registryClient.getVersion(pkg.name, plan.version);
    if (registryInfo === null) throw new Error(`Recovery cannot read ${pkg.name}@${plan.version}`);
    assertRegistryMetadata({ registryInfo, manifestPackage, plan });
    const tags = await registryClient.getDistTags(pkg.name);
    if (tags[snapshot.stagingTag] !== plan.version) {
      throw new Error(`Recovery found staging-tag interference for ${pkg.name}`);
    }
    const current = tags[plan.distTag] ?? null;
    const prior = snapshot.priorTags[pkg.name];
    const allowed = current === plan.version || (entries.has(pkg.name) && current === prior);
    if (!allowed) {
      throw new Error(
        `Recovery found external public-tag interference for ${pkg.name}: ${current ?? '<absent>'}`,
      );
    }
    states.set(pkg.name, { current, prior, registryInfo });
  }
  const rootName = policy.promotion.rootPackageName;
  const rootState = states.get(rootName);
  if (!rootState || (rootState.current !== plan.version && rootState.current !== rootState.prior)) {
    throw new Error('Recovery cannot establish the configured root marker state');
  }
  if (
    rootState.current !== plan.version &&
    rootState.registryInfo.deprecated !== deprecationMessage({ policy, plan })
  ) {
    throw new Error(
      'Recovery is not authorized before the root marker moves or an exact containment marker exists',
    );
  }
  return { states, entries };
}

async function restoreEntry({ name, desired, plan, policy, registryClient, clock }) {
  const read = () => registryClient.getDistTags(name);
  const accept = (tags) => desired === null
    ? !Object.hasOwn(tags, plan.distTag)
    : tags[plan.distTag] === desired;
  let mutationError;
  try {
    if (desired === null) await registryClient.removeDistTag(name, plan.distTag);
    else await registryClient.setDistTag(name, desired, plan.distTag);
  } catch (error) {
    mutationError = error;
  }
  const observed = await observe({ policy, clock, read, accept });
  if (!accept(observed)) {
    throw new Error(
      `Entry-tag restoration was not observed for ${name}${mutationError ? ` after mutation error: ${mutationError.message}` : ''}`,
    );
  }
}

async function deprecateExactVersion({ pkg, message, plan, policy, registryClient, clock }) {
  const read = () => registryClient.getVersion(pkg.name, plan.version);
  let current = await read();
  if (current?.deprecated === message) return;
  if (current?.deprecated && current.deprecated !== message) {
    throw new Error(`Conflicting deprecation metadata for ${pkg.name}@${plan.version}`);
  }
  let mutationError;
  try {
    await registryClient.deprecateVersion(pkg.name, plan.version, message);
  } catch (error) {
    mutationError = error;
  }
  current = await observe({
    policy,
    clock,
    read,
    accept: (info) => info?.deprecated === message,
  });
  if (current?.deprecated !== message) {
    throw new Error(
      `Deprecation was not observed for ${pkg.name}@${plan.version}${mutationError ? ` after mutation error: ${mutationError.message}` : ''}`,
    );
  }
}

export async function planFailedReleaseRecovery({ plan, policy, manifest, snapshot, registryClient }) {
  const { states } = await inspectRecoveryState({
    plan,
    policy,
    manifest,
    snapshot,
    registryClient,
  });
  const message = deprecationMessage({ policy, plan });
  assertDeprecationMessage(message, policy.artifacts.maxCommandOutputBytes);
  const entryOrder = [
    ...policy.recovery.entryPackageNames.filter(
      (name) => name !== policy.promotion.rootPackageName,
    ),
    policy.promotion.rootPackageName,
  ];
  return {
    restorations: entryOrder.map((name) => ({
      packageName: name,
      tag: plan.distTag,
      from: states.get(name).current,
      to: states.get(name).prior,
    })),
    deprecations: plan.packages.map((pkg) => ({
      packageName: pkg.name,
      version: plan.version,
      message,
    })),
  };
}

export async function containFailedRelease({
  rootDir,
  plan,
  policy,
  manifest,
  snapshot,
  registryClient,
  clock,
  journal,
  dryRun = false,
  restoredSmokeFn = runRestoredEntrySmoke,
}) {
  const actions = await planFailedReleaseRecovery({
    plan,
    policy,
    manifest,
    snapshot,
    registryClient,
  });
  if (dryRun) return { contained: false, dryRun: true, actions };

  const rootName = policy.promotion.rootPackageName;
  const message = deprecationMessage({ policy, plan });
  const nonRootRestorations = actions.restorations.filter(
    (action) => action.packageName !== rootName,
  );
  const rootRestoration = actions.restorations.find(
    (action) => action.packageName === rootName,
  );
  if (!rootRestoration) {
    throw new Error(`Recovery action plan is missing root entry ${rootName}`);
  }
  for (const action of nonRootRestorations) {
    if (action.from !== action.to) {
      await restoreEntry({
        name: action.packageName,
        desired: action.to,
        plan,
        policy,
        registryClient,
        clock,
      });
    }
    await writeEvidence(journal, {
      phase: 'recover-entry-tag',
      packageName: action.packageName,
      operation: action.to === null ? 'remove-tag' : 'restore-tag',
      outcome: action.from === action.to ? 'skipped' : 'succeeded',
    });
  }

  for (const pkg of plan.packages) {
    await deprecateExactVersion({
      pkg,
      message,
      plan,
      policy,
      registryClient,
      clock,
    });
    await writeEvidence(journal, {
      phase: 'deprecate-failed-version',
      packageName: pkg.name,
      operation: 'deprecate',
      outcome: 'succeeded',
    });
  }

  if (rootRestoration.from !== rootRestoration.to) {
    await restoreEntry({
      name: rootRestoration.packageName,
      desired: rootRestoration.to,
      plan,
      policy,
      registryClient,
      clock,
    });
  }
  await writeEvidence(journal, {
    phase: 'recover-entry-tag',
    packageName: rootRestoration.packageName,
    operation: rootRestoration.to === null ? 'remove-tag' : 'restore-tag',
    outcome: rootRestoration.from === rootRestoration.to ? 'skipped' : 'succeeded',
  });

  const smoke = await restoredSmokeFn({
    rootDir,
    plan,
    snapshot,
    policy,
    registryClient,
  });
  await writeEvidence(journal, {
    phase: 'smoke-restored-entry',
    packageName: null,
    operation: 'run-smoke',
    outcome: 'succeeded',
  });
  return { contained: true, dryRun: false, actions, smoke };
}
