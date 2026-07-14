import { createServer, type Server } from 'node:http';

export interface FixtureSite {
  readonly origin: string;
  readonly port: number;
  close(): Promise<void>;
}

export async function startFixtureSite(): Promise<FixtureSite> {
  const server = createServer((request, response) => {
    switch (request.url) {
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
