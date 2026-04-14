/** Shared effect detection patterns for MCP transpilers (TS + Python). */

// ── TypeScript / JavaScript patterns ────────────────────────────────────

export const FILE_IO_PATTERN =
  /\b(readFile|readFileSync|writeFile|writeFileSync|readdir|readdirSync|unlink|unlinkSync|copyFile|rename|mkdir|rmdir|openSync|createReadStream|createWriteStream)\b/;

export const SHELL_EXEC_PATTERN = /\b(exec|execSync|execFile|execFileSync|spawn|spawnSync|child_process)\b/;

export const NETWORK_PATTERN = /\b(fetch|http\.request|https\.request|axios|got\.get|got\.post)\b/;

// ── Python patterns ─────────────────────────────────────────────────────

export const PY_FILE_IO_PATTERN =
  /\b(open|read|write|readlines|read_text|write_text|os\.path|os\.listdir|os\.remove|os\.unlink|os\.rename|os\.mkdir|shutil\.|pathlib\.|Path\s*\(|readFile|readFileSync|writeFile|readdir)\b/;

export const PY_SHELL_EXEC_PATTERN = /\b(subprocess|os\.system|os\.popen|execSync|execFile|spawn|spawnSync)\b/;

export const PY_NETWORK_PATTERN = /\b(requests\.|httpx\.|aiohttp\.|urllib\.|fetch|http\.request)\b/;
