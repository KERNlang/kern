import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const failures = [];

function fail(message) {
  failures.push(message);
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

  const { targetCount, ruleCount, mcpToolCount, mcpResourceCount, mcpPromptCount } = collectRepoFacts();
  const expectedPhrases = [
    `${targetCount} compile targets`,
    `compile to ${targetCount} targets`,
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
  const { pnpmVersion } = collectRepoFacts();
  const requiredPhrases = [
    `corepack prepare pnpm@${pnpmVersion} --activate`,
    'pnpm 10+',
    '130 rules',
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

function checkWorkflowContracts() {
  const { pnpmVersion } = collectRepoFacts();
  const rootPackageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (rootPackageJson.packageManager !== `pnpm@${pnpmVersion}`) {
    fail(
      `package.json must pin packageManager to pnpm@${pnpmVersion} (found ${rootPackageJson.packageManager})`,
    );
  }

  const workflowChecks = [
    {
      path: '.github/workflows/ci.yml',
      required: [
        "node-version: '22'",
        "python-version: '3.12'",
        `corepack prepare pnpm@${pnpmVersion} --activate`,
        'pnpm install --frozen-lockfile --ignore-scripts',
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
        'pnpm -r publish --no-git-checks --access public',
        'pnpm -r publish --dry-run --no-git-checks --access public',
      ],
      banned: [/pnpm\/action-setup/g, /cache:\s*['"]pnpm['"]/g],
    },
    {
      path: '.github/workflows/release-preflight.yml',
      required: [
        'name: Release Preflight',
        'Run this workflow from the main branch',
        'Version must be plain semver without a leading v',
        'uses: ./.github/workflows/release-pipeline.yml',
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
        'uses: ./.github/workflows/release-pipeline.yml',
        'publish: true',
      ],
      banned: [/pnpm\/action-setup/g, /cache:\s*['"]pnpm['"]/g],
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

checkReadme();
checkContributing();
checkWorkflowContracts();
checkPackages();

if (failures.length > 0) {
  console.error('Repo consistency check failed:\n');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('Repo consistency check passed.');
