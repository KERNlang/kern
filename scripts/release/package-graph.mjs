import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const PACKAGE_NAME_RE = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;

function canonicalRelativePath(rootDir, packagePath) {
  return path.relative(rootDir, packagePath).split(path.sep).join('/');
}

export async function discoverPublicPackageGraph({ rootDir, packageRoots }) {
  const publicPackages = new Map();

  for (const rootDirName of packageRoots) {
    const rootPath = path.join(rootDir, rootDirName);
    let entries;
    try {
      entries = await readdir(rootPath, { withFileTypes: true });
    } catch (e) {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const packagePath = path.join(rootPath, entry.name);
      const packageJsonPath = path.join(packagePath, 'package.json');
      let statResult;
      try {
        statResult = await stat(packageJsonPath);
      } catch (e) {
        continue;
      }
      if (statResult.isFile()) {
        const manifestContent = await readFile(packageJsonPath, 'utf8');
        const manifest = JSON.parse(manifestContent);
        if (manifest.private === true) {
          continue;
        }
        if (
          typeof manifest.name !== 'string' ||
          manifest.name.length > 214 ||
          !PACKAGE_NAME_RE.test(manifest.name)
        ) {
          throw new Error(`Invalid package name at ${packagePath}: ${manifest.name}`);
        }
        if (publicPackages.has(manifest.name)) {
          throw new Error(`Duplicate package name: ${manifest.name}`);
        }
        publicPackages.set(manifest.name, {
          name: manifest.name,
          path: canonicalRelativePath(rootDir, packagePath),
          manifest,
        });
      }
    }
  }

  const graph = new Map();
  for (const [name, pkg] of publicPackages.entries()) {
    const deps = new Set();
    const collectDeps = (depSection) => {
      if (!depSection || typeof depSection !== 'object') return;
      for (const [depName, depVer] of Object.entries(depSection)) {
        if (typeof depVer === 'string' && depVer.startsWith('workspace:')) {
          if (!publicPackages.has(depName)) {
            throw new Error(`Missing workspace dependency: ${depName} for ${name}`);
          }
          deps.add(depName);
        }
      }
    };
    collectDeps(pkg.manifest.dependencies);
    collectDeps(pkg.manifest.optionalDependencies);
    graph.set(name, {
      name,
      path: pkg.path,
      dependencies: [...deps].sort(),
    });
  }

  const visited = new Map();
  const result = [];

  const visit = (name, pathTrace = []) => {
    const status = visited.get(name);
    if (status === 1) {
      const cyclePath = [...pathTrace, name].join(' -> ');
      throw new Error(`Dependency cycle detected: ${cyclePath}`);
    }
    if (status === 2) {
      return;
    }

    visited.set(name, 1);
    const node = graph.get(name);
    const nextPathTrace = [...pathTrace, name];
    for (const dep of node.dependencies) {
      visit(dep, nextPathTrace);
    }
    visited.set(name, 2);
    result.push(node);
  };

  for (const name of [...graph.keys()].sort()) {
    visit(name);
  }

  return result;
}
