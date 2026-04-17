import type { PlaygroundTarget } from './targets';

/** Targets that support live preview in a sandboxed iframe */
export const PREVIEWABLE_TARGETS = new Set<PlaygroundTarget>(['tailwind', 'web', 'vue']);

export function isPreviewable(target: PlaygroundTarget): boolean {
  return PREVIEWABLE_TARGETS.has(target);
}

/**
 * Build an HTML document for the preview iframe.
 * Uses CDN-loaded runtimes — no bundler needed.
 */
export function buildPreviewHtml(compiledCode: string, target: PlaygroundTarget): string {
  if (target === 'vue') return buildVuePreview(compiledCode);
  return buildReactPreview(compiledCode, target === 'tailwind');
}

function escapeInlineScript(value: string): string {
  return JSON.stringify(value).replace(/<\/script/gi, '<\\/script');
}

function buildReactPreview(code: string, withTailwind: boolean): string {
  // Extract the component name from "export function Foo" or "export const Foo = ..."
  const componentMatch = code.match(/export\s+(?:default\s+)?(?:function|const)\s+(\w+)/);
  const componentName = componentMatch?.[1] ?? 'App';

  // Strip import lines (CDN provides React/ReactDOM globally)
  const cleanCode = code
    .replace(/^['"]use client['"];?\s*\n?/m, '')
    .replace(/^import\s+.*from\s+['"]react['"];?\s*\n?/gm, '')
    .replace(/^import\s+.*from\s+['"]react-dom['"];?\s*\n?/gm, '')
    .replace(/^import\s+.*from\s+['"]react-i18next['"];?\s*\n?/gm, '')
    .replace(
      /\bconst\s*\{\s*t\s*\}\s*=\s*useTranslation\(\);?\s*\n?/g,
      'const t = (_key, fallback) => fallback || _key;\n',
    )
    .replace(/^export\s+default\s+/gm, '')
    .replace(/^export\s+/gm, '');
  const sourceCode = escapeInlineScript(cleanCode);
  const componentNameLiteral = escapeInlineScript(componentName);

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; -webkit-font-smoothing: antialiased; }
    html { background: #f0f0f0; }
    img[src$="avatar.png"], img[alt="avatar"] { background: linear-gradient(135deg, #8B5CF6, #00CEFF); border-radius: 50%; color: transparent; overflow: hidden; font-size: 0; }
    #root { min-height: 100vh; max-width: 430px; margin: 0 auto; position: relative; box-shadow: 0 0 40px rgba(0,0,0,0.3); }
    .preview-error { color: #ff6b6b; padding: 16px; font-family: monospace; font-size: 13px; white-space: pre-wrap; }
  </style>
  ${withTailwind ? '<script src="https://cdn.tailwindcss.com"></script>' : ''}
  <script src="https://cdn.jsdelivr.net/npm/@babel/standalone@7/babel.min.js"></script>
</head>
<body>
  <div id="root"></div>
  <script type="module">
    import * as React from 'https://esm.sh/react@19.2.0?dev';
    import * as ReactDOMClient from 'https://esm.sh/react-dom@19.2.0/client?dev';
    import * as ReactDOM from 'https://esm.sh/react-dom@19.2.0?dev';

    const sourceCode = ${sourceCode};
    const componentName = ${componentNameLiteral};

    function renderError(message) {
      document.getElementById('root').innerHTML =
        '<div class="preview-error">Preview error:\\n' + String(message) + '</div>';
    }

    window.onerror = function(msg, url, line) {
      renderError(msg + '\\nLine: ' + line);
    };

    try {
      const transformed = Babel.transform(sourceCode, {
        filename: 'preview.tsx',
        presets: ['react', 'typescript'],
        sourceType: 'script',
      }).code ?? '';

      const hookBindings = {
        useState: React.useState,
        useEffect: React.useEffect,
        useMemo: React.useMemo,
        useCallback: React.useCallback,
        useRef: React.useRef,
        useContext: React.useContext,
        useReducer: React.useReducer,
        useTransition: React.useTransition,
        useDeferredValue: React.useDeferredValue,
        useId: React.useId,
        useLayoutEffect: React.useLayoutEffect,
        useInsertionEffect: React.useInsertionEffect,
        useSyncExternalStore: React.useSyncExternalStore,
        useImperativeHandle: React.useImperativeHandle,
        useActionState: React.useActionState,
        useOptimistic: React.useOptimistic,
        useEffectEvent: React.useEffectEvent,
        use: React.use,
        memo: React.memo,
        forwardRef: React.forwardRef,
        startTransition: React.startTransition,
        useFormStatus: ReactDOM.useFormStatus,
      };

      const bindingNames = ['React', ...Object.keys(hookBindings)];
      const bindingValues = [React, ...Object.values(hookBindings)];
      const factory = new Function(
        ...bindingNames,
        transformed + '\\nreturn typeof ' + componentName + ' !== "undefined" ? ' + componentName + ' : null;',
      );
      const Component = factory(...bindingValues);
      if (!Component) {
        throw new Error('Preview entry "' + componentName + '" was not defined.');
      }

      const root = ReactDOMClient.createRoot(document.getElementById('root'));
      root.render(React.createElement(Component));
    } catch (err) {
      renderError(err instanceof Error ? err.message : String(err));
    }
  </script>
  <script>
    // Hot-swap via postMessage
    window.addEventListener('message', (e) => {
      if (e.data?.type === 'kern-preview-update') {
        document.location.reload();
      }
    });
  </script>
</body>
</html>`;
}

function buildVuePreview(code: string): string {
  // Extract the script content from compiled Vue SFC
  // The Vue transpiler outputs <script setup> blocks — extract the JS
  const scriptMatch = code.match(/<script[^>]*>([\s\S]*?)<\/script>/);
  const scriptContent = scriptMatch?.[1]?.trim() ?? '';

  // Extract template
  const templateMatch = code.match(/<template>([\s\S]*?)<\/template>/);
  const templateContent = templateMatch?.[1]?.trim() ?? '<div>No template</div>';

  // Extract style
  const styleMatch = code.match(/<style[^>]*>([\s\S]*?)<\/style>/);
  const styleContent = styleMatch?.[1]?.trim() ?? '';

  // Extract all top-level declarations to return them from setup()
  const declRegex = /(?:const|let|var|function)\s+(\w+)/g;
  const declarations = new Set<string>();
  let match;
  while ((match = declRegex.exec(scriptContent)) !== null) {
    declarations.add(match[1]);
  }
  const returnObject = `{ ${Array.from(declarations).join(', ')} }`;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; -webkit-font-smoothing: antialiased; }
    html { background: #f0f0f0; }
    img[src$="avatar.png"], img[alt="avatar"] { background: linear-gradient(135deg, #8B5CF6, #00CEFF); border-radius: 50%; color: transparent; overflow: hidden; font-size: 0; }
    ${styleContent}
    .preview-error { color: #ff6b6b; padding: 16px; font-family: monospace; font-size: 13px; white-space: pre-wrap; }
  </style>
  <script src="https://cdn.jsdelivr.net/npm/vue@3/dist/vue.global.prod.js"></script>
</head>
<body>
  <div id="app">${templateContent}</div>
  <script>
    try {
      const { createApp, ref, computed, onMounted, reactive, watch, watchEffect } = Vue;
      const app = createApp({
        setup() {
          ${scriptContent.replace(/^import\s+.*\n?/gm, '').replace(/defineProps[^;]*;?\n?/g, '')}
          return ${returnObject};
        }
      });
      app.mount('#app');
    } catch (err) {
      document.getElementById('app').innerHTML =
        '<div class="preview-error">Preview error:\\n' + err.message + '</div>';
    }
  </script>
</body>
</html>`;
}
