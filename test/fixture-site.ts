import { createServer, type Server } from 'node:http';

export interface FixtureSite {
  readonly origin: string;
  readonly port: number;
  close(): Promise<void>;
}

export async function startFixtureSite(): Promise<FixtureSite> {
  const server = createServer((request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://fixture.invalid').pathname;
    switch (pathname) {
      case '/':
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end('<!doctype html><meta name="viewport" content="width=device-width"><title>QA Home</title><style>body{font:16px sans-serif;margin:24px}button,a,input{font:inherit;padding:12px}</style><h1>QA Fixture Home</h1><a data-qa="primary-cta" href="/login">Đăng nhập</a>');
        return;
      case '/login':
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end('<!doctype html><meta name="viewport" content="width=device-width"><title>Login</title><form action="/app"><label>Email <input data-qa="email" name="email"></label><button data-qa="login-submit">Tiếp tục</button></form>');
        return;
      case '/app':
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end('<!doctype html><meta name="viewport" content="width=device-width"><title>App</title><nav>Trang chủ</nav><main><h1>Xin chào fixture</h1><button data-qa="app-cta">Bắt đầu</button></main>');
        return;
      case '/web-console-error':
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); response.end('<script>console.error("web blocker fixture")</script>'); return;
      case '/web-network-error':
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); response.end('<script>fetch("/connection-reset").catch(()=>{})</script>'); return;
      case '/web-overflow':
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); response.end('<div id="overflow" style="width:40px;height:20px;overflow:hidden;white-space:nowrap">This text is deliberately much too long</div>'); return;
      case '/web-overlap':
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); response.end('<main id="content">Important content</main><div id="overlay" style="position:fixed;inset:0;background:white">Blocking overlay</div>'); return;
      case '/ok':
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end('<!doctype html><title>QA Fixture OK</title><h1 id="result">fixture ok</h1>');
        return;
      case '/console-error':
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end('<!doctype html><title>Console Error</title><script>console.error("fixture console failure")</script>');
        return;
      case '/network-error':
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end('<!doctype html><title>Network Error</title><script>fetch("/connection-reset").catch(()=>{})</script>');
        return;
      case '/connection-reset':
        request.socket.destroy();
        return;
      case '/redirect-external':
        response.writeHead(302, { location: 'https://example.com/denied' });
        response.end();
        return;
      default:
        response.writeHead(404, { 'content-type': 'text/plain' });
        response.end('not found');
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Fixture server did not bind a TCP port.');
  return {
    origin: `http://127.0.0.1:${address.port}`,
    port: address.port,
    close: () => closeServer(server),
  };
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
