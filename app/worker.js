// Cloudflare Worker in front of the web export (wrangler.jsonc runs it only for the paths below; every
// other path is a file in ./dist or a real 404, served by Cloudflare itself).
//   /                 the marketing page, public/about/index.html, served in place (no redirect)
//   /about, /about/   301 to /
//   /app, /app/...    the web version of the app. The export is built with baseUrl /app (app.config.js), so its
//                     files are requested as /app/_expo/..., but sit at the root of ./dist: the prefix is
//                     stripped here. Any other /app/... path gets the shell, so Expo Router's client routes
//                     (/app/game/...) work on reload. /app itself gets the title, description and social tags,
//                     since Expo SDK 57 ignores app/+html.tsx in the single-page export.
//   old app addresses (/game/..., /a/..., /scores ...) 301 to /app + the same path, so shared links and
//                     bookmarks from when the app lived at the root keep working.
// docs/seo-plan.md, Phase 0.
const TITLE = 'Hate Watch web app: rival loss alerts and live scores';
const DESCRIPTION =
  "The web version of Hate Watch: live scores, the Feed and the teams and athletes you can't stand. Push alerts need the iPhone or Android app.";
const SITE = 'https://hatewatch.dev/app';

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
].join('');

// The routes the app had at the root (src/app/), now under /app.
const OLD_APP_ROUTE = /^\/(following|scores|search|settings|guide|leaderboard|a|alert|alerts|f1|game|stats|target|ufc)(\/|$)/;

const redirect = (url, path) => Response.redirect(url.origin + path + url.search, 301);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;

    if (pathname === '/') return env.ASSETS.fetch(new Request(url.origin + '/about/', request));
    if (pathname === '/about' || pathname === '/about/') return redirect(url, '/');
    if (OLD_APP_ROUTE.test(pathname)) return redirect(url, '/app' + pathname);

    // /app, /app/ or /app/...
    const rest = pathname.slice('/app'.length) || '/';
    // A last segment with a dot is a file of the export (/_expo/..., /assets/..., favicon.ico); the rest is a route.
    const isFile = /\.[A-Za-z0-9]+$/.test(rest);
    const res = await env.ASSETS.fetch(new Request(url.origin + (isFile ? rest : '/'), request));
    // The tags are the app's front door; a /app/game/... address must not claim /app as its canonical.
    if ((pathname !== '/app' && pathname !== '/app/') || !res.headers.get('content-type')?.includes('text/html')) return res;
    return new HTMLRewriter()
      .on('title', { element: (el) => el.setInnerContent(TITLE) })
      .on('head', { element: (el) => el.append(HEAD, { html: true }) })
      .transform(res);
  },
};
