# Release Recovery

How to recover when `Version & Publish` partially fails — some `@kernlang/*` packages reach npm at the new version, others do not.

## How to detect a partial publish

The `Verify published packages on npm` step in `.github/workflows/release-pipeline.yml` will fail loudly with a message like:

```
::error::Package @kernlang/<name>@<version> is not available from the npm registry after publish
```

You can also confirm manually:

```bash
VERSION=3.2.4
for pkg in packages/*/package.json; do
  PRIVATE=$(jq -r '.private // false' "$pkg")
  [ "$PRIVATE" = "true" ] && continue
  NAME=$(jq -r '.name' "$pkg")
  STATUS=$(npm view "$NAME@$VERSION" version 2>/dev/null || echo MISSING)
  printf "%-30s %s\n" "$NAME" "$STATUS"
done
```

Anything printing `MISSING` was not published.

## Why retry is not automatic

`npm` does not allow unpublishing a version after 72 hours, and even within 72 hours it is allowed only for the entire org — so partial-publish recovery is a **forward-only** operation. The release workflow does not auto-retry because retrying `pnpm -r publish` for the whole workspace would fail on the packages that already reached the registry.

## Recovery procedure

1. Identify the missing packages using the script above.
2. From a clean checkout of the tagged commit (`git checkout v3.2.4`), bump every `package.json` `.version` to the target version locally — same `jq` sweep the workflow does, but on your machine. Do **not** commit.
3. For each missing package, publish it individually:

   ```bash
   pnpm --filter @kernlang/<name> publish --no-git-checks --access public
   ```

4. Re-run the verification script. Every package should now report the target version.
5. Push a sync commit to `dev` matching what the workflow would have done:

   ```bash
   git checkout dev
   git pull origin dev
   # apply the same jq sweep to package.json + packages/*/package.json
   git commit -am "chore: sync versions to v3.2.4 [skip ci]"
   git push origin dev
   ```

## Why this happens

The known root causes (all addressed in `release-pipeline.yml`):

- **`cancel-in-progress: true`** on the release workflow could kill `pnpm -r publish` mid-loop on tag re-push — fixed: the publish workflow uses `concurrency: { group: kernlang-release, cancel-in-progress: false }`.
- **Swallowed sync-back failure**: the `git commit … || echo` fallback hid pre-commit hook rejections — fixed: the fallback is removed and the job fails loudly.
- **Test ordering**: `pnpm test` ran against rewritten versions, hiding snapshot drift — fixed: tests run before the version sweep.
- **No post-publish verification**: a half-finished publish looked green — fixed: `Verify published packages on npm` queries the registry for every non-private package with a 60-second retry budget.

If you hit a partial publish despite all of the above, file an issue with the workflow run URL so we can extend the verification step to cover whatever new failure mode caused it.
