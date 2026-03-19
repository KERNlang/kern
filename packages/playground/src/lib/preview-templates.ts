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

function buildReactPreview(code: string, withTailwind: boolean): string {
  // Extract the component name from "export function Foo" or "export default function Foo"
  const componentMatch = code.match(/export\s+(?:default\s+)?function\s+(\w+)/);
  const componentName = componentMatch?.[1] ?? 'App';

  // Strip import lines (CDN provides React/ReactDOM globally)
  const cleanCode = code
    .replace(/^['"]use client['"];?\s*\n?/m, '')
    .replace(/^import\s+.*from\s+['"]react['"];?\s*\n?/gm, '')
    .replace(/^import\s+.*from\s+['"]react-dom['"];?\s*\n?/gm, '')
    .replace(/^import\s+.*from\s+['"]react-i18next['"];?\s*\n?/gm, '')
    .replace(/\bconst\s*\{\s*t\s*\}\s*=\s*useTranslation\(\);?\s*\n?/g, 'const t = (_key, fallback) => fallback || _key;\n')
    .replace(/^export\s+default\s+/gm, '')
    .replace(/^export\s+/gm, '');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f8f9fa; }
    #root { min-height: 100vh; }
    .preview-error { color: #ff6b6b; padding: 16px; font-family: monospace; font-size: 13px; white-space: pre-wrap; }
  </style>
  ${withTailwind ? '<script src="https://cdn.tailwindcss.com"></script>' : ''}
  <script src="https://cdn.jsdelivr.net/npm/react@19/umd/react.development.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/react-dom@19/umd/react-dom.development.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/@babel/standalone@7/babel.min.js"></script>
</head>
<body>
  <div id="root"></div>
  <script type="text/babel" data-type="module">
    try {
      ${cleanCode}

      const root = ReactDOM.createRoot(document.getElementById('root'));
      root.render(React.createElement(${componentName}));
    } catch (err) {
      document.getElementById('root').innerHTML =
        '<div class="preview-error">Preview error:\\n' + err.message + '</div>';
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

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f8f9fa; }
    ${styleContent}
    .preview-error { color: #ff6b6b; padding: 16px; font-family: monospace; font-size: 13px; white-space: pre-wrap; }
  </style>
  <script src="https://cdn.jsdelivr.net/npm/vue@3/dist/vue.global.prod.js"></script>
</head>
<body>
  <div id="app">${templateContent}</div>
  <script>
    try {
      const { createApp, ref, computed, onMounted } = Vue;
      const app = createApp({
        setup() {
          ${scriptContent.replace(/^import\s+.*\n?/gm, '').replace(/defineProps[^;]*;?\n?/g, '')}
          return {};
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
