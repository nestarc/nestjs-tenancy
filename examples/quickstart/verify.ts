import assert from 'node:assert/strict';
import { IncomingMessage, ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import { Duplex } from 'node:stream';
import type { INestApplication } from '@nestjs/common';
import { PathTenantExtractor, TenancyContextRequiredError, TenancyService } from '@nestarc/tenancy';
import { Client } from 'pg';
import { createApp, ProjectsService } from './app';
import { TENANT_A, TENANT_B } from './auth';
import { APP_DATABASE_URL } from './database';

interface HttpResult { status: number; body: unknown }

// Dispatch through the actual Nest/Express server without opening a TCP port.
function inject(
  app: INestApplication,
  headers: Record<string, string>,
  body?: Record<string, unknown>,
): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const socket = new Duplex({
      read() {},
      write(chunk: Buffer, _encoding, callback) {
        chunks.push(Buffer.from(chunk));
        callback();
      },
    });
    const request = new IncomingMessage(socket as Socket);
    request.method = body ? 'POST' : 'GET';
    request.url = '/projects';
    request.httpVersion = '1.1';
    request.httpVersionMajor = 1;
    request.httpVersionMinor = 1;
    request.headers = { host: 'localhost', ...headers };
    if (body) {
      const json = JSON.stringify(body);
      request.headers['content-type'] = 'application/json';
      request.headers['content-length'] = String(Buffer.byteLength(json));
      request.push(json);
    }
    request.push(null);
    // The real HTTP parser sets complete after receiving the full body. Without
    // this, IncomingMessage treats end-of-stream as an aborted request.
    request.complete = true;
    const response = new ServerResponse(request);
    response.assignSocket(socket as Socket);
    const timeout = setTimeout(() => reject(new Error('HTTP injection timed out')), 20_000);
    response.on('error', reject);
    response.on('finish', () => {
      clearTimeout(timeout);
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        const payload = raw.slice(raw.indexOf('\r\n\r\n') + 4);
        resolve({ status: response.statusCode, body: payload ? JSON.parse(payload) : null });
      } catch (error) { reject(error); }
      socket.destroy();
    });
    app.getHttpServer().emit('request', request, response);
  });
}

const alice = { authorization: 'Bearer demo-alice', 'x-tenant-id': TENANT_A };
const bob = { authorization: 'Bearer demo-bob', 'x-tenant-id': TENANT_B };

async function verify(): Promise<void> {
  const pathExtractor = new PathTenantExtractor({ pattern: '/api/tenants/:tenantId/resources', paramName: 'tenantId' });
  assert.equal(await pathExtractor.extract({ headers: {}, url: '/api/tenants/acme/resources?source=test#fragment' }), 'acme');
  console.log('[docs] path extraction handles raw request URLs');
  const app = await createApp();
  const projects = app.get(ProjectsService);
  const tenancy = app.get(TenancyService);
  try {
    await assert.rejects(() => projects.list(), TenancyContextRequiredError);
    console.log('[docs] built package rejects model queries without tenant context');

    const originalList = projects.list.bind(projects);
    let queries = 0;
    projects.list = async () => {
      queries++;
      return [{ id: 'probe', tenant_id: tenancy.getCurrentTenantOrThrow(), name: 'probe' }];
    };
    assert.equal((await inject(app, { 'x-tenant-id': TENANT_A })).status, 401);
    assert.equal((await inject(app, { ...alice, authorization: 'Bearer invalid' })).status, 401);
    assert.equal((await inject(app, { ...alice, 'x-tenant-id': TENANT_B })).status, 403);
    assert.equal((await inject(app, { authorization: alice.authorization })).status, 403);
    assert.equal(queries, 0, 'unauthorized requests must not reach the service');
    const permitted = await inject(app, alice);
    assert.equal(permitted.status, 200);
    assert.deepEqual(permitted.body, [{ id: 'probe', tenant_id: TENANT_A, name: 'probe' }]);
    assert.equal(queries, 1);
    assert.equal(tenancy.getCurrentTenant(), null, 'request context must not leak to the caller');
    assert.equal((await inject(app, alice, { name: '' })).status, 400, 'JSON body validation must run');
    projects.list = originalList;
    console.log('[docs] Nest authentication precedes extraction; missing and mismatched credentials reject');

    if (process.env.QUICKSTART_VERIFY_DATABASE !== '1') return;
    const results = await Promise.all([inject(app, alice), inject(app, bob)]);
    for (const [index, result] of results.entries()) {
      assert.equal(result.status, 200);
      const tenant = index === 0 ? TENANT_A : TENANT_B;
      const name = index === 0 ? 'Alice project' : 'Bob project';
      assert.ok(Array.isArray(result.body));
      assert.ok(result.body.some((row: { name: string }) => row.name === name));
      assert.ok(result.body.every((row: { tenant_id: string }) => row.tenant_id === tenant));
    }
    console.log('[docs] concurrent HTTP reads reached Prisma and returned only the authorized tenant');

    const created = await inject(app, alice, { name: 'Created through HTTP', tenant_id: TENANT_B });
    assert.equal(created.status, 201);
    assert.equal((created.body as { tenant_id: string }).tenant_id, TENANT_A);
    assert.equal((await inject(app, { ...alice, 'x-tenant-id': TENANT_B }, { name: 'Forbidden' })).status, 403);
    console.log('[docs] HTTP creation uses the authorized context; mismatched tenant writes reject');

    const client = new Client({ connectionString: APP_DATABASE_URL });
    await client.connect();
    try {
      const role = await client.query('SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user');
      assert.deepEqual(role.rows, [{ rolsuper: false, rolbypassrls: false }]);
      assert.equal((await client.query('SELECT * FROM projects')).rowCount, 0);
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.current_tenant', $1, true)", [TENANT_A]);
      assert.equal((await client.query('UPDATE projects SET name = $1 WHERE tenant_id = $2', ['intrusion', TENANT_B])).rowCount, 0);
      await assert.rejects(
        () => client.query('INSERT INTO projects (id, tenant_id, name) VALUES (gen_random_uuid(), $1, $2)', [TENANT_B, 'intrusion']),
        (error: unknown) => error instanceof Error && 'code' in error && error.code === '42501',
      );
      await client.query('ROLLBACK');
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.current_tenant', $1, true)", [TENANT_A]);
      await client.query('DELETE FROM projects WHERE id = $1', [(created.body as { id: string }).id]);
      await client.query('COMMIT');
    } finally { await client.end(); }
    console.log('[docs] real PostgreSQL: tenant A/B isolation, context-free reads, writes and RLS role verified');
  } finally { await app.close(); }
}

void verify().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
