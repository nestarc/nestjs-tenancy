#!/usr/bin/env node
const fs = require('fs');

const SHEBANG = '#!/usr/bin/env node\n';
const DEFAULT_TARGET = 'dist/cli/index.js';

function ensureCliShebang(filePath = DEFAULT_TARGET) {
  const source = fs.readFileSync(filePath, 'utf8');
  const withoutExistingShebang = source.replace(/^(#![^\n]*\n)+/, '');
  fs.writeFileSync(filePath, SHEBANG + withoutExistingShebang, 'utf8');
}

if (require.main === module) {
  ensureCliShebang(process.argv[2] || DEFAULT_TARGET);
}

module.exports = { DEFAULT_TARGET, SHEBANG, ensureCliShebang };
