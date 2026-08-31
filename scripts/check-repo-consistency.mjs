import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

import { validateReleasePolicy } from './release/policy.mjs';
import { loadKern5FitnessContract } from './kern-5-fitness.mjs';

const root = process.cwd();
const failures = [];

function fail(message) {
  failures.push(message);
}

function checkKern5FitnessContract() {
  try {
    loadKern5FitnessContract(root);
  } catch (error) {
    fail(`KERN 5 fitness contract: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function checkReadme() {
  const readmePath = path.join(root, 'README.md');
  const readme = readFileSync(readmePath, 'utf8');
  const { pnpmVersion } = collectRepoFacts();
  const bannedPatterns = [
    {
      pattern: /pnpm\/action-setup/g,
      message:
        'README.md still references pnpm/action-setup; docs should use the repo-standard Corepack activation flow.',
    },
    {
      pattern: /cache:\s*['"]pnpm['"]/g,
      message:
        "README.md still references actions/setup-node cache: 'pnpm'; this breaks when pnpm is activated later via Corepack.",
    },
  ];

  for (const { pattern, message } of bannedPatterns) {
    if (pattern.test(readme)) {
      fail(message);
    }
  }

  const { ruleCount, mcpToolCount, mcpResourceCount, mcpPromptCount } = collectRepoFacts();
  const expectedPhrases = [
    'One backend spec. Real TypeScript and Python output.',
    'backend structure and portable route-logic language',
    'Primary backend parity path',
    'generated Express and FastAPI structure that stays aligned',
    `${ruleCount} review rules`,
    `${ruleCount} AST-based rules`,
    `**${ruleCount} rules**`,
    `Static analysis (${ruleCount} rules, taint tracking)`,
    `**${mcpToolCount} tools**`,
    `**${mcpResourceCount} resources:**`,
    `**${mcpPromptCount} prompt:**`,
    'Contributor architecture guide: [docs/architecture.md](docs/architecture.md)',
    `corepack prepare pnpm@${pnpmVersion} --activate`,
  ];

  for (const phrase of expectedPhrases) {
    if (!readme.includes(phrase)) {
      fail(`README.md is missing expected verified phrase: "${phrase}"`);
    }
  }
}

function checkContributing() {
  const contributingPath = path.join(root, 'CONTRIBUTING.md');
  const contributing = readFileSync(contributingPath, 'utf8');
  const { pnpmVersion, ruleCount } = collectRepoFacts();
  const requiredPhrases = [
    `corepack prepare pnpm@${pnpmVersion} --activate`,
    'pnpm 10+',
    `${ruleCount} rules`,
    'Architecture guide: [docs/architecture.md](docs/architecture.md)',
    'Run `Release Preflight` from `main` before tagging a release.',
    'Publish GitHub Releases with lowercase tags like `v3.2.4`.',
  ];
  const bannedPhrases = ['pnpm 9+', '76 rules'];

  for (const phrase of requiredPhrases) {
    if (!contributing.includes(phrase)) {
      fail(`CONTRIBUTING.md is missing expected phrase: "${phrase}"`);
    }
  }

  for (const phrase of bannedPhrases) {
    if (contributing.includes(phrase)) {
      fail(`CONTRIBUTING.md still contains stale phrase: "${phrase}"`);
    }
  }
}

function collectPolicyPublicPackageNames(policy) {
  const packageNames = new Map();
  for (const packageRoot of policy.packageRoots) {
    const absoluteRoot = path.join(root, packageRoot);
    if (!existsSync(absoluteRoot)) {
      fail(`Release policy package root does not exist: ${packageRoot}`);
      continue;
    }
    for (const entry of readdirSync(absoluteRoot)) {
      const packageJsonPath = path.join(absoluteRoot, entry, 'package.json');
      if (!existsSync(packageJsonPath)) continue;
      let pkg;
      try {
        pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
      } catch (error) {
        fail(`${path.relative(root, packageJsonPath)} is invalid JSON: ${error.message}`);
        continue;
      }
      if (pkg.private === true) continue;
      if (typeof pkg.name !== 'string' || pkg.name.length === 0) {
        fail(`${path.relative(root, packageJsonPath)}: public release package must have a name`);
        continue;
      }
      const previous = packageNames.get(pkg.name);
      if (previous) {
        fail(`Duplicate public release package name ${pkg.name}: ${previous} and ${packageJsonPath}`);
        continue;
      }
      packageNames.set(pkg.name, packageJsonPath);
    }
  }
  return packageNames;
}

function checkReleaseWorkflowToolchain(workflowPath, contents, releasePolicy) {
  const nodePins = [...contents.matchAll(/node-version:\s*['"]?([1-9]\d*)['"]?/g)].map(
    (match) => Number.parseInt(match[1], 10),
  );
  if (nodePins.length !== 1 || nodePins[0] !== releasePolicy.release.nodeMajor) {
    fail(
      `${workflowPath} must pin exactly Node ${releasePolicy.release.nodeMajor} from release policy (found ${nodePins.join(', ') || 'none'})`,
    );
  }

  const packageManagerPins = [...contents.matchAll(/corepack prepare ([^\s]+) --activate/g)].map(
    (match) => match[1],
  );
  if (
    packageManagerPins.length !== 1 ||
    packageManagerPins[0] !== releasePolicy.release.packageManager
  ) {
    fail(
      `${workflowPath} must activate exactly ${releasePolicy.release.packageManager} from release policy (found ${packageManagerPins.join(', ') || 'none'})`,
    );
  }
}

function checkWorkflowContracts() {
  const { pnpmVersion } = collectRepoFacts();
  const rootPackageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (rootPackageJson.packageManager !== `pnpm@${pnpmVersion}`) {
    fail(
      `package.json must pin packageManager to pnpm@${pnpmVersion} (found ${rootPackageJson.packageManager})`,
    );
  }
  if (rootPackageJson.scripts?.['test:release-policy'] !== 'node --test scripts/release/*.test.mjs') {
    fail('package.json must expose the complete release-policy test wall as test:release-policy.');
  }

  const releasePolicyPath = path.join(root, 'scripts', 'release', 'release-policy.json');
  let releasePolicy;
  try {
    releasePolicy = JSON.parse(readFileSync(releasePolicyPath, 'utf8'));
    validateReleasePolicy(releasePolicy);
  } catch (error) {
    fail(`scripts/release/release-policy.json is invalid: ${error.message}`);
    releasePolicy = null;
  }

  if (releasePolicy) {
    if (rootPackageJson.packageManager !== releasePolicy.release.packageManager) {
      fail(
        `package.json packageManager (${rootPackageJson.packageManager}) must equal release policy packageManager (${releasePolicy.release.packageManager})`,
      );
    }
    const publicPackageNames = collectPolicyPublicPackageNames(releasePolicy);
    if (publicPackageNames.size !== releasePolicy.release.expectedPublicPackageCount) {
      fail(
        `Release policy expected ${releasePolicy.release.expectedPublicPackageCount} public packages but discovered ${publicPackageNames.size}`,
      );
    }
    for (const name of releasePolicy.recovery.entryPackageNames) {
      if (!publicPackageNames.has(name)) {
        fail(`Recovery entry package is not a discovered public release package: ${name}`);
      }
    }
  }

  const workflowChecks = [
    {
      path: '.github/workflows/ci.yml',
      required: [
        "node-version: '22'",
        "python-version: '3.12'",
        `corepack prepare pnpm@${pnpmVersion} --activate`,
        'pnpm install --frozen-lockfile --ignore-scripts',
        'pnpm test:kern',
      ],
      banned: [/pnpm\/action-setup/g, /cache:\s*['"]pnpm['"]/g],
    },
    {
      path: '.github/workflows/release-pipeline.yml',
      required: [
        'workflow_call:',
        'publish:',
        "registry-url: 'https://registry.npmjs.org'",
        `corepack prepare pnpm@${pnpmVersion} --activate`,
        'pnpm install --frozen-lockfile',
        'pnpm test:kern',
        'node scripts/release/plan-cli.mjs',
        'channel:\n        description: Release channel\n        required: true\n        type: string',
        'node scripts/release/registry-cli.mjs --mode publish-pack',
        'node scripts/release/registry-cli.mjs --mode publish-reconcile',
        'node scripts/release/registry-cli.mjs --mode publish-snapshot',
        'node scripts/release/registry-cli.mjs --mode publish-promote',
        'node scripts/release/registry-cli.mjs --mode publish-smoke',
        'id: publish-promote',
        'id: publish-smoke',
        'node scripts/release/registry-cli.mjs\n          --mode publish-recover',
        '--recovery-reason post-promotion-smoke-failed',
        "steps.publish-promote.outcome == 'success'",
        "steps.publish-smoke.outcome == 'failure'",
        'uses: actions/upload-artifact@v7',
        'Confirm durable bundle',
        'Confirm durable promotion snapshot',
        'node scripts/release/registry-cli.mjs --mode preflight',
        "success() && inputs.publish && steps.release-plan.outputs.dist_tag == 'latest'",
        'git checkout -B "release/sync-v${RELEASE_VERSION}" HEAD',
        'git push --no-verify origin "release/sync-v${RELEASE_VERSION}"',
      ],
      banned: [
        /pnpm\/action-setup/g,
        /cache:\s*['"]pnpm['"]/g,
        /pnpm -r publish/g,
        new RegExp(['origin', 'dev'].join('/'), 'g'),
        new RegExp(['syncs', 'dev'].join('_'), 'g'),
      ],
    },
    {
      path: '.github/workflows/release-preflight.yml',
      required: [
        'name: Release Preflight',
        'Run this workflow from the main branch',
        'Version must be plain semver without a leading v',
        'uses: ./.github/workflows/release-pipeline.yml',
        'channel: stable',
        'publish: false',
      ],
      banned: [],
    },
    {
      path: '.github/workflows/release.yml',
      required: [
        'name: Version & Publish',
        "^v[0-9]+\\.[0-9]+\\.[0-9]+$",
        'Release tags must use lowercase v and semver',
        'cancel-in-progress: false',
        'uses: ./.github/workflows/release-pipeline.yml',
        'channel: stable',
        'publish: true',
      ],
      banned: [/pnpm\/action-setup/g, /cache:\s*['"]pnpm['"]/g],
    },
    {
      path: '.github/workflows/canary-publish.yml',
      required: [
        'cancel-in-progress: false',
        "github.event_name == 'workflow_dispatch'",
        "github.ref_name == 'main'",
        'node scripts/release/plan-cli.mjs',
        '--channel canary',
        '--tag "$NPM_TAG"',
      ],
      banned: [/npm_tag:/g, /NPM_TAG_INPUT/g, /workflow_run:/g, /branches:\s*\[dev\]/g, /pnpm -r publish/g],
    },
  ];

  for (const workflow of workflowChecks) {
    const workflowPath = path.join(root, workflow.path);
    const contents = readFileSync(workflowPath, 'utf8');

    for (const phrase of workflow.required) {
      if (!contents.includes(phrase)) {
        fail(`${workflow.path} is missing expected workflow contract phrase: "${phrase}"`);
      }
    }

    for (const pattern of workflow.banned) {
      if (pattern.test(contents)) {
        fail(`${workflow.path} contains banned workflow pattern: ${pattern}`);
      }
    }

    if (
      releasePolicy &&
      ['.github/workflows/release-pipeline.yml', '.github/workflows/canary-publish.yml'].includes(
        workflow.path,
      )
    ) {
      checkReleaseWorkflowToolchain(workflow.path, contents, releasePolicy);
    }
  }

  const workflowDir = path.join(root, '.github/workflows');
  for (const name of readdirSync(workflowDir).filter((entry) => /\.ya?ml$/.test(entry))) {
    const contents = readFileSync(path.join(workflowDir, name), 'utf8');
    if (/pnpm -r publish/.test(contents)) {
      fail(`.github/workflows/${name} contains banned recursive workspace publication`);
    }
  }
}

function normalizeRepoUrl(url) {
  return url.replace(/^git\+/, '').replace(/\.git$/, '');
}

function sourcePathForPackageDistPath(packageDir, filePath) {
  if (!filePath.startsWith('./dist/')) return null;
  const relative = filePath.slice('./dist/'.length);
  const tsRelative = relative.replace(/\.d\.ts$|\.js$/g, '.ts');
  return path.join(packageDir, 'src', tsRelative);
}

function checkPackages() {
  const packagesDir = path.join(root, 'packages');
  const packageDirs = readdirSync(packagesDir).filter((entry) =>
    existsSync(path.join(packagesDir, entry, 'package.json')),
  );

  for (const dir of packageDirs) {
    const packageJsonPath = path.join(packagesDir, dir, 'package.json');
    const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
    const repo = pkg.repository;

    if (!repo || typeof repo !== 'object') {
      continue;
    }

    if (typeof repo.url !== 'string') {
      fail(`${packageJsonPath}: repository.url must be a string`);
      continue;
    }

    const normalizedUrl = normalizeRepoUrl(repo.url);
    if (normalizedUrl !== 'https://github.com/KERNlang/kern') {
      fail(
        `${packageJsonPath}: repository.url must point to https://github.com/KERNlang/kern (found ${repo.url})`,
      );
    }

    const expectedDirectory = `packages/${dir}`;
    if (repo.directory && repo.directory !== expectedDirectory) {
      fail(
        `${packageJsonPath}: repository.directory should be ${expectedDirectory} (found ${repo.directory})`,
      );
    }

    const packageDir = path.join(packagesDir, dir);
    for (const entry of readdirSync(packageDir)) {
      if (entry.endsWith('.tgz')) {
        fail(`${path.join('packages', dir, entry)}: packed release tarballs must live under .release only`);
      }
    }

    for (const [binName, binPath] of Object.entries(pkg.bin || {})) {
      if (typeof binPath !== 'string') {
        fail(`${packageJsonPath}: bin entry "${binName}" must be a string`);
        continue;
      }
      const sourcePath = sourcePathForPackageDistPath(packageDir, binPath);
      if (!sourcePath || !existsSync(sourcePath)) {
        fail(
          `${packageJsonPath}: bin entry "${binName}" points to ${binPath}, but no matching source file was found under src/`,
        );
      }
    }

    const exportsField = pkg.exports || {};
    for (const [exportKey, exportValue] of Object.entries(exportsField)) {
      const pathsToCheck = [];
      if (typeof exportValue === 'string') {
        pathsToCheck.push(exportValue);
      } else if (exportValue && typeof exportValue === 'object') {
        for (const value of Object.values(exportValue)) {
          if (typeof value === 'string') pathsToCheck.push(value);
        }
      }

      for (const exportPath of pathsToCheck) {
        const sourcePath = sourcePathForPackageDistPath(packageDir, exportPath);
        if (!sourcePath || !existsSync(sourcePath)) {
          fail(
            `${packageJsonPath}: export "${exportKey}" points to ${exportPath}, but no matching source file was found under src/`,
          );
        }
      }
    }
  }
}

function collectRepoFacts() {
  const rootPackageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  const packageManager = rootPackageJson.packageManager;
  const packageManagerMatch = typeof packageManager === 'string' ? packageManager.match(/^pnpm@(.+)$/) : null;
  const pnpmVersion = packageManagerMatch?.[1] ?? null;

  if (!pnpmVersion) {
    fail(`package.json must declare packageManager as pnpm@<version> (found ${packageManager})`);
  }

  const configPath = path.join(root, 'packages', 'core', 'src', 'config.ts');
  const config = readFileSync(configPath, 'utf8');
  const targetMatch = config.match(/export const VALID_TARGETS:[^=]*= \[([\s\S]*?)\]/);
  const targetCount = targetMatch ? [...targetMatch[1].matchAll(/'([^']+)'/g)].length : 0;

  const rulesPath = path.join(root, 'packages', 'review', 'src', 'rules', 'index.ts');
  const rules = readFileSync(rulesPath, 'utf8');
  const ruleCount = new Set([...rules.matchAll(/\bid:\s*'([^']+)'/g)].map((match) => match[1])).size;

  const mcpServerPath = path.join(root, 'packages', 'mcp-server', 'src', 'index.ts');
  const mcpServer = readFileSync(mcpServerPath, 'utf8');
  const mcpToolCount = [...mcpServer.matchAll(/server\.tool\(/g)].length;
  const mcpResourceCount = [...mcpServer.matchAll(/server\.resource\(/g)].length;
  const mcpPromptCount = [...mcpServer.matchAll(/server\.prompt\(/g)].length;

  return { pnpmVersion, targetCount, ruleCount, mcpToolCount, mcpResourceCount, mcpPromptCount };
}

function checkKernVersion() {
  const rootPackageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  const rootVersion = rootPackageJson.version;

  const specPath = path.join(root, 'packages', 'core', 'src', 'spec.ts');
  const spec = readFileSync(specPath, 'utf8');
  const match = spec.match(/export const KERN_VERSION = ['"]([^'"]+)['"]/);
  if (!match) {
    fail('packages/core/src/spec.ts must export `KERN_VERSION` as a string literal.');
    return;
  }
  if (match[1] !== rootVersion) {
    fail(
      `packages/core/src/spec.ts KERN_VERSION (${match[1]}) must equal root package.json version (${rootVersion}). The release pipeline jq-sweeps every package.json on a tag — KERN_VERSION must be bumped in lockstep so the @generated header in compiled output is truthful.`,
    );
  }
}

function checkPackageVersions() {
  const rootPackageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  const rootVersion = rootPackageJson.version;
  const packagesDir = path.join(root, 'packages');
  const packageDirs = readdirSync(packagesDir).filter((entry) =>
    existsSync(path.join(packagesDir, entry, 'package.json')),
  );

  for (const dir of packageDirs) {
    const packageJsonPath = path.join(packagesDir, dir, 'package.json');
    const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
    if (pkg.private === true) continue;
    if (pkg.version !== rootVersion) {
      fail(
        `${packageJsonPath}: version (${pkg.version}) must equal root package.json version (${rootVersion}). Release publishes every @kernlang package together so npm consumers never lag behind internal workspace packages.`,
      );
    }
  }
}

checkReadme();
checkContributing();
checkWorkflowContracts();
checkPackages();
checkPackageVersions();
checkKernVersion();
checkKern5FitnessContract();

if (failures.length > 0) {
  console.error('Repo consistency check failed:\n');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('Repo consistency check passed.');
