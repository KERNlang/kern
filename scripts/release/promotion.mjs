import { isDeepStrictEqual } from 'node:util';

export function deriveSnapshotName(plan) {
  return `promotion-snapshot-${plan.sha}-${plan.version}`;
}

export function deriveStagingTag({ plan, policy }) {
  const version = plan.version.replace(/[^a-zA-Z0-9._-]/g, '-');
  const tag = `${policy.staging.tagPrefix}-${version}-g${plan.sha.slice(0, 8)}`;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(tag)) {
    throw new Error(`Derived staging tag is unsafe: ${tag}`);
  }
  const publicTags = new Set(Object.values(policy.channels).map((channel) => channel.distTag));
  if (publicTags.has(tag)) {
    throw new Error(`Derived staging tag cannot equal any public tag: ${tag}`);
  }
  return tag;
}

export function validatePromotionSnapshot({ snapshot, plan, policy, manifestSha512 }) {
  const expectedNames = plan.packages.map((pkg) => pkg.name).sort();
  const actualNames = Object.keys(snapshot?.priorTags ?? {}).sort();
  const validPriorTags = actualNames.every((name) => {
    const value = snapshot.priorTags[name];
    return value === null || typeof value === 'string';
  });
  const valid =
    snapshot?.schemaVersion === 1 &&
    snapshot.sha === plan.sha &&
    snapshot.version === plan.version &&
    snapshot.channel === plan.channel &&
    snapshot.distTag === plan.distTag &&
    snapshot.stagingTag === deriveStagingTag({ plan, policy }) &&
    snapshot.artifactManifestSha512 === manifestSha512 &&
    isDeepStrictEqual(actualNames, expectedNames) &&
    validPriorTags;
  if (!valid) {
    throw new Error('Promotion snapshot does not match the current release plan and manifest');
  }
  return snapshot;
}

export async function preparePromotionSnapshot({
  plan,
  policy,
  manifestSha512,
  registryClient,
  artifactStore,
}) {
  const artifactName = deriveSnapshotName(plan);
  const recovered = await artifactStore.recoverSnapshot({ artifactName, plan });
  if (recovered) {
    validatePromotionSnapshot({ snapshot: recovered, plan, policy, manifestSha512 });
    return { snapshot: recovered, artifactName, created: false };
  }
  const stagingTag = deriveStagingTag({ plan, policy });
  const priorTags = {};
  for (const pkg of plan.packages) {
    const tags = await registryClient.getDistTags(pkg.name);
    if (tags[stagingTag] !== plan.version) {
      throw new Error(`Cannot snapshot before staging tag verification for ${pkg.name}`);
    }
    priorTags[pkg.name] = tags[plan.distTag] ?? null;
  }
  const snapshot = {
    schemaVersion: 1,
    sha: plan.sha,
    version: plan.version,
    channel: plan.channel,
    distTag: plan.distTag,
    stagingTag,
    artifactManifestSha512: manifestSha512,
    priorTags,
  };
  validatePromotionSnapshot({ snapshot, plan, policy, manifestSha512 });
  await artifactStore.writeSnapshot(artifactName, snapshot);
  return { snapshot, artifactName, created: true };
}

async function verifyTag({ pkg, tag, version, registryClient, clock, policy }) {
  for (let attempt = 1; attempt <= policy.retry.attempts; attempt += 1) {
    const tags = await registryClient.getDistTags(pkg.name);
    if (tags[tag] === version) return;
    if (attempt < policy.retry.attempts) await clock.sleep(policy.retry.delayMs);
  }
  throw new Error(`Public tag promotion verification failed for ${pkg.name}`);
}

export async function promoteRegistryTags({
  plan,
  policy,
  manifestSha512,
  snapshot,
  registryClient,
  clock,
  journal,
}) {
  validatePromotionSnapshot({ snapshot, plan, policy, manifestSha512 });
  const rootName = policy.promotion.rootPackageName;
  const rootPackage = plan.packages.find((pkg) => pkg.name === rootName);
  if (!rootPackage) throw new Error(`Release plan is missing root package ${rootName}`);
  const order = [...plan.packages.filter((pkg) => pkg.name !== rootName), rootPackage];
  for (const pkg of order) {
    const tags = await registryClient.getDistTags(pkg.name);
    if (tags[snapshot.stagingTag] !== plan.version) {
      const error = new Error(
        `Staging tag interference detected for ${pkg.name}: expected ${plan.version}, got ${tags[snapshot.stagingTag] ?? null}`,
      );
      await journal.writeEvent({
        phase: 'promote-tag',
        packageName: pkg.name,
        operation: 'promote',
        outcome: 'failed',
        error,
      });
      throw error;
    }
    const current = tags[plan.distTag] ?? null;
    const prior = snapshot.priorTags[pkg.name];
    if (current !== prior && current !== plan.version) {
      const error = new Error(
        `External interference detected on ${pkg.name} tag ${plan.distTag}: expected ${prior} or ${plan.version}, got ${current}`,
      );
      await journal.writeEvent({
        phase: 'promote-tag',
        packageName: pkg.name,
        operation: 'promote',
        outcome: 'failed',
        error,
      });
      throw error;
    }
    if (current === plan.version) {
      await journal.writeEvent({
        phase: 'promote-tag',
        packageName: pkg.name,
        operation: 'promote',
        outcome: 'skipped',
      });
      continue;
    }
    await journal.writeEvent({
      phase: 'promote-tag',
      packageName: pkg.name,
      operation: 'promote',
      outcome: 'started',
    });
    try {
      await registryClient.setDistTag(pkg.name, plan.version, plan.distTag);
      await verifyTag({ pkg, tag: plan.distTag, version: plan.version, registryClient, clock, policy });
    } catch (error) {
      await journal.writeEvent({
        phase: 'promote-tag',
        packageName: pkg.name,
        operation: 'promote',
        outcome: 'failed',
        error,
      });
      throw error;
    }
    await journal.writeEvent({
      phase: 'promote-tag',
      packageName: pkg.name,
      operation: 'promote',
      outcome: 'succeeded',
    });
  }
}
