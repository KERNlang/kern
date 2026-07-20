import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

import { readPackageJsonFromTarball } from './tar-entry.mjs';

const execFileAsync = promisify(execFile);
const BANNED_PACK_SCRIPTS = ['prepack', 'prepare', 'postpack', 'pack'];

async function defaultRunCommand(file, args, options) {
  const { stdout } = await execFileAsync(file, args, {
    cwd: options.cwd,
    timeout: options.timeout,
    maxBuffer: options.maxBuffer,
  });
  return stdout;
}

function assertLimits(limits) {
  for (const key of [
    'maxTarballBytes',
    'maxUnpackedBytes',
    'maxPackageJsonBytes',
    'maxCommandOutputBytes',
    'commandTimeoutMs',
  ]) {
    if (!Number.isSafeInteger(limits?.[key]) || limits[key] <= 0) {
      throw new Error(`Missing or invalid artifact limit: ${key}`);
    }
  }
}

function assertNoPackLifecycle(pkgJson, packagePath) {
  for (const script of BANNED_PACK_SCRIPTS) {
    if (pkgJson.scripts?.[script]) {
      throw new Error(
        `Package at ${packagePath} declares banned pack lifecycle script: ${script}`,
      );
    }
  }
}

function parsePackOutput(stdout, packageName) {
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch (error) {
    throw new Error(`Failed to parse pack output for ${packageName}: ${error.message}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Pack output for ${packageName} must be one JSON object`);
  }
  return parsed;
}

function listOutput(directory) {
  return fs.readdirSync(directory).sort();
}

export async function packArtifacts({
  plan,
  outDir,
  rootDir,
  limits,
  runCommandFn = defaultRunCommand,
}) {
  assertLimits(limits);
  const absoluteOutDir = path.resolve(rootDir, outDir);
  if (fs.existsSync(absoluteOutDir)) {
    if (!fs.statSync(absoluteOutDir).isDirectory()) {
      throw new Error(`Output path ${outDir} is not a directory`);
    }
    if (listOutput(absoluteOutDir).length > 0) {
      throw new Error(`Output directory ${outDir} is not empty`);
    }
  } else {
    fs.mkdirSync(absoluteOutDir, { recursive: true });
  }

  const packedInfo = [];
  const seenTarballs = new Set();

  for (const plannedPackage of plan.packages) {
    const sourcePackagePath = path.resolve(rootDir, plannedPackage.path, 'package.json');
    let sourcePackage;
    try {
      sourcePackage = JSON.parse(fs.readFileSync(sourcePackagePath, 'utf8'));
    } catch (error) {
      throw new Error(
        `Failed to read source package.json for ${plannedPackage.name}: ${error.message}`,
      );
    }
    if (sourcePackage.name !== plannedPackage.name) {
      throw new Error(
        `Source package name mismatch for ${plannedPackage.name}: got ${sourcePackage.name}`,
      );
    }
    if (sourcePackage.private === true) {
      throw new Error(`Planned package ${plannedPackage.name} is private`);
    }
    if (sourcePackage.version !== plan.version) {
      throw new Error(
        `Source package version mismatch for ${plannedPackage.name}: expected ${plan.version}, got ${sourcePackage.version}`,
      );
    }
    assertNoPackLifecycle(sourcePackage, plannedPackage.path);

    const before = new Set(listOutput(absoluteOutDir));
    let stdout;
    try {
      stdout = await runCommandFn(
        'pnpm',
        [
          '--dir',
          plannedPackage.path,
          'pack',
          '--pack-destination',
          absoluteOutDir,
          '--json',
        ],
        {
          cwd: rootDir,
          timeout: limits.commandTimeoutMs,
          maxBuffer: limits.maxCommandOutputBytes,
        },
      );
    } catch (error) {
      throw new Error(`Failed to pack package ${plannedPackage.name}: ${error.message}`);
    }

    const packResult = parsePackOutput(stdout, plannedPackage.name);
    if (packResult.name !== plannedPackage.name || packResult.version !== plan.version) {
      throw new Error(
        `Pack result identity mismatch for ${plannedPackage.name}: got ${packResult.name}@${packResult.version}`,
      );
    }
    if (typeof packResult.filename !== 'string' || !path.isAbsolute(packResult.filename)) {
      throw new Error(`Pack command returned an invalid filename for ${plannedPackage.name}`);
    }
    const reportedPath = path.resolve(packResult.filename);
    if (path.dirname(reportedPath) !== absoluteOutDir) {
      throw new Error(`Pack command wrote outside artifact directory: ${reportedPath}`);
    }
    const tarball = path.basename(reportedPath);
    if (!tarball.endsWith('.tgz')) {
      throw new Error(`Pack command returned non-tgz file: ${tarball}`);
    }
    if (seenTarballs.has(tarball)) {
      throw new Error(`Duplicate tarball filename: ${tarball}`);
    }

    const after = listOutput(absoluteOutDir);
    const additions = after.filter((entry) => !before.has(entry));
    if (additions.length !== 1 || additions[0] !== tarball) {
      throw new Error(
        `Pack command for ${plannedPackage.name} must create exactly one reported tarball`,
      );
    }
    if (!fs.statSync(reportedPath).isFile()) {
      throw new Error(`Packed artifact is not a regular file: ${reportedPath}`);
    }
    const tarballBytes = fs.readFileSync(reportedPath);
    if (tarballBytes.length > limits.maxTarballBytes) {
      throw new Error(`Tarball for ${plannedPackage.name} exceeds configured byte limit`);
    }
    const digest = crypto.createHash('sha512').update(tarballBytes).digest();
    const packedPackage = readPackageJsonFromTarball(tarballBytes, limits);
    assertNoPackLifecycle(packedPackage, `${plannedPackage.path}/[packed]`);

    packedInfo.push({
      name: plannedPackage.name,
      version: packedPackage.version,
      tarball,
      size: tarballBytes.length,
      sha512: digest.toString('hex'),
      integrity: `sha512-${digest.toString('base64')}`,
      pkgJson: packedPackage,
    });
    seenTarballs.add(tarball);
  }

  const outputFiles = listOutput(absoluteOutDir);
  if (
    outputFiles.length !== packedInfo.length ||
    outputFiles.some((entry) => !seenTarballs.has(entry))
  ) {
    throw new Error('Unexpected artifact output or artifact count mismatch');
  }
  return packedInfo;
}
