export function stringifyCanonical(value) {
  function sortKeys(val) {
    if (val === null || typeof val !== 'object') {
      return val;
    }
    if (Array.isArray(val)) {
      return val.map(sortKeys);
    }
    const sortedObj = {};
    const keys = Object.keys(val).sort();
    for (const key of keys) {
      sortedObj[key] = sortKeys(val[key]);
    }
    return sortedObj;
  }
  const sorted = sortKeys(value);
  const json = JSON.stringify(sorted, null, 2);
  if (json === undefined) {
    throw new Error('Canonical JSON value is not serializable');
  }
  // Ensure exactly LF line endings and one trailing newline
  return json.replace(/\r\n/g, '\n') + '\n';
}

export function normalizeExportsAndBin(pkgJson, pkgName) {
  let exports = pkgJson.exports !== undefined ? pkgJson.exports : null;

  let bin = null;
  if (pkgJson.bin !== undefined && pkgJson.bin !== null) {
    if (typeof pkgJson.bin === 'string') {
      const basename = pkgName.includes('/') ? pkgName.split('/').pop() : pkgName;
      bin = { [basename]: pkgJson.bin };
    } else if (typeof pkgJson.bin === 'object' && !Array.isArray(pkgJson.bin)) {
      bin = pkgJson.bin;
    }
  }

  return { exports, bin };
}
