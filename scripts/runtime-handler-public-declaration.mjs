import { readFileSync } from 'node:fs';
import ts from 'typescript';

const constitution = JSON.parse(
  readFileSync(new URL('./runtime-contract-v1/constitution.json', import.meta.url), 'utf8'),
);
const declarationSchema = JSON.parse(
  readFileSync(new URL('./runtime-contract-v1/public-declaration-schema.json', import.meta.url), 'utf8'),
);

function fail(message) {
  throw new Error(`runtime handler public declaration: ${message}`);
}

function isExported(node) {
  return node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false;
}

function declarationName(node) {
  if (
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isFunctionDeclaration(node)
  ) {
    return node.name?.text ?? null;
  }
  return null;
}

function exportedSymbols(sourceFile) {
  const names = [];
  for (const statement of sourceFile.statements) {
    if (!isExported(statement)) continue;
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) fail('exported variable name must be an identifier');
        names.push(declaration.name.text);
      }
      continue;
    }
    const name = declarationName(statement);
    if (!name) fail(`unsupported exported declaration kind ${ts.SyntaxKind[statement.kind]}`);
    names.push(name);
  }
  return names;
}

function canonicalDeclarations(sourceFile) {
  const printer = ts.createPrinter({
    newLine: ts.NewLineKind.LineFeed,
    removeComments: true,
  });
  return sourceFile.statements.map((statement) =>
    printer.printNode(ts.EmitHint.Unspecified, statement, sourceFile).trim(),
  );
}

function namedDeclaration(sourceFile, name) {
  const matches = sourceFile.statements.filter((statement) => declarationName(statement) === name);
  if (matches.length !== 1) fail(`${name} must have exactly one declaration`);
  return matches[0];
}

function interfaceProperties(sourceFile, name) {
  const declaration = namedDeclaration(sourceFile, name);
  if (!ts.isInterfaceDeclaration(declaration)) fail(`${name} must remain an interface`);
  return declaration.members.map((member) => {
    if (!ts.isPropertySignature(member) || !member.name || !ts.isIdentifier(member.name)) {
      fail(`${name} must contain identifier property signatures only`);
    }
    return member.name.text;
  });
}

function stringLiteralUnion(sourceFile, name) {
  const declaration = namedDeclaration(sourceFile, name);
  if (!ts.isTypeAliasDeclaration(declaration)) fail(`${name} must remain a type alias`);
  const nodes = ts.isUnionTypeNode(declaration.type) ? declaration.type.types : [declaration.type];
  return nodes.map((node) => {
    if (!ts.isLiteralTypeNode(node) || !ts.isStringLiteral(node.literal)) {
      fail(`${name} must remain a closed string-literal union`);
    }
    return node.literal.text;
  });
}

function eventOperations(sourceFile) {
  const declaration = namedDeclaration(sourceFile, 'KernRuntimeHandlerEvent');
  if (!ts.isTypeAliasDeclaration(declaration) || !ts.isUnionTypeNode(declaration.type)) {
    fail('KernRuntimeHandlerEvent must remain a union type alias');
  }
  return declaration.type.types.map((variant) => {
    if (!ts.isTypeLiteralNode(variant)) fail('KernRuntimeHandlerEvent variants must remain type literals');
    const operation = variant.members.find(
      (member) => ts.isPropertySignature(member) && ts.isIdentifier(member.name) && member.name.text === 'op',
    );
    if (
      !operation ||
      !ts.isPropertySignature(operation) ||
      !operation.type ||
      !ts.isLiteralTypeNode(operation.type) ||
      !ts.isStringLiteral(operation.type.literal)
    ) {
      fail('every KernRuntimeHandlerEvent variant must have one literal op');
    }
    return operation.type.literal.text;
  });
}

function rejectUnsafeTypeChannels(sourceFile, names) {
  for (const name of names) {
    const declaration = namedDeclaration(sourceFile, name);
    function visit(node) {
      if (node.kind === ts.SyntaxKind.AnyKeyword || node.kind === ts.SyntaxKind.UnknownKeyword) {
        fail(`${name} exposes ${ts.SyntaxKind[node.kind]}`);
      }
      ts.forEachChild(node, visit);
    }
    visit(declaration);
  }
}

export function assertPublicRuntimeHandlerDeclaration(declarationText) {
  if (typeof declarationText !== 'string' || declarationText.length === 0) fail('input must be non-empty text');
  const sourceFile = ts.createSourceFile(
    'runtime-handler.d.ts',
    declarationText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  if ((sourceFile.parseDiagnostics ?? []).length > 0) fail('declaration text must parse');
  if (sourceFile.statements.some((statement) => ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement))) {
    fail('declaration surface must remain self-contained');
  }
  for (const symbol of constitution.forbiddenPublicTypes) {
    if (new RegExp(`\\b${symbol}\\b`, 'u').test(declarationText)) fail(`forbidden public type ${symbol}`);
  }
  const actualSymbols = exportedSymbols(sourceFile);
  if (JSON.stringify(actualSymbols) !== JSON.stringify(constitution.publicSymbols)) {
    fail('exported symbol inventory drifted');
  }
  if (JSON.stringify(interfaceProperties(sourceFile, 'KernRuntimeHandlerLimits')) !== JSON.stringify(constitution.limits)) {
    fail('limit property inventory drifted');
  }
  if (
    JSON.stringify(stringLiteralUnion(sourceFile, 'KernRuntimeHandlerDiagnosticCode')) !==
    JSON.stringify(constitution.diagnostics.codes)
  ) {
    fail('diagnostic code inventory drifted');
  }
  if (JSON.stringify(eventOperations(sourceFile)) !== JSON.stringify(constitution.eventOperations)) {
    fail('event operation inventory drifted');
  }
  rejectUnsafeTypeChannels(sourceFile, [
    'KernRuntimeHandlerCapabilityValue',
    'KernRuntimeHandlerEvent',
    'KernRuntimeHandlerDiagnostic',
    'KernRuntimeHandlerEnvelope',
    'KernRuntimeHandlerValue',
  ]);
  if (
    declarationSchema.format !== 'kern.runtime.handler.declaration-schema.v1' ||
    JSON.stringify(canonicalDeclarations(sourceFile)) !== JSON.stringify(declarationSchema.declarations)
  ) {
    fail('complete declaration schema drifted');
  }
  return Object.freeze({ eventOperations: [...constitution.eventOperations], symbols: actualSymbols });
}
