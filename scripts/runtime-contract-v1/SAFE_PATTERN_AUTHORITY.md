# Runtime dynamic-loader safe-pattern authority

The runtime-contract v1 graph gate normally rejects every dynamic constructor
invocation. One production class-body budget scan is admitted only when all of
these conditions hold:

- the caller path resolves to the filesystem identity of exactly one declared
  source or built authority;
- source and built authorities do not resolve to the same canonical path;
- the scan AST has the exact closed shape checked by
  `runtime-dynamic-loader-safe-patterns.mjs`;
- the file contains exactly one unshadowed
  `classBodyRequiresIterationBudget` helper; and
- that helper's complete trivia-free TypeScript token tree matches the pin for
  its source or built authority label.

Canonicalization uses `realpathSync.native()` symmetrically. This accepts a
legitimate symlinked or case-normalized checkout while continuing to reject
hardlink twins, basename twins, containment matches, missing caller paths, and
arbitrary files with identical contents. A missing source or built artifact
does not disable its independent twin. Canonical collisions fail closed.

The token-tree digest deliberately ignores whitespace, line endings, comments,
and JSDoc. It includes every remaining token kind and token text with
length-prefixed framing. Those ignored forms are non-semantic for this helper;
any helper behavior change still requires semantic review.

Run the print-and-check report from any working directory:

```sh
node scripts/runtime-contract-v1/check-runtime-dynamic-loader-safe-patterns.mjs --json
```

The report includes the digest format, TypeScript version, canonical paths,
Git blob object IDs, and expected versus actual digests. It exits nonzero on
missing inputs, parse/helper ambiguity, or drift. It has no update mode and
never edits pins. If an intentional helper change is approved, a reviewer must
inspect the semantic diff and the report, then edit the corresponding labeled
pin explicitly in source. Source and built pin changes must ship with the
reviewed helper change; a regenerated digest is evidence, never semantic
approval.

Every regular file directly under `scripts/runtime-contract-v1/` is normative
and receipt-bound. Keep generated output, scratch files, editor backups, and
subdirectories outside this closed directory; there is intentionally no
filename exclusion list. A new file requires an explicit reviewed update to
the pinned Alpha receipt policy, while any non-regular entry fails validation.
