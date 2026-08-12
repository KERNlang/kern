export const POST_M4171_COMPILED_PARSER_STYLE_RECONSTRUCTIONS = [
  {
    path: 'parser-style.js',
    expectedDigest: '9e923eb6b9018aa7fb681c5f958c2f0efd574ca10352802c5745eae1b212429b',
    replacements: [
      {
        current:
          "            if (pseudo === 'constructor')\n" +
          '                continue;\n' +
          '            if (!Object.hasOwn(pseudoStyles, pseudo))\n' +
          '                pseudoStyles[pseudo] = {};\n',
        historical:
          '            if (!pseudoStyles[pseudo])\n' +
          '                pseudoStyles[pseudo] = {};\n',
      },
    ],
  },
];
