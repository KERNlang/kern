export const EXTRACTOR_VERSION = 'fallback-1.0.0';

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
export const API_ERROR_STATUS_CODES = new Set([401, 403, 404, 422, 500]);
export const API_SUCCESS_STATUS_CODES_FB = new Set([200, 201, 202, 204, 206]);
export const FASTAPI_DEFAULT_SUCCESS_FB = 200;
export const FB_PAGE_ANCHORS = new Set(['page', 'page_number', 'pageNumber']);
export const FB_OFFSET_ANCHORS = new Set(['offset', 'skip']);
export const FB_CURSOR_ANCHORS = new Set(['cursor', 'after', 'before', 'next', 'previous']);
export const PAGINATION_RE = /\b(limit|offset|skip|cursor|page|page_size|per_page)\b|\.limit\s*\(/i;
export const DB_COLLECTION_RE = /\.(find|all|fetchall|to_list|scalars)\s*\(|\bselect\s*\(/i;
export const DB_WRITE_RE =
  /\.(insert_one|insert_many|update_one|update_many|delete_one|delete_many|add|create|save|commit)\s*\(/i;
export const IDEMPOTENCY_RE =
  /\b(idempotency(?:[_-]?key)?|Idempotency-Key|transaction|unique|upsert|get_or_create|on_conflict)\b/i;
export const STDLIB_MODULES = new Set([
  'argparse',
  'base64',
  'collections',
  'csv',
  'datetime',
  'enum',
  'functools',
  'gzip',
  'hashlib',
  'hmac',
  'io',
  'itertools',
  'json',
  'logging',
  'math',
  'multiprocessing',
  'os',
  'pathlib',
  'pickle',
  'random',
  're',
  'shutil',
  'sqlite3',
  'subprocess',
  'sys',
  'tarfile',
  'tempfile',
  'threading',
  'time',
  'typing',
  'unittest',
  'urllib',
  'uuid',
  'xml',
  'zipfile',
  'zlib',
]);
