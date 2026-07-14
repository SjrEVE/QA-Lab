import assert from 'node:assert/strict';
import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises';
import { request, type IncomingHttpHeaders } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { startControlCenter } from '../src/control-center.js';

interface RawResponse {
  readonly status: number;
  readonly headers: IncomingHttpHeaders;
  readonly body: string;
}

function rawRequest(
  origin: string,
  requestPath: string,
  options: { readonly method?: string; readonly headers?: Record<string, string>; readonly body?: string } = {},
): Promise<RawResponse> {
  const url = new URL(origin);
  return new Promise((resolve, reject) => {
    const req = request({
      host: url.hostname,
      port: Number(url.port),
      path: requestPath,
      method: options.method ?? 'GET',
      headers: options.headers,
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode ?? 0,
        headers: response.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    req.once('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

test('binds loopback and requires exact Host, Origin, token, and action allowlist', async () => {
  let calls = 0;
  const server = await startControlCenter({
    port: 0,
    actionHandlers: { 'bootstrap-auth': () => { calls += 1; return Promise.resolve({ status: 'BLOCKED' }); } },
  });
  const host = new URL(server.url).host;
  try {
    assert.match(server.url, /^http:\/\/127\.0\.0\.1:/);
    const page = await rawRequest(server.url, '/');
    assert.equal(page.status, 200);
    assert.match(String(page.headers['content-security-policy'] ?? ''), /frame-ancestors 'none'/);

    const body = JSON.stringify({ action: 'bootstrap-auth' });
    const baseHeaders = { host, origin: server.url, 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)) };
    assert.equal((await rawRequest(server.url, '/api/actions', { method: 'POST', headers: baseHeaders, body })).status, 403);
    assert.equal((await rawRequest(server.url, '/api/actions', {
      method: 'POST', headers: { ...baseHeaders, origin: 'https://evil.example.test', 'x-tutorproof-token': server.controlToken }, body,
    })).status, 403);
    assert.equal((await rawRequest(server.url, '/api/actions', {
      method: 'POST', headers: { ...baseHeaders, host: 'evil.example.test', 'x-tutorproof-token': server.controlToken }, body,
    })).status, 403);

    const unknown = JSON.stringify({ action: 'shell', command: 'whoami' });
    assert.equal((await rawRequest(server.url, '/api/actions', {
      method: 'POST',
      headers: { ...baseHeaders, 'content-length': String(Buffer.byteLength(unknown)), 'x-tutorproof-token': server.controlToken },
      body: unknown,
    })).status, 400);

    const accepted = await rawRequest(server.url, '/api/actions', {
      method: 'POST', headers: { ...baseHeaders, 'x-tutorproof-token': server.controlToken }, body,
    });
    assert.equal(accepted.status, 200);
    assert.equal(calls, 1);
  } finally {
    await server.close();
  }
});

test('rejects request bodies above the fixed limit', async () => {
  const server = await startControlCenter({ port: 0, actionHandlers: { 'bootstrap-auth': () => Promise.resolve({}) } });
  try {
    const body = JSON.stringify({ action: 'bootstrap-auth', padding: 'x'.repeat(9 * 1024) });
    const response = await rawRequest(server.url, '/api/actions', {
      method: 'POST',
      headers: {
        host: new URL(server.url).host,
        origin: server.url,
        'content-type': 'application/json',
        'content-length': String(Buffer.byteLength(body)),
        'x-tutorproof-token': server.controlToken,
      },
      body,
    });
    assert.equal(response.status, 413);
  } finally {
    await server.close();
  }
});

test('blocks traversal and symlink artifact paths', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'qa-control-artifacts-'));
  const outside = await mkdtemp(path.join(tmpdir(), 'qa-control-outside-'));
  await writeFile(path.join(outside, 'secret.json'), '{"outside":true}');
  const server = await startControlCenter({ port: 0, artifactRoot: root });
  try {
    assert.notEqual((await rawRequest(server.url, '/artifacts/%2e%2e%2fsecret.json')).status, 200);
    try {
      await symlink(outside, path.join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
      t.diagnostic(`Symlink case skipped: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    const linked = await rawRequest(server.url, '/artifacts/linked/secret.json');
    assert.equal(linked.status, 400);
    assert.doesNotMatch(linked.body, /outside/);
  } finally {
    await server.close();
  }
});

test('serves JSON and screenshots safely but forces malicious HTML to download', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'qa-control-artifacts-'));
  await mkdir(path.join(root, 'run-1'));
  await writeFile(path.join(root, 'run-1', 'summary.json'), '{"status":"FAILED"}');
  await writeFile(path.join(root, 'run-1', 'shot.png'), Buffer.from([137, 80, 78, 71]));
  await writeFile(path.join(root, 'run-1', 'report.html'), '<script>fetch("/api/actions",{method:"POST"})</script>');
  const server = await startControlCenter({ port: 0, artifactRoot: root });
  try {
    const json = await rawRequest(server.url, '/artifacts/run-1/summary.json');
    assert.equal(json.status, 200);
    assert.match(json.headers['content-type'] ?? '', /^application\/json/);
    const screenshot = await rawRequest(server.url, '/artifacts/run-1/shot.png');
    assert.equal(screenshot.headers['content-type'], 'image/png');
    const html = await rawRequest(server.url, '/artifacts/run-1/report.html');
    assert.equal(html.status, 200);
    assert.equal(html.headers['content-type'], 'application/octet-stream');
    assert.match(String(html.headers['content-disposition'] ?? ''), /^attachment;/);
    assert.match(String(html.headers['content-security-policy'] ?? ''), /sandbox/);
  } finally {
    await server.close();
  }
});
