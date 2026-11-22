const UPSTREAM = 'https://discord.com/api/v10';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const ALLOWED = [
  /^users\/@me$/,
  /^channels\/\d+(\/messages)?$/,
  /^gateway$/,
  /^applications\/@me$/,
];

const PASS = [
  'content-type',
  'x-ratelimit-limit',
  'x-ratelimit-remaining',
  'x-ratelimit-reset',
  'x-ratelimit-reset-after',
  'x-ratelimit-bucket',
  'x-ratelimit-scope',
  'x-ratelimit-global',
  'retry-after',
];

function cors(h) {
  h.set('access-control-allow-origin', '*');
  h.set('access-control-allow-methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  h.set('access-control-allow-headers', 'authorization,content-type');
  h.set('access-control-expose-headers', PASS.join(','));
  return h;
}

export async function onRequest({ request }) {
  const url = new URL(request.url);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors(new Headers()) });
  }

  let path = url.pathname.replace(/^\/api\/?/, '');
  if (!path) {
    return new Response(JSON.stringify({ message: 'missing path' }), {
      status: 400, headers: cors(new Headers({ 'content-type': 'application/json' })),
    });
  }
  if (!ALLOWED.some((r) => r.test(path))) {
    return new Response(JSON.stringify({ message: 'path not allowed: ' + path }), {
      status: 403, headers: cors(new Headers({ 'content-type': 'application/json' })),
    });
  }

  const h = new Headers();
  h.set('authorization', request.headers.get('authorization') || '');
  h.set('content-type', request.headers.get('content-type') || 'application/json');
  h.set('accept', 'application/json');
  h.set('user-agent', UA);
  h.set('x-webtool', '1');

  const init = { method: request.method, headers: h, redirect: 'follow' };
  if (!['GET', 'HEAD'].includes(request.method)) init.body = await request.text();

  let res;
  try {
    res = await fetch(`${UPSTREAM}/${path}${url.search}`, init);
  } catch (e) {
    return new Response(JSON.stringify({ message: 'upstream error: ' + e.message }), {
      status: 502, headers: cors(new Headers({ 'content-type': 'application/json' })),
    });
  }

  const out = new Headers();
  for (const k of PASS) {
    const v = res.headers.get(k);
    if (v !== null) out.set(k, v);
  }
  out.set('cache-control', 'no-store');
  cors(out);

  return new Response(res.body, { status: res.status, headers: out });
}