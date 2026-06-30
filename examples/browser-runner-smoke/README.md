# Browser Runner Smoke

This is the static browser harness for the native runner preview.

Build the core package, serve the repository root, then open the fixture:

```sh
pnpm --filter @kernlang/core build
python3 -m http.server 8080
```

Open `http://localhost:8080/examples/browser-runner-smoke/`.

The page imports `packages/core/dist/runner-browser.js`, preflights the smoke
program, executes it through `executeKernSource`, and renders JSON with
pass/fail status plus `performance.now()` timing. The HTML includes an import
map for the runner's one allowed bare dependency, `decimal.js`, so it can load
as native browser ESM when served from the repository root. Keep this server
bound to local development only; it exposes the repository over plain HTTP.

The browser timing starts before the module import, so it includes import-map
resolution and module fetch/evaluation overhead. The budget gate validates this
fixture without adding a browser automation dependency: it always runs the
static graph and Node proxy checks, then runs a zero-dependency headless
Chrome/Chromium measurement when a browser is available.

Browser measurement modes:

```sh
pnpm run check:runner-browser-budget
pnpm --filter @kernlang/core build
node ./scripts/check-runner-browser-budget.mjs --browser-budget=off
pnpm run check:runner-browser-budget:required
```

`KERN_BROWSER_BUDGET=auto` is the default. It measures when Chrome/Chromium is
found and skips cleanly otherwise. `required` fails if no browser is available.
Use `--browser-budget=auto|required|off` or `KERN_BROWSER_BUDGET` to choose a
mode. Set `KERN_CHROME_PATH`, `CHROME_PATH`, or `CHROME_BIN` to use a
non-standard browser executable.
