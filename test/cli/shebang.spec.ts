import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const scriptPath = path.join(process.cwd(), 'scripts/ensure-cli-shebang.js');
const shebang = '#!/usr/bin/env node\n';

describe('ensure CLI shebang', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tenancy-cli-shebang-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { force: true, recursive: true });
  });

  const runScript = (filePath: string): void => {
    execFileSync(process.execPath, [scriptPath, filePath], { stdio: 'pipe' });
  };

  it('adds exactly one shebang when run twice against a JavaScript file', () => {
    const target = path.join(tempDir, 'cli.js');
    fs.writeFileSync(target, "console.log('ok');\n", 'utf8');

    runScript(target);
    runScript(target);

    const text = fs.readFileSync(target, 'utf8');
    const count = (text.match(/^#!\/usr\/bin\/env node/gm) || []).length;
    expect(count).toBe(1);
    expect(text).toBe(`${shebang}console.log('ok');\n`);
  });

  it('replaces an existing different shebang with the package shebang', () => {
    const target = path.join(tempDir, 'cli.js');
    fs.writeFileSync(target, "#!/usr/bin/node\nconsole.log('ok');\n", 'utf8');

    runScript(target);

    expect(fs.readFileSync(target, 'utf8')).toBe(`${shebang}console.log('ok');\n`);
  });

  it('normalizes duplicate leading shebangs to one package shebang', () => {
    const target = path.join(tempDir, 'cli.js');
    fs.writeFileSync(target, `${shebang}#!/usr/bin/node\nconsole.log('ok');\n`, 'utf8');

    runScript(target);

    expect(fs.readFileSync(target, 'utf8')).toBe(`${shebang}console.log('ok');\n`);
  });
});
