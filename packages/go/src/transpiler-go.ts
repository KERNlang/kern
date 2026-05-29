import type { AccountedEntry, GeneratedArtifact, IRNode, ResolvedKernConfig, TranspileResult } from '@kernlang/core';
import {
  accountNode,
  buildDiagnostics,
  countTokens,
  getChildren,
  getFirstChild,
  getProps,
  serializeIR,
} from '@kernlang/core';

type GoField = { name: string; goName: string; type: string; optional: boolean };
type GoInterface = { name: string; fields: GoField[] };

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options']);
const GO_KEYWORDS = new Set([
  'break',
  'default',
  'func',
  'interface',
  'select',
  'case',
  'defer',
  'go',
  'map',
  'struct',
  'chan',
  'else',
  'goto',
  'package',
  'switch',
  'const',
  'fallthrough',
  'if',
  'range',
  'type',
  'continue',
  'for',
  'import',
  'return',
  'var',
]);

function findServerNode(root: IRNode): IRNode {
  if (root.type === 'server') return root;
  return getFirstChild(root, 'server') ?? root;
}

function upperFirst(value: string): string {
  return value.length === 0 ? value : `${value[0].toUpperCase()}${value.slice(1)}`;
}

function goIdent(value: string, exported = false): string {
  const cleaned = value
    .replace(/[^A-Za-z0-9_]/g, '_')
    .replace(/^([0-9])/, '_$1')
    .replace(/_+([A-Za-z0-9])/g, (_m, c: string) => c.toUpperCase());
  const ident = cleaned.length > 0 ? cleaned : 'value';
  const cased = exported ? upperFirst(ident) : `${ident[0].toLowerCase()}${ident.slice(1)}`;
  return GO_KEYWORDS.has(cased) ? `${cased}_` : cased;
}

function handlerName(method: string, path: string): string {
  const parts = path
    .split('/')
    .filter(Boolean)
    .map((part) => part.replace(/^:/, 'by_'));
  return goIdent(`${method}_${parts.join('_') || 'root'}_handler`);
}

function collectInterfaces(root: IRNode, serverNode: IRNode): GoInterface[] {
  const candidates = [
    ...(root.children || []),
    ...(serverNode !== root ? serverNode.children || [] : []),
    ...(root.type === 'interface' ? [root] : []),
  ];
  const seen = new Set<string>();
  const interfaces: GoInterface[] = [];
  for (const node of candidates) {
    if (node.type !== 'interface') continue;
    const props = getProps(node);
    const rawName = String(props.name || '');
    if (!rawName || seen.has(rawName)) continue;
    seen.add(rawName);
    interfaces.push({
      name: goIdent(rawName, true),
      fields: getChildren(node, 'field').map((field) => {
        const fp = getProps(field);
        const fieldName = String(fp.name || 'field');
        return {
          name: fieldName,
          goName: goIdent(fieldName, true),
          type: mapGoType(String(fp.type || 'any')),
          optional: fp.optional === true || fp.optional === 'true',
        };
      }),
    });
  }
  return interfaces;
}

function mapGoType(raw: string): string {
  const type = raw.trim().replace(/\s/g, '');
  if (type.endsWith('[]')) return `[]${mapGoType(type.slice(0, -2))}`;
  if (/^Array<(.+)>$/.test(type)) return `[]${mapGoType(type.replace(/^Array<(.+)>$/, '$1'))}`;
  switch (type) {
    case 'string':
      return 'string';
    case 'number':
    case 'float':
    case 'float64':
      return 'float64';
    case 'int':
    case 'integer':
      return 'int';
    case 'boolean':
    case 'bool':
      return 'bool';
    case 'any':
    case 'unknown':
    case 'object':
      return 'kernrt.Value';
    default:
      if (type.includes('|') || type.includes('{') || type.includes('=>')) return 'kernrt.Value';
      return goIdent(type, true);
  }
}

function extractExprCode(prop: unknown): string {
  if (typeof prop === 'object' && prop !== null && (prop as { __expr?: unknown }).__expr === true) {
    return String((prop as { code?: unknown }).code || '');
  }
  return typeof prop === 'string' ? prop : '';
}

function splitTopLevel(input: string, sep: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let escaped = false;
  let start = 0;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '{' || ch === '[' || ch === '(') depth++;
    else if (ch === '}' || ch === ']' || ch === ')') depth--;
    else if (ch === sep && depth === 0) {
      parts.push(input.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(input.slice(start).trim());
  return parts.filter(Boolean);
}

function lowerStringLiteral(expr: string): string | null {
  const trimmed = expr.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return JSON.stringify(trimmed.slice(1, -1));
  }
  return null;
}

function lowerObjectLiteral(expr: string, locals: Set<string>): string | null {
  const trimmed = expr.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null;
  const inner = trimmed.slice(1, -1).trim();
  if (!inner) return 'map[string]interface{}{}';
  const entries = splitTopLevel(inner, ',').map((entry) => {
    const colon = splitTopLevel(entry, ':');
    if (colon.length < 2) throw new Error(`KERN-Go cannot lower object entry '${entry}'`);
    const key = colon[0].trim().replace(/^['"]|['"]$/g, '');
    const value = colon.slice(1).join(':');
    return `${JSON.stringify(key)}: ${lowerGoExpr(value, locals)}`;
  });
  return `map[string]interface{}{${entries.join(', ')}}`;
}

function lowerGoExpr(expr: string, locals: Set<string>): string {
  const trimmed = expr.trim().replace(/;$/, '');
  const stringLiteral = lowerStringLiteral(trimmed);
  if (stringLiteral) return stringLiteral;
  const objectLiteral = lowerObjectLiteral(trimmed, locals);
  if (objectLiteral) return objectLiteral;
  if (trimmed === 'true' || trimmed === 'false') return trimmed;
  if (trimmed === 'null' || trimmed === 'undefined') return 'nil';
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return trimmed;
  if (locals.has(trimmed)) return trimmed;

  let lowered = trimmed;
  lowered = lowered.replace(
    /\bbody\.([A-Za-z_]\w*)/g,
    (_m, field: string) => `kernrt.Get(body, ${JSON.stringify(field)})`,
  );
  lowered = lowered.replace(
    /\bquery\.([A-Za-z_]\w*)/g,
    (_m, field: string) => `kernrt.Get(query, ${JSON.stringify(field)})`,
  );
  lowered = lowered.replace(
    /\bparams\.([A-Za-z_]\w*)/g,
    (_m, field: string) => `kernrt.Get(params, ${JSON.stringify(field)})`,
  );
  lowered = lowered.replace(
    /\bheaders\.([A-Za-z_][\w-]*)/g,
    (_m, field: string) => `kernrt.Get(headers, ${JSON.stringify(field)})`,
  );
  lowered = lowered.replace(/\b([A-Za-z_]\w*)\.result\b/g, '$1');
  lowered = lowered.replace(
    /\b([A-Za-z_]\w*)\s*([+\-*/])\s*(\d+(?:\.\d+)?)\b/g,
    (_m, left: string, op: string, right: string) =>
      locals.has(left) ? `kernrt.Number(${left}) ${op} ${right}` : `${left} ${op} ${right}`,
  );
  lowered = lowered.replace(
    /\bkernrt\.Get\(([^)]+)\)\s*([+\-*/])\s*(\d+(?:\.\d+)?)\b/g,
    'kernrt.Number(kernrt.Get($1)) $2 $3',
  );
  lowered = lowered.replace(
    /\b([A-Za-z_]\w*)\s*(>=|<=|>|<)\s*(\d+(?:\.\d+)?)\b/g,
    (_m, left: string, op: string, right: string) =>
      locals.has(left) ? `kernrt.Number(${left}) ${op} ${right}` : `${left} ${op} ${right}`,
  );
  lowered = lowered.replace(
    /\bkernrt\.Get\(([^)]+)\)\s*(>=|<=|>|<)\s*(\d+(?:\.\d+)?)\b/g,
    'kernrt.Number(kernrt.Get($1)) $2 $3',
  );
  lowered = lowered.replace(/([^?\s]+)\s*\?\?\s*([^?\s]+)/g, 'kernrt.Coalesce($1, $2)');
  return lowered;
}

function routeBodyType(route: IRNode): string | undefined {
  const schema = getFirstChild(route, 'schema');
  const schemaBody = schema ? getProps(schema).body : undefined;
  if (typeof schemaBody === 'string' && /^[A-Za-z_]\w*$/.test(schemaBody)) return goIdent(schemaBody, true);
  const validate = getFirstChild(route, 'validate');
  const validateSchema = validate ? getProps(validate).schema : undefined;
  if (typeof validateSchema === 'string' && /^[A-Za-z_]\w*$/.test(validateSchema)) return goIdent(validateSchema, true);
  return undefined;
}

function emitTypes(interfaces: GoInterface[]): string {
  const needsRuntime = interfaces.some((iface) => iface.fields.some((field) => field.type.includes('kernrt.')));
  const lines = needsRuntime ? ['package main', '', 'import "kernapp/kernrt"', ''] : ['package main', ''];
  if (interfaces.length === 0) {
    lines.push('type EmptyRequest struct{}', '');
  }
  for (const iface of interfaces) {
    lines.push(`type ${iface.name} struct {`);
    for (const field of iface.fields) {
      const tag = field.optional ? `json:"${field.name},omitempty"` : `json:"${field.name}"`;
      lines.push(`\t${field.goName} ${field.type} \`${tag}\``);
    }
    lines.push('}', '');
  }
  return lines.join('\n');
}

function emitRoute(route: IRNode, index: number): string {
  const props = getProps(route);
  const method = String(props.method || 'get').toLowerCase();
  const normalizedMethod = HTTP_METHODS.has(method) ? method : 'get';
  const path = String(props.path || '/');
  const fn = handlerName(normalizedMethod, path || `route_${index}`);
  const bodyType = routeBodyType(route);
  const locals = new Set<string>();
  const lines: string[] = [];
  lines.push(`func ${fn}(w http.ResponseWriter, r *http.Request) {`);
  lines.push(`\tif r.Method != ${JSON.stringify(normalizedMethod.toUpperCase())} {`);
  lines.push('\t\twriteJSON(w, http.StatusMethodNotAllowed, map[string]interface{}{"detail": "method not allowed"})');
  lines.push('\t\treturn');
  lines.push('\t}');
  lines.push('\tbody := map[string]interface{}{}');
  if (bodyType) {
    lines.push(`\tvar typedBody ${bodyType}`);
    lines.push('\tif r.Body != nil {');
    lines.push('\t\tif err := json.NewDecoder(r.Body).Decode(&typedBody); err != nil {');
    lines.push('\t\t\twriteJSON(w, http.StatusBadRequest, map[string]interface{}{"detail": "invalid JSON body"})');
    lines.push('\t\t\treturn');
    lines.push('\t\t}');
    lines.push('\t\tbody = kernrt.StructMap(typedBody)');
    lines.push('\t}');
  } else {
    lines.push('\tif r.Body != nil {');
    lines.push('\t\t_ = json.NewDecoder(r.Body).Decode(&body)');
    lines.push('\t}');
  }
  lines.push('\tquery := kernrt.QueryMap(r.URL.Query())');
  lines.push('\tparams := map[string]interface{}{}');
  lines.push('\theaders := kernrt.HeaderMap(r.Header)');
  lines.push('\t_ = query');
  lines.push('\t_ = params');
  lines.push('\t_ = headers');
  for (const child of route.children || []) {
    const p = getProps(child);
    if (child.type === 'derive') {
      const name = goIdent(String(p.name || 'value'));
      const exprCode = extractExprCode(p.expr);
      if (exprCode) {
        lines.push(`\t${name} := ${lowerGoExpr(exprCode, locals)}`);
        locals.add(name);
      }
    } else if (child.type === 'guard') {
      const name = String(p.name || '');
      const exprCode = extractExprCode(p.expr);
      const status = p.else ? Number.parseInt(String(p.else), 10) : 404;
      const message = typeof p.message === 'string' ? p.message : name ? `${name} guard failed` : 'Guard failed';
      if (exprCode) {
        lines.push(`\tif !kernrt.Truthy(${lowerGoExpr(exprCode, locals)}) {`);
        lines.push(
          `\t\twriteJSON(w, ${Number.isFinite(status) ? status : 404}, map[string]interface{}{"detail": ${JSON.stringify(message)}})`,
        );
        lines.push('\t\treturn');
        lines.push('\t}');
      }
    } else if (child.type === 'respond') {
      const status = Number.parseInt(String(p.status || p.code || '200'), 10);
      const jsonExpr = extractExprCode(p.json);
      if (jsonExpr) {
        lines.push(`\twriteJSON(w, ${Number.isFinite(status) ? status : 200}, ${lowerGoExpr(jsonExpr, locals)})`);
      } else {
        lines.push(`\tw.WriteHeader(${Number.isFinite(status) ? status : 204})`);
      }
      lines.push('\treturn');
    }
  }
  lines.push(
    '\twriteJSON(w, http.StatusNotImplemented, map[string]interface{}{"detail": "Route handler not implemented"})',
  );
  lines.push('}');
  return lines.join('\n');
}

function emitRoutes(routes: IRNode[]): string {
  const lines = [
    'package main',
    '',
    'import (',
    '\t"encoding/json"',
    '\t"net/http"',
    '',
    '\t"kernapp/kernrt"',
    ')',
    '',
  ];
  lines.push('func registerRoutes(mux *http.ServeMux) {');
  routes.forEach((route, index) => {
    const path = String(getProps(route).path || '/');
    lines.push(
      `\tmux.HandleFunc(${JSON.stringify(path)}, ${handlerName(String(getProps(route).method || 'get').toLowerCase(), path || `route_${index}`)})`,
    );
  });
  lines.push('}', '');
  lines.push('func writeJSON(w http.ResponseWriter, status int, value interface{}) {');
  lines.push('\tw.Header().Set("Content-Type", "application/json")');
  lines.push('\tw.WriteHeader(status)');
  lines.push('\t_ = json.NewEncoder(w).Encode(value)');
  lines.push('}', '');
  routes.forEach((route, index) => {
    lines.push(emitRoute(route, index), '');
  });
  return lines.join('\n');
}

function emitMain(serverNode: IRNode): string {
  const props = getProps(serverNode);
  const port = String(props.port || '3000');
  return [
    'package main',
    '',
    'import (',
    '\t"log"',
    '\t"net/http"',
    '\t"os"',
    ')',
    '',
    'func main() {',
    '\tmux := http.NewServeMux()',
    '\tregisterRoutes(mux)',
    `\taddr := ":" + envOr("PORT", ${JSON.stringify(port)})`,
    '\tlog.Printf("kern go server listening on %s", addr)',
    '\tlog.Fatal(http.ListenAndServe(addr, mux))',
    '}',
    '',
    'func envOr(name string, fallback string) string {',
    '\tif value := os.Getenv(name); value != "" {',
    '\t\treturn value',
    '\t}',
    '\treturn fallback',
    '}',
    '',
  ].join('\n');
}

function emitGoMod(): string {
  return ['module kernapp', '', 'go 1.22', ''].join('\n');
}

function emitRuntime(): string {
  return `package kernrt

import (
	"fmt"
	"net/http"
	"net/url"
	"reflect"
)

type Value = interface{}

func Get(value interface{}, key string) interface{} {
	if value == nil {
		return nil
	}
	if m, ok := value.(map[string]interface{}); ok {
		return m[key]
	}
	rv := reflect.ValueOf(value)
	if rv.Kind() == reflect.Pointer {
		if rv.IsNil() {
			return nil
		}
		rv = rv.Elem()
	}
	if rv.Kind() == reflect.Struct {
		field := rv.FieldByName(key)
		if field.IsValid() && field.CanInterface() {
			return field.Interface()
		}
		field = rv.FieldByName(toExported(key))
		if field.IsValid() && field.CanInterface() {
			return field.Interface()
		}
	}
	return nil
}

func Coalesce(values ...interface{}) interface{} {
	for _, value := range values {
		if value != nil {
			return value
		}
	}
	return nil
}

func OptionalGet(value interface{}, key string) interface{} {
	return Get(value, key)
}

func Truthy(value interface{}) bool {
	switch v := value.(type) {
	case nil:
		return false
	case bool:
		return v
	case string:
		return v != ""
	case int:
		return v != 0
	case int64:
		return v != 0
	case float64:
		return v != 0
	case float32:
		return v != 0
	default:
		rv := reflect.ValueOf(value)
		if rv.Kind() == reflect.Slice || rv.Kind() == reflect.Array || rv.Kind() == reflect.Map {
			return rv.Len() != 0
		}
		return true
	}
}

func Equals(a interface{}, b interface{}) bool {
	return reflect.DeepEqual(a, b)
}

func Number(value interface{}) float64 {
	switch v := value.(type) {
	case int:
		return float64(v)
	case int64:
		return float64(v)
	case float64:
		return v
	case float32:
		return float64(v)
	case string:
		var out float64
		_, _ = fmt.Sscanf(v, "%f", &out)
		return out
	default:
		return 0
	}
}

func Map(items []interface{}, fn func(interface{}) interface{}) []interface{} {
	out := make([]interface{}, 0, len(items))
	for _, item := range items {
		out = append(out, fn(item))
	}
	return out
}

func Filter(items []interface{}, fn func(interface{}) bool) []interface{} {
	out := make([]interface{}, 0, len(items))
	for _, item := range items {
		if fn(item) {
			out = append(out, item)
		}
	}
	return out
}

func Reduce(items []interface{}, initial interface{}, fn func(interface{}, interface{}) interface{}) interface{} {
	acc := initial
	for _, item := range items {
		acc = fn(acc, item)
	}
	return acc
}

func QueryMap(values url.Values) map[string]interface{} {
	out := map[string]interface{}{}
	for key, vals := range values {
		if len(vals) == 1 {
			out[key] = vals[0]
		} else {
			copied := make([]string, len(vals))
			copy(copied, vals)
			out[key] = copied
		}
	}
	return out
}

func HeaderMap(values http.Header) map[string]interface{} {
	out := map[string]interface{}{}
	for key, vals := range values {
		if len(vals) == 1 {
			out[key] = vals[0]
		} else {
			copied := make([]string, len(vals))
			copy(copied, vals)
			out[key] = copied
		}
	}
	return out
}

func StructMap(value interface{}) map[string]interface{} {
	out := map[string]interface{}{}
	rv := reflect.ValueOf(value)
	if rv.Kind() == reflect.Pointer {
		if rv.IsNil() {
			return out
		}
		rv = rv.Elem()
	}
	if rv.Kind() != reflect.Struct {
		return out
	}
	rt := rv.Type()
	for i := 0; i < rt.NumField(); i++ {
		field := rt.Field(i)
		if !field.IsExported() {
			continue
		}
		name := field.Name
		if tag := field.Tag.Get("json"); tag != "" {
			for j, ch := range tag {
				if ch == ',' {
					tag = tag[:j]
					break
				}
			}
			if tag != "" && tag != "-" {
				name = tag
			}
		}
		out[name] = rv.Field(i).Interface()
	}
	return out
}

func toExported(value string) string {
	if value == "" {
		return value
	}
	return string(value[0]-32) + value[1:]
}
`;
}

export function transpileGo(root: IRNode, _config?: ResolvedKernConfig): TranspileResult {
  const accounted = new Map<IRNode, AccountedEntry>();
  const serverNode = findServerNode(root);
  accountNode(accounted, root, 'consumed', 'parse root');
  if (serverNode !== root) accountNode(accounted, serverNode, 'consumed', 'server container');
  const routes = getChildren(serverNode, 'route');
  for (const route of routes) accountNode(accounted, route, 'expressed', 'go route', true);
  const interfaces = collectInterfaces(root, serverNode);
  for (const node of [...(root.children || []), ...(serverNode.children || [])]) {
    if (node.type === 'interface') accountNode(accounted, node, 'expressed', 'go boundary type', true);
  }

  const artifacts: GeneratedArtifact[] = [
    { path: 'go.mod', content: emitGoMod(), type: 'config' },
    { path: 'main.go', content: emitMain(serverNode), type: 'entry' },
    { path: 'routes.go', content: emitRoutes(routes), type: 'route' },
    { path: 'types.go', content: emitTypes(interfaces), type: 'types' },
    { path: 'kernrt/kernrt.go', content: emitRuntime(), type: 'lib' },
  ];
  const code = artifacts.map((artifact) => `// ${artifact.path}\n${artifact.content}`).join('\n');
  const irText = serializeIR(root);
  const irTokenCount = countTokens(irText);
  const tsTokenCount = countTokens(code);
  return {
    code,
    sourceMap: [],
    irTokenCount,
    tsTokenCount,
    tokenReduction: Math.round((1 - irTokenCount / Math.max(tsTokenCount, 1)) * 100),
    artifacts,
    diagnostics: buildDiagnostics(root, accounted, 'go'),
  };
}
