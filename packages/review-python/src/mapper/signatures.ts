export const EXTRACTOR_VERSION = '1.0.0';

export const NETWORK_MODULES = new Set(['requests', 'httpx', 'aiohttp', 'urllib']);
export const NETWORK_METHODS = new Set([
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'head',
  'options',
  'request',
  'fetch',
]);

export const DB_MODULES = new Set(['psycopg2', 'asyncpg', 'pymongo', 'sqlalchemy', 'django']);
export const DB_METHODS = new Set([
  'execute',
  'executemany',
  'fetchone',
  'fetchall',
  'fetchmany',
  'query',
  'find',
  'find_one',
  'insert_one',
  'insert_many',
  'update_one',
  'delete_one',
]);

export const _FS_FUNCTIONS = new Set(['open', 'read', 'write', 'readlines', 'writelines']);

export const PY_API_ERROR_STATUS_CODES = new Set([401, 403, 404, 422, 500]);
export const PY_API_SUCCESS_STATUS_CODES = new Set([200, 201, 202, 204, 206]);
// FastAPI's documented default success status is 200, regardless of HTTP method
// (Codex plan-review #1, FastAPI docs:
// https://fastapi.tiangolo.com/tutorial/response-status-code/). 201 for POST is
// a per-route opt-in via `status_code=201`, not a method-derived default.
export const FASTAPI_DEFAULT_SUCCESS_STATUS = 200;
// Pagination anchor families — mirror the TS classification in
// `packages/review/src/concept-rules/cross-stack-utils.ts`. The size keys
// (`limit`, `take`, `page_size`, `per_page`) are intentionally NOT anchors
// — they're compatible with either offset or cursor pagination.
export const PY_PAGE_ANCHORS = new Set(['page', 'page_number', 'pageNumber']);
export const PY_OFFSET_ANCHORS = new Set(['offset', 'skip']);
export const PY_CURSOR_ANCHORS = new Set(['cursor', 'after', 'before', 'next', 'previous']);
export const PY_PAGINATION_RE = /\b(limit|offset|skip|cursor|page|page_size|per_page)\b|\.limit\s*\(/i;
export const PY_DB_COLLECTION_RE = /\.(find|all|fetchall|to_list|scalars)\s*\(|\bselect\s*\(/i;
export const PY_DB_WRITE_RE =
  /\.(insert_one|insert_many|update_one|update_many|delete_one|delete_many|add|create|save|commit)\s*\(/i;
export const PY_IDEMPOTENCY_RE =
  /\b(idempotency(?:[_-]?key)?|Idempotency-Key|transaction|unique|upsert|get_or_create|on_conflict)\b/i;

export const STDLIB_MODULES = new Set([
  'os',
  'sys',
  'json',
  're',
  'math',
  'datetime',
  'time',
  'logging',
  'argparse',
  'collections',
  'itertools',
  'functools',
  'pathlib',
  'shutil',
  'subprocess',
  'threading',
  'multiprocessing',
  'abc',
  'typing',
  'io',
  'pickle',
  'random',
  'hashlib',
  'hmac',
  'base64',
  'csv',
  'sqlite3',
  'zlib',
  'gzip',
  'tarfile',
  'zipfile',
  'enum',
  'struct',
  'tempfile',
  'unittest',
  'urllib',
  'uuid',
  'xml',
]);
