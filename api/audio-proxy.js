const { Readable } = require('node:stream');

const ALLOWED_AUDIO_HOSTS = ['saavncdn.com'];

module.exports = async function handler(req, res) {
  try {
    const target = req.query?.url;
    if (!target || typeof target !== 'string') {
      res.statusCode = 400;
      res.end('Missing stream url');
      return;
    }

    let parsed;
    try {
      parsed = new URL(target);
    } catch {
      res.statusCode = 400;
      res.end('Invalid stream url');
      return;
    }

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      res.statusCode = 400;
      res.end('Unsupported protocol');
      return;
    }

    if (!ALLOWED_AUDIO_HOSTS.some((host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`))) {
      res.statusCode = 403;
      res.end('Host not allowed');
      return;
    }

    const referer = String(req.headers.referer || 'https://www.jiosaavn.com/');
    const origin = String(req.headers.origin || 'https://www.jiosaavn.com');

    const upstream = await fetch(parsed.toString(), {
      redirect: 'follow',
      headers: {
        Accept: String(req.headers.accept || '*/*'),
        'User-Agent': 'Mozilla/5.0',
        Referer: referer,
        Origin: origin,
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
    res.setHeader('access-control-expose-headers', 'Content-Range,Accept-Ranges,Content-Length');

    if (!upstream.ok) {
      const text = await upstream.text().catch(() => '');
      res.end(text || `Upstream error: ${upstream.status}`);
      return;
    }

    if (!upstream.body) {
      res.end();
      return;
    }

    if (typeof Readable.fromWeb === 'function') {
      Readable.fromWeb(upstream.body).pipe(res);
      return;
    }

    const reader = upstream.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) res.write(Buffer.from(value));
    }
    res.end();
  } catch (err) {
    res.statusCode = 502;
    res.end('Audio proxy failed');
  }
};
