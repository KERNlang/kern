import zlib from 'node:zlib';

const TAR_BLOCK_BYTES = 512;
const PACKAGE_JSON_PATH = 'package/package.json';

function isZeroBlock(block) {
  return block.every((byte) => byte === 0);
}

function readNullTerminated(buffer) {
  const end = buffer.indexOf(0);
  return buffer.subarray(0, end === -1 ? buffer.length : end).toString('utf8');
}

function parseOctalSize(header, offset) {
  const raw = readNullTerminated(header.subarray(124, 136)).trim();
  if (!/^[0-7]+$/.test(raw)) {
    throw new Error(`Invalid size in tar header at offset ${offset}`);
  }
  const size = Number.parseInt(raw, 8);
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new Error(`Unsafe size in tar header at offset ${offset}`);
  }
  return size;
}

function assertLimits(limits) {
  for (const key of ['maxUnpackedBytes', 'maxPackageJsonBytes']) {
    if (!Number.isSafeInteger(limits?.[key]) || limits[key] <= 0) {
      throw new Error(`Missing or invalid tar limit: ${key}`);
    }
  }
}

export function readPackageJsonFromTarball(tarballBuffer, limits) {
  assertLimits(limits);
  if (!Buffer.isBuffer(tarballBuffer)) {
    throw new Error('Tarball input must be a Buffer');
  }

  let tarBuffer;
  try {
    tarBuffer = zlib.gunzipSync(tarballBuffer, {
      maxOutputLength: limits.maxUnpackedBytes,
    });
  } catch (error) {
    throw new Error(`Failed to decompress tarball: ${error.message}`);
  }
  if (tarBuffer.length > limits.maxUnpackedBytes) {
    throw new Error('Unpacked tarball exceeds configured byte limit');
  }

  let offset = 0;
  let packageJsonData;

  while (offset < tarBuffer.length) {
    if (offset + TAR_BLOCK_BYTES > tarBuffer.length) {
      throw new Error(`Truncated tarball header at offset ${offset}`);
    }

    const header = tarBuffer.subarray(offset, offset + TAR_BLOCK_BYTES);
    if (isZeroBlock(header)) {
      const remainder = tarBuffer.subarray(offset);
      if (!isZeroBlock(remainder)) {
        throw new Error('Tarball contains non-zero data after end marker');
      }
      break;
    }

    let name = readNullTerminated(header.subarray(0, 100));
    const magic = header.subarray(257, 263).toString('ascii');
    if (magic.startsWith('ustar')) {
      const prefix = readNullTerminated(header.subarray(345, 500));
      if (prefix) name = `${prefix}/${name}`;
    }

    const size = parseOctalSize(header, offset);
    const typeFlag = header[156];
    const dataOffset = offset + TAR_BLOCK_BYTES;
    const dataEnd = dataOffset + size;
    const paddedEnd = dataOffset + Math.ceil(size / TAR_BLOCK_BYTES) * TAR_BLOCK_BYTES;
    if (dataEnd > tarBuffer.length || paddedEnd > tarBuffer.length) {
      throw new Error(`Truncated tarball entry: ${name || '<unnamed>'}`);
    }

    if (name === PACKAGE_JSON_PATH) {
      if (packageJsonData !== undefined) {
        throw new Error(`Duplicate ${PACKAGE_JSON_PATH} in tarball`);
      }
      if (typeFlag !== 0 && typeFlag !== 48) {
        throw new Error(`${PACKAGE_JSON_PATH} must be a regular file`);
      }
      if (size > limits.maxPackageJsonBytes) {
        throw new Error(`${PACKAGE_JSON_PATH} exceeds configured byte limit`);
      }
      try {
        packageJsonData = JSON.parse(tarBuffer.subarray(dataOffset, dataEnd).toString('utf8'));
      } catch (error) {
        throw new Error(`Failed to parse package.json JSON: ${error.message}`);
      }
      if (!packageJsonData || typeof packageJsonData !== 'object' || Array.isArray(packageJsonData)) {
        throw new Error('Packed package.json must contain a JSON object');
      }
    }

    offset = paddedEnd;
  }

  if (packageJsonData === undefined) {
    throw new Error(`Missing ${PACKAGE_JSON_PATH} in tarball`);
  }
  return packageJsonData;
}
