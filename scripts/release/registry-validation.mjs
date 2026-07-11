const PACKAGE_NAME_RE = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const DIST_TAG_RE = /^[a-z][a-z0-9._-]*$/;
const EXACT_SEMVER_RE =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const CONTROL_CHARACTER_RE = /[\u0000-\u001f\u007f]/;

function assertBounded(value, label, maxBytes) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new Error(`${label} validation requires a positive byte limit`);
  }
  const byteLength = Buffer.byteLength(value, 'utf8');
  if (byteLength > maxBytes) {
    throw new Error(`${label} exceeds configured limit of ${maxBytes} bytes`);
  }
}

export function assertPackageName(packageName, maxBytes) {
  assertBounded(packageName, 'Package name', maxBytes);
  if (!PACKAGE_NAME_RE.test(packageName)) throw new Error('Package name is invalid');
}

export function assertDistTag(distTag, maxBytes) {
  assertBounded(distTag, 'Dist-tag', maxBytes);
  if (!DIST_TAG_RE.test(distTag) || EXACT_SEMVER_RE.test(distTag)) {
    throw new Error('Dist-tag is invalid');
  }
}

export function assertExactVersion(version, maxBytes) {
  assertBounded(version, 'Version', maxBytes);
  if (!EXACT_SEMVER_RE.test(version)) {
    throw new Error('Version must be an exact SemVer version');
  }
}

export function assertDeprecationMessage(message, maxBytes) {
  assertBounded(message, 'Deprecation message', maxBytes);
  if (CONTROL_CHARACTER_RE.test(message)) {
    throw new Error('Deprecation message contains control characters');
  }
}
