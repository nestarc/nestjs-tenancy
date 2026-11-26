import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import ts from 'typescript';

// Resolve the declarations from the consumer's working directory, the way an
// editor resolves an import. Follow re-exports to read the symbol's own JSDoc.
const options = { module: ts.ModuleKind.Node16 };
const consumer = path.resolve('consumer.cts');
const { resolvedModule } = ts.resolveModuleName('@nestarc/tenancy', consumer, options, ts.sys);
assert.ok(resolvedModule, 'Expected TypeScript to resolve the public tenancy entry point');
const program = ts.createProgram([resolvedModule.resolvedFileName], options);
const checker = program.getTypeChecker();
const entry = program.getSourceFile(resolvedModule.resolvedFileName);
const exportsOfPackage = checker.getExportsOfModule(checker.getSymbolAtLocation(entry));

function publicDocumentation(name) {
  const exported = exportsOfPackage.find((symbol) => symbol.name === name);
  assert.ok(exported, `Missing public export ${name}`);
  const symbol = exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
  const prose = ts.displayPartsToString(symbol.getDocumentationComment(checker));
  const tags = symbol.getJsDocTags(checker).map((tag) => ts.displayPartsToString(tag.text));
  return [prose, ...tags].join(' ').replace(/\s+/g, ' ');
}

test('the published JWT extractor directs callers to authenticate before tenant extraction', () => {
  const docs = publicDocumentation('JwtClaimTenantExtractor');
  assert.doesNotMatch(docs, /authentication\s*\(e\.g\.,?[^)]*\bAuthGuard\b/i,
    'A Nest AuthGuard runs after tenant middleware and cannot be the example of prior authentication');
  assert.match(docs, /middleware/i);
  assert.match(docs, /before|prior|upstream/i);
  assert.match(docs, /signature/i);
  assert.match(docs, /membership|principal|authori[sz]ed tenant|tenant access/i,
    'Explain who authorizes the caller for the selected tenant');
});

test('the published transaction callback tells wrapper authors to preserve the binding row count', () => {
  const docs = publicDocumentation('tenancyTransactionCallback');
  assert.match(docs, /owner|existing transaction|opened by/i);
  assert.match(docs, /\$executeRaw/, 'Identify the method whose return value the callback uses');
  assert.match(docs, /row count|rows? affected|affected rows?|number of rows/i,
    'Document the row count contract for a wrapped transaction client');
});
