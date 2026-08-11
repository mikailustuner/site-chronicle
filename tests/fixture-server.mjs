import http from 'node:http';

let version = 1;
const port = Number(process.env.FIXTURE_PORT ?? 43210);

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host}`);
  if (url.pathname === '/__version' && request.method === 'POST') {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    version = Number(Buffer.concat(chunks).toString('utf8')) === 2 ? 2 : 1;
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ version }));
    return;
  }
  if (url.pathname === '/robots.txt') {
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.end(version === 1 ? 'Disallow: /private\n' : `User-agent: *\nDisallow: /private\nSitemap: http://127.0.0.1:${port}/sitemap.xml\n`);
    return;
  }
  if (url.pathname === '/sitemap.xml') {
    response.writeHead(200, { 'content-type': 'application/xml' });
    response.end(`<?xml version="1.0"?><urlset><url><loc>http://127.0.0.1:${port}/</loc></url><url><loc>http://127.0.0.1:${port}/product-1234</loc></url><url><loc>http://127.0.0.1:${port}/returns</loc></url></urlset>`);
    return;
  }
  if (url.pathname === '/hero.jpg') {
    const bytes = Buffer.alloc(version === 1 ? 800_000 : 20_000, 120);
    response.writeHead(200, { 'content-type': 'image/jpeg', 'content-length': String(bytes.length), 'cache-control': 'public,max-age=31536000' });
    response.end(bytes);
    return;
  }
  if (url.pathname === '/app.js') {
    const body = version === 1 ? `console.error('fixture runtime error');${'void 0;'.repeat(20_000)}` : 'window.fixtureReady=true;';
    response.writeHead(200, { 'content-type': 'application/javascript' });
    response.end(body);
    return;
  }
  if (url.pathname === '/returns') return html(response, version === 1
    ? '<title>Returns</title><h1>Returns</h1><p>Return shipping is paid by BUYER. Call 0505 111 22 33.</p>'
    : `<title>Return and exchange policy</title><meta name="description" content="Clear return policy"><link rel="canonical" href="http://127.0.0.1:${port}/returns"><h1>Return and exchange policy</h1><p>Contracted returns are paid by the company. Call 0505 111 22 33.</p>`);
  if (url.pathname === '/product-1234') return html(response, version === 1
    ? '<title>Dress</title><h1>Dress</h1><p>Call 0539 999 88 77</p><img src="/hero.jpg"><button></button><button style="width:18px;height:18px">S</button>'
    : `<title>Blue Dress | Fixture Store</title><meta name="description" content="Blue dress with clear fit and return information"><link rel="canonical" href="http://127.0.0.1:${port}/product-1234"><script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Blue Dress","offers":{"@type":"Offer","price":"100","priceCurrency":"TRY","availability":"https://schema.org/InStock"}}</script><h1>Blue Dress</h1><p>Call 0505 111 22 33. Free shipping and 14-day returns.</p><img src="/hero.jpg" alt="Blue dress front view"><button aria-label="Select size" style="width:44px;height:44px">S</button>`);
  if (url.pathname === '/') return html(response, version === 1
    ? '<script src="/app.js"></script><img src="/hero.jpg"><div id="popup" style="position:fixed;inset:0;z-index:9999;background:white">Limited offer<button>Close</button></div><a href="/product-1234">Product</a><a href="/returns">Returns</a>'
    : `<title>Fixture Store | Evidence Test</title><meta name="description" content="A stable test storefront"><link rel="canonical" href="http://127.0.0.1:${port}/"><script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"Fixture Store"}</script><script src="/app.js" defer></script><h1>Fixture Store</h1><img src="/hero.jpg" alt="Fixture collection"><a href="/product-1234">Product</a><a href="/returns">Returns</a>`);
  response.writeHead(404, { 'content-type': 'text/plain' });
  response.end('Not found');
});

function html(response, body) {
  const headers = { 'content-type': 'text/html; charset=utf-8' };
  if (version === 2) Object.assign(headers, {
    'strict-transport-security': 'max-age=31536000',
    'content-security-policy': "default-src 'self'; img-src 'self'; script-src 'self'",
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'permissions-policy': 'camera=(),microphone=()',
  });
  response.writeHead(200, headers);
  response.end(`<!doctype html><html lang="en"><head>${body.includes('<title>') ? '' : '<title></title>'}</head><body>${body}</body></html>`);
}

server.listen(port, '127.0.0.1', () => console.log(`Fixture server on http://127.0.0.1:${port}, version ${version}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
