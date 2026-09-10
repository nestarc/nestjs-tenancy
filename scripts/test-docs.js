#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const ts = require('typescript');
const { ROOT, compose, execute, prepare, setupDatabase } = require('./quickstart');

function markdownAnchors(markdown) {
  const anchors = new Set();
  const counts = new Map();
  for (const [, id] of markdown.matchAll(/\bid=["']([^"']+)["']/g)) anchors.add(id);
  const prose = markdown.replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm, '');
  for (const [, heading] of prose.matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
    const slug = heading.replace(/<[^>]*>/g, '').toLowerCase()
      .replace(/[^\p{L}\p{N}_\s-]/gu, '').trim().replace(/\s/g, '-');
    const count = counts.get(slug) ?? 0;
    anchors.add(count ? `${slug}-${count}` : slug);
    counts.set(slug, count + 1);
  }
  return anchors;
}

// Follow current documentation links, while retaining historical reports as
// historical artifacts rather than requiring their old references to stay live.
function verifyLocalLinks() {
  const pending = ['README.md', 'examples/quickstart/README.md'];
  const visited = new Set();
  while (pending.length) {
    const relative = pending.pop();
    if (visited.has(relative)) continue;
    visited.add(relative);
    const absolute = path.join(ROOT, relative);
    const markdown = fs.readFileSync(absolute, 'utf8');
    const links = markdown.matchAll(/\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g);
    for (const [, rawTarget] of links) {
      if (/^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(rawTarget)) continue;
      const [rawPath, rawFragment] = rawTarget.split('#');
      const target = decodeURIComponent(rawPath);
      const linked = target ? path.resolve(path.dirname(absolute), target) : absolute;
      if (!fs.existsSync(linked)) throw new Error(`${relative}: missing local link ${target}`);
      if (rawFragment && /\.md$/i.test(linked)) {
        const fragment = decodeURIComponent(rawFragment);
        if (!markdownAnchors(fs.readFileSync(linked, 'utf8')).has(fragment)) {
          throw new Error(`${relative}: missing Markdown anchor ${rawTarget}`);
        }
      }
      const linkedRelative = path.relative(ROOT, linked);
      if (/\.md$/i.test(linked) && !/(?:^|[\/\\])(?:superpowers|\d{4}-\d\d-\d\d)/.test(linkedRelative)
        && !/audit|coverage/.test(linkedRelative)) pending.push(linkedRelative);
    }
  }
  console.log(`[docs] checked local links and anchors in ${visited.size} current Markdown files`);
}

function verifyHttpSnippets() {
  const snippets = ['http.md', 'api.md'].flatMap((document) => {
    const source = fs.readFileSync(path.join(ROOT, 'docs', document), 'utf8');
    return [...source.matchAll(/```typescript\r?\n([\s\S]*?)```/g)].map((match) => {
      // Bind the documented application-owned bootstrap imports to the actual
      // runnable example, keeping every configuration/decorator body unchanged.
      return match[1]
        .replace("from './app.module'", "from './app'")
        .replace("import { authenticateRequest } from './authentication'", "import { demoAuthentication as authenticateRequest } from './auth'");
    });
  });
  if (snippets.length < 20) throw new Error('HTTP/API snippet coverage unexpectedly fell below 20 blocks');
  for (const required of ['request.cookies', 'req.user', 'as unknown as Response', 'as unknown as ServerResponse']) {
    if (!snippets.some((snippet) => snippet.includes(required))) {
      throw new Error(`Missing strict snippet validation target: ${required}`);
    }
  }
  const files = new Map(snippets.map((snippet, index) => {
    const filename = path.join(ROOT, 'examples', 'quickstart', `documentation-snippet-${index}.ts`);
    const needsImport = snippet.includes('TenancyModule.forRoot')
      && !/import\s*\{[^}]*\bTenancyModule\b[^}]*\}/s.test(snippet);
    return [filename, `${needsImport ? "import { TenancyModule } from '@nestarc/tenancy';\n" : ''}${snippet}\nexport {};\n`];
  }));
  const config = ts.readConfigFile(path.join(ROOT, 'examples', 'quickstart', 'tsconfig.json'), ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.join(ROOT, 'examples', 'quickstart'));
  const host = ts.createCompilerHost(parsed.options);
  const originalGetSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (filename, languageVersion, onError, shouldCreateNewSourceFile) => files.has(filename)
    ? ts.createSourceFile(filename, files.get(filename), languageVersion, true)
    : originalGetSourceFile(filename, languageVersion, onError, shouldCreateNewSourceFile);
  const program = ts.createProgram([...files.keys()], parsed.options, host);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  if (diagnostics.length) {
    throw new Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCurrentDirectory: () => ROOT,
      getCanonicalFileName: (filename) => filename,
      getNewLine: () => '\n',
    }));
  }
  console.log(`[docs] strict-compiled ${snippets.length} actual HTTP/API Markdown snippets`);
}

async function main() {
  if (process.argv.slice(2).some((arg) => arg !== '--e2e')) throw new Error('Usage: node scripts/test-docs.js [--e2e]');
  verifyLocalLinks();
  const e2e = process.argv.includes('--e2e');
  const env = e2e ? {
    ...process.env,
    QUICKSTART_PG_PORT: '0',
    QUICKSTART_VERIFY_DATABASE: '1',
  } : { ...process.env, QUICKSTART_VERIFY_DATABASE: '0' };
  prepare(env);
  verifyHttpSnippets();
  if (!e2e) {
    execute('verify.ts', env);
    return;
  }
  const project = `tenancy-quickstart-docs-${process.pid}-${randomBytes(4).toString('hex')}`;
  let primaryError;
  try {
    compose(['up', '-d', '--wait'], env, project);
    const binding = execFileSync('docker', [
      'compose', '-f', path.join(ROOT, 'examples', 'quickstart', 'compose.yaml'),
      '-p', project, 'port', 'postgres', '5432',
    ], { env, encoding: 'utf8' }).trim();
    const port = /^127\.0\.0\.1:(\d+)$/.exec(binding)?.[1];
    if (!port) throw new Error(`Unexpected Quick Start database binding: ${binding}`);
    env.QUICKSTART_ADMIN_DATABASE_URL = `postgresql://quickstart_admin:quickstart_admin@127.0.0.1:${port}/tenancy_quickstart`;
    env.QUICKSTART_APP_DATABASE_URL = `postgresql://quickstart_app:quickstart_app@127.0.0.1:${port}/tenancy_quickstart`;
    await setupDatabase(env);
    let doctorOutput;
    try {
      doctorOutput = execFileSync(process.execPath, [
      path.join(ROOT, 'dist', 'cli', 'index.js'), 'doctor',
      '--table=public.projects', '--role=quickstart_app', '--active', '--json',
      '--tenant-a=11111111-1111-4111-8111-111111111111',
      '--tenant-b=22222222-2222-4222-8222-222222222222',
      ], { env: { ...env, DATABASE_URL: env.QUICKSTART_APP_DATABASE_URL }, encoding: 'utf8' });
    } catch (error) {
      if (error.stdout) console.error(error.stdout.toString());
      throw error;
    }
    const doctor = JSON.parse(doctorOutput);
    if (doctor.status !== 'healthy') throw new Error(`Unexpected doctor status: ${doctor.status}`);
    console.log('[docs] built doctor --json --active passed for the example application role');
    execute('verify.ts', env);
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    try {
      compose(['down', '--volumes'], env, project);
    } catch (error) {
      if (!primaryError) throw error;
      console.error(`[docs] cleanup also failed for owned Compose project ${project}`);
    }
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = error.status || 1;
  });
}

module.exports = { verifyHttpSnippets, verifyLocalLinks };
