// Thin ESPN client. Uses conditional requests so an unchanged live game costs a 304
// (answered from our cached body), and a hard timeout so one slow response never stalls a poll loop.

const etags = new Map<string, { etag: string; body: unknown }>();

/**
 * `bust` appends a unique query param so ESPN's CDN (max-age=10) can't serve a stale copy.
 * Measured on a live MLB game: busted polls saw every new play 4-10s (avg 6.7s) sooner.
 */
export async function getJson<T = any>(url: string, opts: { timeoutMs?: number; conditional?: boolean; bust?: boolean } = {}): Promise<T> {
  const { timeoutMs = 8000, bust = false } = opts;
  const conditional = opts.conditional && !bust;
  if (bust) url += `${url.includes('?') ? '&' : '?'}_hw=${Date.now()}`;
  const headers: Record<string, string> = { accept: 'application/json', 'user-agent': 'HateWatch/1.0' };
  const cached = conditional ? etags.get(url) : undefined;
  if (cached) headers['if-none-match'] = cached.etag;

  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
      if (res.status === 304 && cached) return cached.body as T;
      if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
      const body = (await res.json()) as T;
      const etag = res.headers.get('etag');
      if (conditional && etag) etags.set(url, { etag, body });
      return body;
    } catch (err) {
      lastErr = err;
      if (String(err).includes('HTTP 404')) break;
      await new Promise((r) => setTimeout(r, 250 * 2 ** attempt));
    }
  }
  throw lastErr;
}

/** Reads only the PNG header (via HTTP Range) to confirm the image exists and get its true size. */
export async function probePng(url: string): Promise<{ width: number; height: number } | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { range: 'bytes=0-31' }, signal: AbortSignal.timeout(8000) });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (!res.headers.get('content-type')?.startsWith('image/')) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      // PNG signature + IHDR chunk: width/height are big-endian u32 at bytes 16 and 20.
      if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null;
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    } catch {
      await new Promise((r) => setTimeout(r, 300 * 2 ** attempt));
    }
  }
  return null;
}

/** Run async work over items with bounded concurrency. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

export function athleteIdFromRef(ref: string | undefined): string | undefined {
  return ref?.match(/athletes\/(\d+)/)?.[1];
}

export function teamIdFromRef(ref: string | undefined): string | undefined {
  return ref?.match(/teams\/(\d+)/)?.[1];
}
