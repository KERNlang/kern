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
}

function normalizeRepoUrl(url) {
  return url.replace(/^git\+/, '').replace(/\.git$/, '');
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
  }
}

checkReadme();
checkPackages();

if (failures.length > 0) {
  console.error('Repo consistency check failed:\n');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('Repo consistency check passed.');
