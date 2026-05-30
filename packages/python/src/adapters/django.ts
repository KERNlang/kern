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

export function emitDjangoAdapter(_handlers: PurePythonHandler[]): DjangoAdapterArtifacts {
  throw new Error('emitDjangoAdapter: Phase 3b has not yet implemented the Django wrapper layer.');
}
