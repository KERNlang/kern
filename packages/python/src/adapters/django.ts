/**
 * Django adapter — Phase 3b contract.
 *
 * Wraps `PurePythonHandler` values as Django views + URL conf. Same pattern
 * as the FastAPI adapter (Phase 3a), but emitting Django's idioms:
 *   - urls.py — path() entries mapping each route to a view function
 *   - views.py — view functions that build a PureRequest dict from the
 *     Django `HttpRequest`, call the pure handler, and pack the response
 *     into a `JsonResponse`.
 *
 * Acceptance: a `scripts/django-smoke.mjs` smoke test (created by Phase 3b)
 * transpiles a real route, runs `python manage.py runserver` against the
 * generated app, and asserts {value:4} → 422 {detail} / {value:6} → 200
 * {result:12}. Same shape as `go-smoke.mjs` from #4.
 */

import type { PurePythonHandler } from '../core/handlers/index.js';

export interface DjangoAdapterArtifacts {
  /** Python source for urls.py (URL conf, `path('users/', views.handle_get_users)` lines). */
  urlsPy: string;
  /** Python source for views.py (view functions wrapping each PurePythonHandler). */
  viewsPy: string;
  /** Python source for settings.py (minimal Django settings — INSTALLED_APPS, ROOT_URLCONF, DEBUG). */
  settingsPy: string;
  /** Python source for manage.py (Django CLI entry point). */
  managePy: string;
  /** Imports the adapter itself needs (`'from django.http import JsonResponse'`, etc.). */
  imports: Set<string>;
}

export function emitDjangoAdapter(_handlers: PurePythonHandler[]): DjangoAdapterArtifacts {
  throw new Error('emitDjangoAdapter: Phase 3b has not yet implemented the Django wrapper layer.');
}
