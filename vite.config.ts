import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';

const ALLOWED_AUDIO_HOSTS = ['saavncdn.com'];

async function handleAudioProxy(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const rawUrl = req.url || '';
  if (!rawUrl.startsWith('/audio-proxy')) {
    return false;
  }

  const reqUrl = new URL(rawUrl, 'http://localhost');
  const target = reqUrl.searchParams.get('url');

  if (!target) {
    res.statusCode = 400;
    res.end('Missing stream url');
    return true;
  }

  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    res.statusCode = 400;
    res.end('Invalid stream url');
    return true;
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    res.statusCode = 400;
    res.end('Unsupported protocol');
    return true;
  }

  if (!ALLOWED_AUDIO_HOSTS.some((host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`))) {
    res.statusCode = 403;
    res.end('Host not allowed');
    return true;
  }

  try {
    const upstream = await fetch(parsed.toString(), {
      redirect: 'follow',
      headers: {
        Accept: String(req.headers.accept || '*/*'),
        ...(req.headers.range ? { Range: String(req.headers.range) } : {}),
      },
    });

    res.statusCode = upstream.status;
    const passHeaders = ['content-type', 'content-length', 'accept-ranges', 'content-range', 'cache-control', 'etag', 'last-modified'];
    for (const key of passHeaders) {
      const value = upstream.headers.get(key);
      if (value) {
        res.setHeader(key, value);
      }
    }
    res.setHeader('access-control-allow-origin', '*');

    if (!upstream.body) {
      res.end();
      return true;
    }

    Readable.fromWeb(upstream.body as unknown as ReadableStream).pipe(res);
    return true;
  } catch {
    res.statusCode = 502;
    res.end('Audio proxy failed');
    return true;
  }
}

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'audio-proxy',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          void handleAudioProxy(req, res).then((handled) => {
            if (!handled) {
              next();
            }
          });
        });
      },
      configurePreviewServer(server) {
        server.middlewares.use((req, res, next) => {
          void handleAudioProxy(req, res).then((handled) => {
            if (!handled) {
              next();
            }
          });
        });
      },
    },
  ],
});
