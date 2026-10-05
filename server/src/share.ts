// Share links. The app shares /a/<code> instead of text. That page's link preview (Open Graph) is a
// picture of the alert, so in Messages, WhatsApp, Discord, X or Slack a shared alert looks like a
// screenshot. Tapping it on an iPhone with Hate Watch installed opens the app on that alert (a universal
// link: see appSiteAssociation); without the app it goes to the App Store; anywhere else the page shows
// the card and a download button. The picture is drawn here from our own alert data (nothing is uploaded).
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { db } from './db.ts';
import { targetDto } from './catalog.ts';
import { EVENT_TYPE_BY_ID } from './event-types.ts';
import { feedItem } from './fanout.ts';
import { LEAGUES, type League } from './leagues.ts';
import { sharePage } from './pages.ts';

export const APP_STORE_URL = process.env.HW_APP_STORE_URL ?? 'https://apps.apple.com/app/id6819054268';
const APP_STORE_ID = APP_STORE_URL.match(/\/id(\d+)/)?.[1];
/** Apple Team ID + bundle id: the app allowed to open this server's share links. */
const IOS_APP_ID = process.env.HW_IOS_APP_ID ?? 'G9V9266QK5.com.hatewatch.app';

/**
 * /.well-known/apple-app-site-association: tells iOS that Hate Watch opens /a/* links on this domain,
 * so a tap goes straight into the app when it's installed (the app lists the domain in
 * ios.associatedDomains). iOS fetches this through Apple's CDN when the app is installed or updated.
 */
export const appSiteAssociation = () => ({
  applinks: { details: [{ appIDs: [IOS_APP_ID], components: [{ '/': '/a/*', comment: 'Shared alerts' }] }] },
});

/** The shared alert as a feed item, for the app screen a share link opens. */
export function sharedAlert(code: string) {
  const row = db.prepare('SELECT * FROM events WHERE share_code = ?').get(code) as Parameters<typeof feedItem>[0] | undefined;
  return row ? feedItem(row) : null;
}

/** Link-preview fetchers (Messages sends "facebookexternalhit … Twitterbot") must get the page, never the redirect. */
const PREVIEW_BOT = /bot|crawl|spider|facebookexternalhit|preview|slack|discord|whatsapp|telegram|embed/i;
const IOS = /\b(iPhone|iPad|iPod)\b/;

interface EventRow { id: string; type: string; league: string; target_key: string; title: string; body: string }
const findEvent = (code: string) => db.prepare('SELECT id, type, league, target_key, title, body FROM events WHERE share_code = ?').get(code) as EventRow | undefined;

export interface Reply { status: number; headers: Record<string, string>; body: string | Buffer }

/** The page behind a share link (or the App Store, for someone tapping it on an iPhone). */
export function shareLink(code: string, ua: string, origin: string): Reply {
  if (IOS.test(ua) && !PREVIEW_BOT.test(ua)) {
    return { status: 302, headers: { location: APP_STORE_URL, 'cache-control': 'no-store', vary: 'user-agent' }, body: '' };
  }
  const e = findEvent(code);
  const html = e
    ? sharePage({ title: e.title, description: e.body, pageUrl: `${origin}/a/${code}`, imageUrl: `${origin}/a/${code}/card.png`, storeUrl: APP_STORE_URL, appId: APP_STORE_ID })
    : sharePage({ title: "This alert isn't available", description: 'Hate Watch alerts you the second the teams you hate mess up.', pageUrl: `${origin}/a/${code}`, imageUrl: null, storeUrl: APP_STORE_URL, appId: APP_STORE_ID });
  return { status: e ? 200 : 404, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300', vary: 'user-agent' }, body: html };
}

// ─── The card (1200×630, the size link previews show large) ──────────────────────────────────────
const require = createRequire(import.meta.url);
const font = (subset: string, weight: number) =>
  readFileSync(require.resolve(`@fontsource/inter/files/inter-${subset}-${weight}-normal.woff`));
// latin-ext covers names like Dončić and Jokić; both subsets share the family name so satori falls back between them.
const FONTS = [500, 800, 900].flatMap((weight) => ['latin', 'latin-ext'].map((subset) => ({ name: 'Inter', data: font(subset, weight), weight: weight as 500 | 800 | 900, style: 'normal' as const })));

/** Colour emoji as Twemoji images (satori draws text as shapes; there's no emoji font). */
const emojiCache = new Map<string, Promise<string>>();
const BLANK = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36"/>')}`;
function emoji(segment: string): Promise<string> {
  // Twemoji file names: code points in hex, without the FE0F variation selector unless it's a ZWJ sequence.
  const cps = [...segment].map((c) => c.codePointAt(0)!.toString(16));
  const name = (segment.includes('‍') ? cps : cps.filter((c) => c !== 'fe0f')).join('-');
  if (!emojiCache.has(name)) {
    emojiCache.set(name, fetch(`https://cdn.jsdelivr.net/gh/jdecked/twemoji@16.0.1/assets/svg/${name}.svg`, { signal: AbortSignal.timeout(3000) })
      .then(async (r) => (r.ok ? `data:image/svg+xml;base64,${Buffer.from(await r.text()).toString('base64')}` : BLANK))
      .catch(() => { emojiCache.delete(name); return BLANK; }));
  }
  return emojiCache.get(name)!;
}

/** Black or white text, whichever reads on this colour. */
function readableOn(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '#0B0B0D' : '#FFFFFF';
}
const initials = (name: string) => name.split(/\s+/).filter((w) => !/^(jr|sr|ii|iii|iv)\.?$/i.test(w)).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

type El = { type: string; props: { style?: Record<string, unknown>; children?: unknown } };
// satori lays everything out with flexbox and wants it declared on every div.
const h = (type: string, style: Record<string, unknown>, ...children: unknown[]): El =>
  ({ type, props: { style: { display: 'flex', ...style }, children: children.length === 1 ? children[0] : children } });

function cardTree(e: EventRow): El {
  const t = targetDto(e.target_key);
  const type = EVENT_TYPE_BY_ID.get(e.type);
  // Team colours and initials instead of ESPN logos and headshots: their images aren't ours to spread around.
  const color = (t?.kind === 'team' ? t.color : t?.kind === 'player' ? t.teamColor : null) ?? '#3F3F46';
  const badge = t?.kind === 'team' ? t.abbrev : t?.name ? initials(t.name) : '?';
  const title = clip(e.title, 110);
  const titleSize = title.length > 80 ? 46 : title.length > 52 ? 54 : 62;
  return h('div', {
    width: 1200, height: 630, display: 'flex', flexDirection: 'column', padding: '52px 64px', fontFamily: 'Inter', color: '#FAFAFA',
    backgroundColor: '#0B0B0D', backgroundImage: 'radial-gradient(circle at 50% -10%, rgba(229, 35, 43, 0.38), rgba(11, 11, 13, 0) 62%)',
  },
    h('div', { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
      h('div', { display: 'flex', alignItems: 'center', gap: 14 },
        h('div', { width: 18, height: 18, borderRadius: 9, backgroundColor: '#E5232B' }),
        h('div', { fontSize: 30, fontWeight: 900, letterSpacing: 3, color: '#FF3B44' }, 'HATE WATCH')),
      h('div', { fontSize: 24, fontWeight: 800, color: '#D4D4D8', padding: '8px 18px', borderRadius: 12, border: '2px solid #2A2A31', backgroundColor: '#16161A' }, LEAGUES[e.league as League]?.name ?? e.league.toUpperCase())),
    h('div', { flex: 1, display: 'flex', alignItems: 'center', gap: 44 },
      h('div', {
        width: 168, height: 168, borderRadius: 84, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
        backgroundColor: color, border: '6px solid rgba(255, 255, 255, 0.16)', fontSize: badge.length > 2 ? 50 : 62, fontWeight: 900, color: readableOn(color),
      }, badge),
      h('div', { flex: 1, display: 'flex', flexDirection: 'column' },
        h('div', { fontSize: titleSize, fontWeight: 800, lineHeight: 1.12 }, title),
        // A no-break space keeps each "LAD 0" together when the score line wraps.
        h('div', { fontSize: 30, fontWeight: 500, lineHeight: 1.35, color: '#A1A1AA', marginTop: 18 }, clip(e.body, 120).replace(/\b([A-Z]{2,4}) (\d+)\b/g, '$1 $2')))),
    h('div', { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24 },
      h('div', { fontSize: 24, fontWeight: 500, color: '#A1A1AA', flexShrink: 1, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }, `${type?.emoji ?? '😈'}  ${type?.label ?? ''}`),
      h('div', { fontSize: 26, fontWeight: 800, color: '#FFFFFF', backgroundColor: '#E5232B', padding: '14px 28px', borderRadius: 40, flexShrink: 0 }, 'Get Hate Watch on the App Store')));
}

const cards = new Map<string, Buffer>(); // alerts never change, so neither do their cards
export async function shareCard(code: string): Promise<Buffer | null> {
  const hit = cards.get(code);
  if (hit) return hit;
  const e = findEvent(code);
  if (!e) return null;
  const svg = await satori(cardTree(e) as any, {
    width: 1200, height: 630, fonts: FONTS,
    loadAdditionalAsset: async (lang: string, segment: string) => (lang === 'emoji' ? emoji(segment) : []),
  });
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } }).render().asPng();
  if (cards.size >= 300) cards.delete(cards.keys().next().value!);
  cards.set(code, png);
  return png;
}
