import { isIP } from 'node:net';

const trackingParams = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid', 'yclid', 'mc_cid', 'mc_eid',
]);

export function parseHttpUrl(input: string): URL {
  const candidate = input.includes('://') ? input : `https://${input}`;
  const url = new URL(candidate);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only HTTP and HTTPS targets are allowed');
  if (url.username || url.password) throw new Error('Credentials in target URLs are not allowed');
  if (!url.hostname || url.hostname.length > 253) throw new Error('Invalid hostname');
  return url;
}

export function normalizeUrl(input: string, base?: string): string {
  const url = base ? new URL(input, base) : parseHttpUrl(input);
  url.hash = '';
  url.hostname = url.hostname.toLowerCase();
  if ((url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80')) url.port = '';
  for (const key of [...url.searchParams.keys()]) {
    if (trackingParams.has(key.toLowerCase())) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  if (url.pathname !== '/') url.pathname = url.pathname.replace(/\/+$/, '');
  return url.toString();
}

export function sameSite(a: string, b: string): boolean {
  const left = parseHttpUrl(a);
  const right = parseHttpUrl(b);
  return left.hostname === right.hostname || left.hostname.endsWith(`.${right.hostname}`) || right.hostname.endsWith(`.${left.hostname}`);
}

export function isIpHostname(hostname: string): boolean {
  return isIP(hostname.replace(/^\[|\]$/g, '')) !== 0;
}

export function classifyPageTemplate(urlInput: string, title = '', bodyClasses = ''): import('./types.js').PageTemplate {
  const url = new URL(urlInput);
  const value = `${url.pathname} ${title} ${bodyClasses}`.toLocaleLowerCase('tr');
  if (url.pathname === '/' || url.pathname === '') return 'home';
  if (/checkout|odeme|payment|adres/.test(value)) return 'checkout';
  if (/sepet|cart/.test(value)) return 'cart';
  if (/uye|giris|login|account|hesab/.test(value)) return 'account';
  if (/arama|search/.test(value)) return 'search';
  if (/iade|gizlilik|kvkk|sozlesme|sözleşme|politika|teslimat|hakkimizda|hakkımızda|iletisim|iletişim|sss|sikca/.test(value)) return 'policy';
  if (/blog|haber|rehber|article/.test(value)) return 'content';
  if (/urun|ürün|product|pdp|sku/.test(value) || /-\d{4,}$/.test(url.pathname)) return 'product';
  if (/kategori|category|collection|liste|plp|elbise|tunik|takim|takım|giyim/.test(value)) return 'category';
  return 'unknown';
}
