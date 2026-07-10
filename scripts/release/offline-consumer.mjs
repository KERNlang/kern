import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

async function defaultRunCommand(file, args, options) {
  return execFileAsync(file, args, {
    cwd: options.cwd,
    timeout: options.timeout,
    maxBuffer: options.maxBuffer,
  });
}

function hasJavaScriptTarget(target) {
  if (typeof target === 'string') return /\.(?:[cm]?js)$/.test(target);
  if (Array.isArray(target)) return target.some(hasJavaScriptTarget);
  if (!target || typeof target !== 'object') return false;
  return Object.entries(target).some(
    ([condition, value]) => condition !== 'types' && hasJavaScriptTarget(value),
  );
}

function importableSpecifiers(exportsField, packageName) {
  if (exportsField === null || exportsField === undefined) return [packageName];
  if (typeof exportsField === 'string') {
    return hasJavaScriptTarget(exportsField) ? [packageName] : [];
  }
  if (!exportsField || typeof exportsField !== 'object' || Array.isArray(exportsField)) {
    throw new Error(`Invalid packed exports for ${packageName}`);
  }
  const keys = Object.keys(exportsField);
  if (!keys.some((key) => key.startsWith('.'))) {
    return hasJavaScriptTarget(exportsField) ? [packageName] : [];
  }
  return keys
    .filter(
      (key) =>
        (key === '.' || (key.startsWith('./') && !key.includes('*'))) &&
        hasJavaScriptTarget(exportsField[key]),
    )
    .map((key) => (key === '.' ? packageName : `${packageName}/${key.slice(2)}`));
}

function safePackageBinPath(tempDir, packageName, target) {
  if (typeof target !== 'string') {
    throw new Error(`Bin target for ${packageName} must be a string`);
  }
  const packageDir = path.resolve(tempDir, 'node_modules', packageName);
  const resolved = path.resolve(packageDir, target);
  const relative = path.relative(packageDir, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Bin target escapes package directory for ${packageName}: ${target}`);
  }
  return resolved;
}

export async function verifyOfflineConsumer({
  manifest,
  outDir,
  rootDir,
  limits,
  safeBins,
  consumerBuiltDependencies,
  importSmokeExclusions,
  keepTemp = false,
  runCommandFn = defaultRunCommand,
}) {
  if (
    !Number.isSafeInteger(limits?.commandTimeoutMs) ||
    limits.commandTimeoutMs <= 0 ||
    !Number.isSafeInteger(limits?.maxCommandOutputBytes) ||
    limits.maxCommandOutputBytes <= 0 ||
    !Number.isSafeInteger(limits?.smokeTimeoutMs) ||
    limits.smokeTimeoutMs <= 0
  ) {
    throw new Error('Missing or invalid artifact command timeout');
  }
  if (!Array.isArray(safeBins)) {
    throw new Error('safeBins must be an array');
  }
  if (!Array.isArray(consumerBuiltDependencies)) {
    throw new Error('consumerBuiltDependencies must be an array');
  }
  if (!Array.isArray(importSmokeExclusions)) {
    throw new Error('importSmokeExclusions must be an array');
  }

  const tempRoot = path.resolve(rootDir, '.release');
  fs.mkdirSync(tempRoot, { recursive: true });
  const tempDir = path.join(
    tempRoot,
    `temp-consumer-${crypto.randomBytes(8).toString('hex')}`,
  );
  const allowedBins = new Set(safeBins);
  const excludedImports = new Set(importSmokeExclusions);
  if (excludedImports.size !== importSmokeExclusions.length) {
    throw new Error('importSmokeExclusions must not contain duplicates');
  }
  for (const packageName of excludedImports) {
    const artifact = manifest.packages.find((candidate) => candidate.name === packageName);
    if (!artifact) {
      throw new Error(`Import smoke exclusion is not in the manifest: ${packageName}`);
    }
    if (Object.keys(artifact.bin ?? {}).length === 0) {
      throw new Error(`Import smoke exclusion has no executable surface: ${packageName}`);
    }
  }
  const invocations = [];

  try {
    fs.mkdirSync(tempDir, { recursive: false });
    fs.writeFileSync(path.join(tempDir, 'pnpm-workspace.yaml'), 'packages: []\n');
    fs.writeFileSync(
      path.join(tempDir, '.npmrc'),
      [
        'audit=false',
        'fund=false',
        'link-workspace-packages=false',
        '',
      ].join('\n'),
    );

    const absoluteOutDir = path.resolve(rootDir, outDir);
    const dependencies = {};
    for (const artifact of manifest.packages) {
      const tarballPath = path.resolve(absoluteOutDir, artifact.tarball);
      if (path.dirname(tarballPath) !== absoluteOutDir || !fs.statSync(tarballPath).isFile()) {
        throw new Error(`Missing exact tarball for offline consumer: ${artifact.tarball}`);
      }
      dependencies[artifact.name] = `file:${tarballPath}`;
    }

    const consumerPackage = {
      name: 'kern-release-offline-consumer',
      private: true,
      type: 'module',
      dependencies,
      pnpm: {
        overrides: dependencies,
        onlyBuiltDependencies: consumerBuiltDependencies,
      },
    };
    fs.writeFileSync(
      path.join(tempDir, 'package.json'),
      `${JSON.stringify(consumerPackage, null, 2)}\n`,
    );

    const run = async (file, args, timeout = limits.commandTimeoutMs) => {
      invocations.push({ file, args: [...args] });
      try {
        return await runCommandFn(file, args, {
          cwd: tempDir,
          timeout,
          maxBuffer: limits.maxCommandOutputBytes,
        });
      } catch (error) {
        const stdout = error.stdout?.toString() ?? '';
        const stderr = error.stderr?.toString() ?? '';
        throw new Error(
          `Offline consumer command failed: ${file} ${args.join(' ')}\n${stdout}\n${stderr}\n${error.message}`,
        );
      }
    };

    // Resolve and prime external, read-only dependencies first. The final
    // install remains offline and every KERN package is overridden to its
    // exact local tarball.
    await run('pnpm', [
      'install',
      '--lockfile-only',
      '--ignore-scripts',
      '--frozen-lockfile=false',
      '--prefer-offline',
    ]);
    await run('pnpm', ['fetch', '--prod', '--prefer-offline']);
    await run('pnpm', [
      'install',
      '--offline',
      '--frozen-lockfile',
    ]);

    const imports = manifest.packages.flatMap((artifact) =>
      excludedImports.has(artifact.name)
        ? []
        : importableSpecifiers(artifact.exports, artifact.name),
    );
    for (const specifier of imports) {
      await run(
        process.execPath,
        ['--input-type=module', '--eval', 'await import(process.argv[1])', specifier],
        limits.smokeTimeoutMs,
      );
    }

    const executedBins = [];
    for (const artifact of manifest.packages) {
      for (const [binName, target] of Object.entries(artifact.bin ?? {})) {
        if (!allowedBins.has(binName)) continue;
        const binPath = safePackageBinPath(tempDir, artifact.name, target);
        if (!fs.existsSync(binPath)) {
          throw new Error(`Safe bin script not found: ${artifact.name}/${target}`);
        }
        await run(process.execPath, [binPath, '--help'], limits.smokeTimeoutMs);
        executedBins.push(binName);
      }
    }
    return { imports, executedBins, invocations, tempDir: keepTemp ? tempDir : null };
  } finally {
    if (!keepTemp && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
}
