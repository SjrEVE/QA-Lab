import { randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, realpath } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import { z } from 'zod';
import { runConfiguredAuthBootstrap } from './auth-bootstrap.js';
import { redactSecrets } from './redaction.js';

const LOOPBACK_HOST = '127.0.0.1';
const DEFAULT_PORT = 4317;
const MAX_BODY_BYTES = 8 * 1024;
const actionSchema = z.object({ action: z.literal('bootstrap-auth') }).strict();
export type ControlAction = z.infer<typeof actionSchema>['action'];

export interface ControlCenterOptions {
  readonly port?: number;
  readonly artifactRoot?: string;
  readonly actionHandlers?: Partial<Record<ControlAction, () => Promise<unknown>>>;
}

export interface ControlCenterServer {
  readonly url: string;
  readonly controlToken: string;
  close(): Promise<void>;
}

class RequestProblem extends Error {
  public readonly status: number;

  public constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  const body = `${JSON.stringify(redactSecrets(value), null, 2)}\n`;
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(body);
}

function controlPage(controlToken: string): string {
  return `<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>TutorProof Control Center</title>
<style>body{font:16px system-ui;max-width:760px;margin:40px auto;padding:0 20px;color:#172033}main{border:1px solid #d9dfeb;border-radius:16px;padding:24px;box-shadow:0 8px 28px #17203312}button{font:inherit;font-weight:650;padding:12px 18px;border:0;border-radius:10px;background:#2057c8;color:white;cursor:pointer}button:disabled{opacity:.6}pre{white-space:pre-wrap;background:#f5f7fb;padding:16px;border-radius:10px;min-height:72px}</style></head>
<body><main><h1>TutorProof</h1><p>Trung tâm kiểm thử staging chạy cục bộ. Không có quyền production hoặc deploy.</p>
<button id="auth" type="button">Xác minh tài khoản staging</button><pre id="result" aria-live="polite">Sẵn sàng.</pre></main>
<script>const token=${JSON.stringify(controlToken)};const button=document.getElementById('auth');const result=document.getElementById('result');button.addEventListener('click',async()=>{button.disabled=true;result.textContent='Đang mở trình duyệt xác minh...';try{const response=await fetch('/api/actions',{method:'POST',headers:{'content-type':'application/json','x-tutorproof-token':token},body:JSON.stringify({action:'bootstrap-auth'})});const data=await response.json();result.textContent=JSON.stringify(data,null,2)}catch{result.textContent='Không thể chạy action.'}finally{button.disabled=false}});</script></body></html>`;
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const declared = Number(request.headers['content-length'] ?? 0);
  if (!Number.isFinite(declared) || declared < 0 || declared > MAX_BODY_BYTES) {
    throw new RequestProblem(413, 'Request body is too large.');
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new RequestProblem(413, 'Request body is too large.');
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new RequestProblem(400, 'Request body must be valid JSON.');
  }
}

function isContained(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

async function safeArtifactFile(rootInput: string, encodedRelativePath: string): Promise<string> {
  let relativePath: string;
  try {
    relativePath = decodeURIComponent(encodedRelativePath);
  } catch {
    throw new RequestProblem(400, 'Malformed artifact path.');
  }
  if (!relativePath || relativePath.includes('\\') || path.posix.isAbsolute(relativePath) || path.win32.isAbsolute(relativePath)) {
    throw new RequestProblem(400, 'Unsafe artifact path.');
  }
  const segments = relativePath.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new RequestProblem(400, 'Unsafe artifact path.');
  }

  const root = path.resolve(rootInput);
  const target = path.resolve(root, ...segments);
  if (!isContained(root, target)) throw new RequestProblem(400, 'Artifact path escaped its root.');

  let current = root;
  for (const segment of ['', ...segments]) {
    if (segment) current = path.join(current, segment);
    let stats;
    try {
      stats = await lstat(current);
    } catch {
      throw new RequestProblem(404, 'Artifact not found.');
    }
    if (stats.isSymbolicLink()) throw new RequestProblem(400, 'Artifact links and reparse points are forbidden.');
  }
  const [realRoot, realTarget] = await Promise.all([realpath(root), realpath(target)]);
  if (!isContained(realRoot, realTarget)) throw new RequestProblem(400, 'Artifact path escaped its real root.');
  const stats = await lstat(realTarget);
  if (!stats.isFile()) throw new RequestProblem(404, 'Artifact not found.');
  return realTarget;
}

function serveArtifact(response: ServerResponse, filename: string): void {
  const extension = path.extname(filename).toLowerCase();
  const headers: Record<string, string> = {
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; sandbox",
  };
  if (extension === '.png') headers['content-type'] = 'image/png';
  else if (extension === '.json' || extension === '.jsonl') headers['content-type'] = 'application/json; charset=utf-8';
  else if (extension === '.html' || extension === '.htm') {
    headers['content-type'] = 'application/octet-stream';
    headers['content-disposition'] = `attachment; filename="${path.basename(filename).replaceAll('"', '')}"`;
  } else {
    headers['content-type'] = 'text/plain; charset=utf-8';
    headers['content-disposition'] = `attachment; filename="${path.basename(filename).replaceAll('"', '')}"`;
  }
  response.writeHead(200, headers);
  createReadStream(filename).on('error', () => response.destroy()).pipe(response);
}

export async function startControlCenter(options: ControlCenterOptions = {}): Promise<ControlCenterServer> {
  const artifactRoot = path.resolve(options.artifactRoot ?? 'runs');
  const controlToken = randomBytes(32).toString('hex');
  const nonce = randomBytes(18).toString('base64url');
  const handlers: Record<ControlAction, () => Promise<unknown>> = {
    'bootstrap-auth': options.actionHandlers?.['bootstrap-auth'] ?? (() => runConfiguredAuthBootstrap()),
  };
  let active = false;
  let expectedOrigin = '';

  const handleRequest = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    try {
      if (request.headers.host !== expectedOrigin.slice('http://'.length)) throw new RequestProblem(403, 'Invalid Host header.');
      const requestUrl = new URL(request.url ?? '/', expectedOrigin);
      if (request.method === 'GET' && requestUrl.pathname === '/') {
        const body = controlPage(controlToken).replace('<script>', `<script nonce="${nonce}">`);
        response.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'content-length': Buffer.byteLength(body),
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
          'content-security-policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`,
        });
        response.end(body);
        return;
      }
      if (request.method === 'GET' && requestUrl.pathname.startsWith('/artifacts/')) {
        const filename = await safeArtifactFile(artifactRoot, requestUrl.pathname.slice('/artifacts/'.length));
        serveArtifact(response, filename);
        return;
      }
      if (request.method === 'POST' && requestUrl.pathname === '/api/actions') {
        if (request.headers.origin !== expectedOrigin) throw new RequestProblem(403, 'Invalid Origin header.');
        if (request.headers['x-tutorproof-token'] !== controlToken) throw new RequestProblem(403, 'Missing or invalid control token.');
        if (!(request.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
          throw new RequestProblem(415, 'Content-Type must be application/json.');
        }
        const { action } = actionSchema.parse(await readJsonBody(request));
        if (active) throw new RequestProblem(409, 'Another control action is active.');
        active = true;
        try {
          sendJson(response, 200, { action, result: await handlers[action]() });
        } finally {
          active = false;
        }
        return;
      }
      throw new RequestProblem(404, 'Not found.');
    } catch (error) {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      if (error instanceof z.ZodError) sendJson(response, 400, { error: 'Unsupported control action or malformed request.' });
      else if (error instanceof RequestProblem) sendJson(response, error.status, { error: error.message });
      else sendJson(response, 500, { error: 'Control Center request failed safely.' });
    }
  };
  const server = createServer((request, response) => { void handleRequest(request, response); });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? DEFAULT_PORT, LOOPBACK_HOST, resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Control Center did not bind a TCP port.');
  expectedOrigin = `http://${LOOPBACK_HOST}:${address.port}`;
  return {
    url: expectedOrigin,
    controlToken,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}
