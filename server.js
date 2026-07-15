import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, isAbsolute, join, normalize, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)));
const PORT = Number.parseInt(process.env.PORT ?? '3000', 10);
const HOST = '0.0.0.0';

const MIME_TYPES = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.csv', 'text/csv; charset=utf-8'],
  ['.gif', 'image/gif'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.webmanifest', 'application/manifest+json'],
  ['.webp', 'image/webp']
]);

function applySecurityHeaders(response) {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.setHeader(
    'Permissions-Policy',
    'camera=(), geolocation=(), microphone=(), payment=(), usb=()'
  );
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  response.end(JSON.stringify(payload));
}

function resolveRequestedFile(pathname) {
  let decodedPath;

  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  const normalizedPath = normalize(decodedPath).replace(/^([/\\])+/, '');
  const candidatePath = resolve(APP_ROOT, normalizedPath || 'index.html');

  const relativePath = relative(APP_ROOT, candidatePath);

  if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
    return null;
  }

  if (existsSync(candidatePath) && statSync(candidatePath).isFile()) {
    return candidatePath;
  }

  // This app currently uses a single HTML entry point. Returning index.html for
  // extensionless paths keeps future client-side routes compatible with Railway.
  if (!extname(normalizedPath)) {
    return join(APP_ROOT, 'index.html');
  }

  return null;
}

const server = createServer((request, response) => {
  applySecurityHeaders(response);

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.setHeader('Allow', 'GET, HEAD');
    sendJson(response, 405, { error: 'Method not allowed' });
    return;
  }

  const requestUrl = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);

  if (requestUrl.pathname === '/health') {
    sendJson(response, 200, { status: 'ok' });
    return;
  }

  const filePath = resolveRequestedFile(requestUrl.pathname);

  if (!filePath) {
    sendJson(response, 404, { error: 'Not found' });
    return;
  }

  const extension = extname(filePath).toLowerCase();
  const contentType = MIME_TYPES.get(extension) ?? 'application/octet-stream';
  const isHtml = extension === '.html';

  response.writeHead(200, {
    'Content-Type': contentType,
    'Cache-Control': isHtml ? 'no-cache' : 'public, max-age=3600'
  });

  if (request.method === 'HEAD') {
    response.end();
    return;
  }

  const stream = createReadStream(filePath);
  stream.on('error', () => {
    if (!response.headersSent) {
      sendJson(response, 500, { error: 'Unable to read file' });
    } else {
      response.destroy();
    }
  });
  stream.pipe(response);
});

server.listen(PORT, HOST, () => {
  console.log(`HomeLedger is running on http://${HOST}:${PORT}`);
});

function shutdown(signal) {
  console.log(`${signal} received. Closing HomeLedger server...`);
  server.close((error) => {
    if (error) {
      console.error('Server shutdown failed:', error);
      process.exit(1);
    }

    process.exit(0);
  });

  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
