// The native source runner stopped treating an explicit sync void export as a fatal link error,
// so a descriptor-selected void entry no longer aborts the module it lives in. The compiled
// predecessor is reconstructed by removing the added predicate and its guard.
export const POST_RUNNER_EXPORT_AMENDMENT_COMPILED_RECONSTRUCTIONS = [
  {
    path: 'runner.js',
    expectedDigest: '4ca61336834ca11a719b53add12211081392fe3dfa440098247b9faf7633ae95',
    replacements: [
      {
        current:
          "// A sync void `fn` with one KERN handler never has a callable binding, yet it is a legal\n" +
          "// descriptor-selected entry. It stays out of the export map instead of aborting its module.\n" +
          "// `main` is excluded from the binding map by name, not by its return type, so it keeps the fatal.\n" +
          "function isEntryOnlyVoidFunction(node) {\n" +
          "    if (node.props?.returns !== 'void' || node.props?.name === 'main')\n" +
          "        return false;\n" +
          "    if (isTrueProp(node.props?.async) || isTrueProp(node.props?.stream))\n" +
          "        return false;\n" +
          "    return (node.children ?? []).filter((child) => child.type === 'handler' && child.props?.lang === 'kern').length === 1;\n" +
          "}\n" +
          "",
        historical: '',
      },
      {
        current:
          "                if (isEntryOnlyVoidFunction(node))\n" +
          "                    continue;\n" +
          "",
        historical: '',
      },
    ],
  },
];
