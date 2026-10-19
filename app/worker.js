// Cloudflare Worker in front of the web export (wrangler.jsonc runs it for the app's own routes
// only; every other path is a file in ./dist or a real 404, served by Cloudflare itself). It hands
// the app routes the shell, and since Expo SDK 57 ignores app/+html.tsx in the single-page export,
// adds the homepage's title, description and social tags as the HTML streams through.
// docs/seo-plan.md, Phase 0.
const TITLE = 'Hate Watch: rival loss alerts for NFL, NBA, MLB, NHL, soccer, F1 and UFC';
const DESCRIPTION =
  "Get a push the moment the team or athlete you can't stand loses. Rival alerts across nine leagues, for iPhone and Android.";
const SITE = 'https://hatewatch.dev/';

const APP = {
  '@context': 'https://schema.org',
  '@type': 'MobileApplication',
  name: 'Hate Watch',
  url: SITE,
  description: DESCRIPTION,
  applicationCategory: 'SportsApplication',
  operatingSystem: 'iOS, Android',
};

const attr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

const HEAD = [
  `<meta name="description" content="${attr(DESCRIPTION)}">`,
  `<link rel="canonical" href="${SITE}">`,
  '<meta property="og:type" content="website">',
  '<meta property="og:site_name" content="Hate Watch">',
  `<meta property="og:title" content="${attr(TITLE)}">`,
  `<meta property="og:description" content="${attr(DESCRIPTION)}">`,
  `<meta property="og:url" content="${SITE}">`,
  '<meta name="twitter:card" content="summary">',
  `<meta name="twitter:title" content="${attr(TITLE)}">`,
  `<meta name="twitter:description" content="${attr(DESCRIPTION)}">`,
  // Smart App Banner: iOS Safari only.
  '<meta name="apple-itunes-app" content="app-id=6819054268">',
  `<script type="application/ld+json">${JSON.stringify(APP).replace(/</g, '\\u003c')}</script>`,
].join('');

export default {
  async fetch(request, env) {
    const home = new URL(request.url).pathname === '/';
    // Only the app's routes reach here (wrangler.jsonc); they all get the shell, index.html.
    const res = await env.ASSETS.fetch(home ? request : new Request(new URL('/', request.url), request));
    // The tags are the homepage's: a /game/... address must not claim "/" as its canonical.
    if (!home || !res.headers.get('content-type')?.includes('text/html')) return res;
    return new HTMLRewriter()
      .on('title', { element: (el) => el.setInnerContent(TITLE) })
      .on('head', { element: (el) => el.append(HEAD, { html: true }) })
      .transform(res);
  },
};
