/**
 * Django adapter — revised contract (post nero red-team).
 *
 * Wraps `PurePythonHandler` values as Django views + URL conf. Same
 * marshalling-only pattern as the FastAPI adapter — derive/guard/respond
 * live in the pure handler; the adapter ONLY translates Django's
 * `HttpRequest` into a `PureRequest` dict and back.
 *
 * Adapter responsibilities (the ONLY things it does):
 *   1. urls.py: one `path()` per route, mapping the (KERN `:param` → Django
 *      `<type:name>`) converted path to the view function.
 *   2. views.py per route: build PureRequest dict from `request.method`,
 *      view-fn kwargs (path params), `request.GET` (query), `json.loads(
 *      request.body)` (body when content-type is JSON; else raw bytes),
 *      `dict(request.headers)`. Call `handle_<fnName>(pure_request)`.
 *      Return `JsonResponse(body, status=status, headers=extra_headers or {})`.
 *   3. settings.py: minimal — `DEBUG`, `SECRET_KEY` (env), `INSTALLED_APPS=['django.contrib.contenttypes','django.contrib.auth']`
 *      (the bare minimum Django requires), `ROOT_URLCONF`, `DATABASES={}`,
 *      `ALLOWED_HOSTS=['*']`.
 *   4. manage.py: standard Django CLI entry point.
 *
 * Acceptance (Phase 3b smoke + Wave 3 end-to-end):
 *   - Synthetic PureRequest fixture (hand-built in the smoke, NOT from
 *     Django) → pure handler returns expected (status, body).
 *   - Django smoke: transpile a real route, generate the Django project,
 *     run `python manage.py runserver --noreload <port>`, curl the route,
 *     assert response. CRITICAL: use `--noreload` so the SIGTERM hits the
 *     real server, not a parent autoreloader (the equivalent of #4's
 *     `go run .` orphan-on-SIGTERM hang).
 *
 * Django is installed globally (`django 6.0.5`) on this dev environment; CI
 * will need `pip install django` in the workflow that runs the smoke.
 */

import type { PurePythonHandler } from '../core/handlers/index.js';

export interface DjangoAdapterArtifacts {
  /** Python source for urls.py (URL conf with `path('users/', views.handle_get_users)` lines). */
  urlsPy: string;
  /** Python source for views.py (view functions wrapping each PurePythonHandler). */
  viewsPy: string;
  /** Python source for settings.py (minimal Django settings — INSTALLED_APPS, ROOT_URLCONF, DEBUG). */
  settingsPy: string;
  /** Python source for manage.py (Django CLI entry point). */
  managePy: string;
  /** Python source for the pure-handlers module the adapter views import from. Phase 3b's smoke uses a synthetic version; in production the python target writes the real one. */
  pureHandlersPy: string;
  /** Imports the ADAPTER itself needs at the top of views.py. */
  imports: Set<string>;
}

export function emitDjangoAdapter(handlers: PurePythonHandler[]): DjangoAdapterArtifacts {
  const urlPaths = handlers.map((h) => {
    const cleanPath = h.path.startsWith('/') ? h.path.slice(1) : h.path;
    const segments = cleanPath.split('/');
    const hasParams = segments.some((s) => s.startsWith(':'));
    const mappedSegments = segments.map((segment) => {
      if (segment.startsWith(':')) {
        const paramName = segment.slice(1);
        const paramType = h.pathParamTypes?.[paramName] || 'str';
        return `<${paramType}:${paramName}>`;
      }
      return segment;
    });
    const djangoPath = mappedSegments.join('/');
    if (hasParams) {
      return `    path("${djangoPath}", views.${h.fnName}_route, name="${h.fnName}"),`;
    } else {
      return `    path("${djangoPath}", views.${h.fnName}_route),`;
    }
  });

  const urlsPy = `from django.urls import path
try:
    from . import views
except ImportError:
    import views

urlpatterns = [
${urlPaths.join('\n')}
]
`;

  const pureImportsList = Array.from(new Set(handlers.map((h) => h.fnName)));
  const viewsImports = `import json
from django.http import JsonResponse, HttpRequest
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods
try:
    from .pure_handlers import ${pureImportsList.join(', ')}
except ImportError:
    from pure_handlers import ${pureImportsList.join(', ')}`;

  const viewFunctions = handlers
    .map((h) => {
      const method = h.method.toUpperCase();
      const responseHeadersJson = JSON.stringify(h.responseHeaders ?? {});
      return `@csrf_exempt
@require_http_methods(["${method}"])
def ${h.fnName}_route(request: HttpRequest, **path_kwargs):
    try:
        body = json.loads(request.body) if request.body else {}
    except json.JSONDecodeError:
        body = {}
    pure_request = {
        "method": request.method,
        "path_params": path_kwargs,
        "query": {k: (request.GET.getlist(k)[0] if len(request.GET.getlist(k)) == 1 else request.GET.getlist(k)) for k in request.GET},
        "body": body,
        "headers": {k.lower(): v for k, v in request.headers.items()},
        "user": getattr(request, "user", None),
    }
    result = ${h.fnName}(pure_request)
    status, body_out, *rest = result if isinstance(result, tuple) else (200, result)
    extra_headers = rest[0] if rest else {}
    merged_headers = {**${responseHeadersJson}, **extra_headers}
    resp = JsonResponse(body_out, status=status, safe=False)
    for k, v in merged_headers.items():
        resp[k] = v
    return resp`;
    })
    .join('\n\n');

  const viewsPy = `${viewsImports}

${viewFunctions}
`;

  const settingsPy = `import os
SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "kern-dev-secret-not-for-prod")
DEBUG = True
ALLOWED_HOSTS = ["*"]
INSTALLED_APPS = ["django.contrib.contenttypes", "django.contrib.auth"]
MIDDLEWARE = []
ROOT_URLCONF = "urls"
DATABASES = {}
USE_TZ = True
TIME_ZONE = "UTC"
`;

  const managePy = `#!/usr/bin/env python
import os, sys
if __name__ == "__main__":
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "settings")
    from django.core.management import execute_from_command_line
    execute_from_command_line(sys.argv)
`;

  const handlerImportsSet = new Set<string>();
  for (const h of handlers) {
    if (h.imports) {
      for (const imp of h.imports) {
        handlerImportsSet.add(imp);
      }
    }
  }
  const pureHandlersImportsStr = Array.from(handlerImportsSet).sort().join('\n');
  const pureHandlersCode = handlers.map((h) => `${h.signature}\n${h.bodyLines.join('\n')}`).join('\n\n');
  const pureHandlersPy = pureHandlersImportsStr ? `${pureHandlersImportsStr}\n\n${pureHandlersCode}` : pureHandlersCode;

  const imports = new Set([
    'import json',
    'from django.http import JsonResponse, HttpRequest',
    'from django.views.decorators.csrf import csrf_exempt',
    'from django.views.decorators.http import require_http_methods',
  ]);

  return {
    urlsPy,
    viewsPy,
    settingsPy,
    managePy,
    pureHandlersPy,
    imports,
  };
}
