# SEO plan for hatewatch.dev

## Index

**Summary:** hatewatch.dev is today invisible to search engines: it is the Expo web export, a client-rendered single-page app that ships an empty shell (about 509 KB gzip, 1.9 MB raw of JavaScript before anything paints), one generic title, no description, and `robots.txt` and `sitemap.xml` that return the app's `index.html` instead of real files. This plan makes the site findable in five ordered phases, each step tagged with how it goes out (push to `main`, server deploy, over-the-air update, native build), because each of those is ask-first in this repo. The cheapest path keeps `app.json` untouched: plain HTML pages in `app/public/` for everything a search engine should read, and the React Native app stays the product. Demand figures are unverified: no keyword tool or Search Console data existed when this was written.

**Sections:**
- **Where the site stands (audit)**: what a crawler sees today, and the facts the plan rests on.
- **Market and keywords**: who else answers "alert me when my rival loses", the brand collisions, and what is not known yet.
- **Rules every step follows**: rights, the loss rating, the OTA fingerprint, Google's spam policies.
- **How a step goes out**: the release routes and their tags.
- **Phase 0: foundation**: `robots.txt`, `sitemap.xml`, a head for the shell, Search Console, a canonical host.
- **Phase 1: a real landing page**: plain HTML in `app/public/`.
- **Phase 2: about ten hand-written pages**: league pages, then measure before scaling; first batch (hub, NFL, NBA, MLB) live, second batch (WNBA, NHL, college football, Premier League, F1, UFC) live, the most hated list built.
- **Phase 3: shared alerts and the store listings**: the free link equity and the store fields.
- **Phase 4: off-site**: communities, press, calendar.
- **Phase 5: measure**: what to watch and when to decide more.
- **What only the owner can do**: accounts, DNS, store fields, keyword data.
- **Decisions, not recommendations**: SDK 58, moving share links, full static rendering.
- **What was not checked**: what is still open: keyword data, the live Cloudflare deploy, the real 404.

## Where the site stands (audit)

Measured on 2026-10-19.

- `hatewatch.dev` serves the Expo web export through Cloudflare Workers static assets (`app/wrangler.jsonc`: `directory ./dist`, `not_found_handling: single-page-application`). Every path that is not a real file returns `index.html` with HTTP 200.
- So `/robots.txt` and `/sitemap.xml` return the app shell, not a robots file or a sitemap, and an unknown URL is a soft 404 (a 200 on a missing page; see Google's [JavaScript SEO basics](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics)).
- The shell has one generic title and no description, canonical, social tags or structured data. `app/public/` does not exist; it is where Expo copies static files from.
- All content is drawn by JavaScript after load. Google can render it in a second pass, but a page with no text in its first HTML and no per-route titles gives it nothing to rank for any query.
- A search for the domain returns nothing about the site.
- The only pages with real HTML, a title and social tags are the share pages and the privacy and support pages, and they live on `hate-watch-api.fly.dev` (`server/src/pages.ts`, `server/src/share.ts`), so whatever links they earn go to the wrong domain.
- `app.json` has no `web.output`, so the export is the default single-page output. `ios.associatedDomains` is `applinks:hate-watch-api.fly.dev`.
- Expo Router can prerender every route (`web.output: "static"`, [static rendering](https://docs.expo.dev/router/reference/static-rendering/)), but on SDK 57 a screen's `<Head>` tags do not reach the initial HTML; per-route `generateMetadata()` arrives in SDK 58.

## Market and keywords

- **Competitors.** OPPS (soccer rival alerts), Score Losers (American football) and Halftime Fan are single-sport. None found covers several leagues; Hate Watch covers nine. No major sports app was found offering "alert me when they lose" as a feature. That is the positioning: *a push when the team or athlete you can't stand loses, in nine leagues*.
- **What people search.** The behaviour is established fandom language (hate-watching a rival, schadenfreude). The likely queries are of the shape "app to get notified when [team] loses", "rival score alerts app", "best sports app for rivalry". These are guesses from how the competitors describe themselves, not measured volumes.
- **Brand collisions.** "Hatewatch" is the name of the Southern Poverty Law Center's blog and of hatewatch.org, so a bare brand search will not be ours soon. "Hate watch" also means watching a TV show you dislike. The site must say "sports" and "rival" in its first screen and its title.
- **App Store.** Search is the largest source of App Store downloads (published shares run roughly half to two thirds, from old and varying studies), so the store listing counts as much as the website. The listing files are in `app-store/`.
- **Unknown until measured:** real query volumes, the share of people who reach the app through search, and how fast a new domain gets indexed. Treat every number above as direction, not forecast.

## Rules every step follows

1. **Rights.** ESPN's headshots, logos and clips are switchable in `server/src/flags.ts` (`images.*`, `clips.*`) because they lean on ESPN's rights. Indexable pages use no ESPN headshots, logos, clips or bulk scores. Use a badge in the team's colour with its code (`server/src/images.ts` already draws these), words, and Hate Watch's own numbers.
2. **The loss rating is internal only** (owner decision, 2026-10-13). It never appears on a public page. Hater counts and the leaderboard order may.
3. **The OTA fingerprint.** Do not edit `eas.json`, do not add `package.json` scripts, and treat any `app.json` change as suspect: run the fingerprint check before and after, and stop if it changes, because a changed fingerprint stops over-the-air updates reaching every installed build (`CLAUDE.md`, Release flow).
4. **Google's spam policies.** Hundreds of near-identical team pages built from a template are [scaled content abuse and doorway pages](https://developers.google.com/search/docs/essentials/spam-policies). Start with a few hand-written pages and check that Google indexes them (Phase 2) before making more.
5. **A push to `main` publishes the site** (Cloudflare builds on every push). No app code that needs a new server endpoint goes to `main` before the server has it. Ask before every commit, push and deploy.

## How a step goes out

| Tag | What it is | Ask first |
|---|---|---|
| **[push]** | Commit and push to `main`; Cloudflare rebuilds hatewatch.dev | yes |
| **[server]** | `flyctl deploy --remote-only` from `server/` (privacy, support and share pages) | yes |
| **[ota]** | `npm run update` from `app/` (only if app JavaScript changed) | yes |
| **[build]** | EAS native build to both stores | yes |
| **[you]** | An account setting or DNS change only the owner can do | n/a |

Nothing in Phases 0 to 3 needs **[build]** or **[ota]**; that is deliberate.

## Phase 0: foundation

**Built, pushed and live on 2026-10-19:** steps 1 to 3 below. Search Console is verified (domain property), the sitemap shows Success and homepage indexing is requested; there is no `www` DNS record, so step 6's redirect is not needed. The notes that follow are from the local test. `app/public/robots.txt` and `sitemap.xml` land in the export; `app/src/app/+html.tsx` is **ignored** by SDK 57's default single-page export (the title stayed "Hate Watch"), so the head comes from `app/worker.js` (HTMLRewriter, run for `/` only through `run_worker_first: ["/"]` in `app/wrangler.jsonc`). Under `wrangler dev` against the export: `/` has the new title, description, canonical, Open Graph and Twitter tags, the Smart App Banner and JSON-LD; `/robots.txt` is `text/plain` and `/sitemap.xml` is `application/xml`; `/game/123` still serves the app shell. None of the new files is a fingerprint input (`expo-updates fingerprint:generate --debug`). Step 4 (a real 404) is built (below).

1. **`robots.txt` and `sitemap.xml`. [push]** Create `app/public/robots.txt` (allow all, `Sitemap: https://hatewatch.dev/sitemap.xml`) and `app/public/sitemap.xml` (the homepage, then each page as it exists). Verify before pushing: `npx expo export --platform web --output-dir <tmp>` in `app/`, confirm both files are in the output, and that a local static server serves them as text, not the app shell (`curl -I`). Cloudflare serves an exact file before the single-page fallback; confirm that after the first push with `curl -I https://hatewatch.dev/robots.txt` (`content-type: text/plain`).
2. **A real head for the shell. [push]** Give the shell a title and description that say what it is ("Hate Watch: rival loss alerts for NFL, NBA, MLB, NHL, soccer, F1, UFC and college sports"), a canonical, Open Graph and Twitter tags, a Smart App Banner (`apple-itunes-app`, App Store id 6819054268; iOS Safari only, [Apple's guide](https://developer.apple.com/documentation/webkit/promoting-apps-with-smart-app-banners)) and `SoftwareApplication` JSON-LD. `app/src/app/+html.tsx` is ignored in the default single-page output (tested), so the tags go in the Cloudflare HTMLRewriter Worker (step 3). Do not set `web.output: "static"` for this (see the decisions below).
3. **The Worker (built):** a small Worker in front of the assets that rewrites the head per path with `HTMLRewriter`, from a table in the Worker. It leaves `app.json` alone. **[push]**
4. **A real 404. [push] Built 2026-10-19, tested under `wrangler dev`, not yet pushed.** `not_found_handling` is now `404-page` and `public/404.html` is the page (with `noindex`). Only the app's own routes go through the Worker (`run_worker_first` in `app/wrangler.jsonc`: `/`, `/following`, `/scores`, `/search`, `/settings`, `/guide`, `/leaderboard`, and `/a/*`, `/alert/*`, `/alerts/*`, `/f1/*`, `/game/*`, `/stats/*`, `/target/*`, `/ufc/*`); the Worker serves them `index.html`, and adds the homepage tags to `/` only. Tested: all of those return 200 with the shell (and `/game/123` boots the app), `/about/`, `/robots.txt`, `/sitemap.xml` and the bundle are served as before, and `/nope`, `/game`, `/foo/bar` return 404. **Upkeep: a new route file in `app/src/app/` must be added to `run_worker_first`, or its address returns 404 on reload.** A trailing slash on an app route (`/scores/`) is now a 404 too.
5. **Search Console and Bing Webmaster Tools. [you]** Verify `hatewatch.dev` as a domain property by DNS (Cloudflare). Submit the sitemap. This is the only source of real query data.
6. **One canonical host. [you]** Redirect `www.hatewatch.dev` to `hatewatch.dev` (Cloudflare Redirect Rule) and force HTTPS.
7. **Analytics.** Cloudflare Web Analytics is enough (no cookies). If any analytics script is added to the site, update the privacy policy in `server/src/pages.ts` in the same step and deploy it **[server]**.

Done when: both files return as real files, the homepage has a title, description and canonical in its first HTML, an unknown URL returns 404, and Search Console shows the sitemap as read.

## Phase 1: a real landing page

The app's own screens stay as they are. The pages a search engine reads are **plain HTML files in `app/public/`**, a few KB each instead of 509 KB gzip, which is what mobile page-speed scores need.

**Built, pushed (`899c3ea`) and live on 2026-10-19: `app/public/about/index.html`; indexing requested in Search Console.** Decision (the owner's): `/` stays the web app, the landing page is a separate page at `/about`. Cloudflare redirects `/about` to `/about/` (tested under `wrangler dev`), so the canonical, the Open Graph URL and the sitemap entry all use `https://hatewatch.dev/about/`. The page is 7 KB with no images or scripts apart from the `FAQPage` JSON-LD (it matches the visible FAQ), has one `h1`, a 46-character title and a 152-character description, and its only call to action is "Open Hate Watch on the web". **No store badges yet:** on 2026-10-19 the Play Store page returned 404 and the App Store page and iTunes lookup for id 6819054268 returned nothing, so the page does not claim the apps can be downloaded (an HTML comment marks where the badges go). **Screenshots (added 2026-10-19, not yet pushed):** three real screens (`search.jpg`, `tracking.jpg`, `alert-settings.jpg`, 520 px wide, 60 to 110 KB each, lazy-loaded, with alt text) in `app/public/about/`. They are logo-free by construction, not by editing: a copy of the dev database served by a second server with `HW_FLAGS_OFF=images,clips` (team logos and headshots become colour badges, `server/src/images.ts`), then the web app and a trimmed `app-store/capture-screens.mjs`. The Scores screen is left out because it shows sportsbook odds, and the Feed screen because a fresh device's feed is empty. Redo them the same way after a GUI change. The claims on the page (alerts per league and per player, no account, no ads, Plus optional) come from `app-store/play-listing.md`. **Open problem:** the Smart App Banner that `app/worker.js` puts on `/` points at the same App Store id, so on iOS Safari it links to a page that does not exist yet; remove it, or wait for the release.

1. **Landing page (`/about/`).** One sentence of value in the first screen ("Get a push the moment the team you can't stand loses"), the nine leagues, how it works in three steps, store badges once the listings are live, a screenshot, a short FAQ. Add `FAQPage` markup only if the FAQ is visible on the page.
2. **Why it differs** (one short section, not a competitor-bashing page): nine leagues, any team or player, a Successful Hate Watch counter, a share card. Name OPPS and Score Losers only as "single-sport".
3. **Privacy and support, linked from the footer.** They exist on fly.dev already; link them. Moving them to hatewatch.dev would change the store listings, which the owner does (Phase 3).
4. **Every page** has a unique title (under about 60 characters), a description (under about 160), a canonical, one `h1`, internal links to the others, and an entry in `sitemap.xml`.
5. **Languages.** The app has English, Spanish, French, Portuguese, German and Japanese. Hold translated pages until the English pages are indexed; then add `hreflang` pairs for the languages that show demand in Search Console.

Done when: the homepage is indexed (URL Inspection), shows the right title in results, and one mobile Lighthouse run gives a largest paint under 2.5 s.

## Phase 2: about ten hand-written pages

**Status (2026-10-19): first batch live (`6b7e4f1`, `d36e5b3`); second batch live (`391a196`); the most hated list built under `wrangler dev`, not committed.** First batch: the hub `app/public/rival-alerts/index.html` ("how rival alerts work", item 2), and `app/public/leagues/{nfl,nba,mlb}/index.html` (item 1), each 480 to 500 words with the page chrome, 7 to 8 KB of HTML, one screenshot (`leagues/nfl/alerts.jpg`, `leagues/mlb/alerts.jpg`, and the NBA page reuses `about/alert-settings.jpg`, all logo-free by the Phase 1 method with the league's alerts expanded in Settings), a link to the hub and to the other league pages, and a disclaimer line. The shared stylesheet is `app/public/site.css` (the same dark theme as `/about/`, which still carries its own inline copy). The sitemap lists all four, `/about/` links to the hub and to the three league pages, and every address returned 200 (a no-slash address redirects 307 to the slash one), with no horizontal scroll at 375 px. **Second batch:** `app/public/leagues/{wnba,nhl,college-football,premier-league,f1,ufc}/index.html`, written the same way (294 to 378 words each, one logo-free screenshot `alerts.jpg`, the UFC one cropped to 520x600, a link to the hub, a disclaimer naming the league), every league page now lists all eight other leagues, the hub's "Alerts by league" lists all nine, the About page's league chips link to the pages, and the sitemap has 12 addresses; all returned 200, with no horizontal scroll at 375 px, no broken image and 14 internal links checked. **Item 3, the most hated list:** `app/public/most-hated/index.html` at `/most-hated/`, a hand-updated snapshot dated October 19, 2026 from production's `GET /leaderboard?kind=team` and `kind=player` (the top ranks only, ties shown as T-3; hater counts, never the loss rating, no images or logos; counts people, not who). It links the live board (`/leaderboard`, an app route), the hub links to it, and the sitemap has 13 addresses. The counts are small (9 at most), so the page says so. To refresh it, fetch those two endpoints, rewrite the two tables and the date in the lead, and push; it goes stale by itself, so refresh it when the gate check (item 4) is due. Checked under `wrangler dev`: 200, no horizontal scroll at 375 px. **URL scheme: `/leagues/<slug>/`.** It cannot be `/f1/` or `/ufc/` because those are app routes (`run_worker_first`), so every league page lives under `/leagues/`. The copy is checked against `docs/alerts.md` (alert names, push defaults, loss lines), says "public sports data" and not the provider's name, makes no download claim, and uses "sports" and "rival" because "Hatewatch" is also a watchdog's name and "hate watch" a TV term. The gate (item 4) starts when the pages are pushed and requested for indexing.

1. **One page per league** (nine): what the alerts cover for that league, how its season runs, the usual rivalries, a screenshot. About 300 to 500 words each, written for the league, not generated from a template.
2. **One page on how rival alerts work**, which the others link to.
3. **Hate Watch's own data, where allowed:** the most hated list from the leaderboard (hater counts, not the loss rating), no ESPN images. Publish it as plain text, updated by hand at first.
4. **Gate before scaling.** After four to six weeks, look in Search Console at how many of these pages are indexed and what they get impressions for. Only if they are indexed and earning impressions, consider team or rivalry pages, and then only those with a real rivalry and something to say. A page per team from one template is the doorway pattern in rule 4.

## Phase 3: shared alerts and the store listings

1. **A link back to hatewatch.dev on every shared alert page. [server]** `server/src/pages.ts` builds the share page; add a visible link to the homepage. This sends some of the link equity the share pages earn on fly.dev to hatewatch.dev. Small, server deploy only.
2. **Decide on purpose whether share pages are indexed. [server]** Each is one alert; `noindex` (or a canonical to the homepage) keeps thousands of thin pages from diluting the domain. Note the choice in `docs/sharing.md`.
3. **Marketing URL and website. [you]** Set the App Store Connect "Marketing URL" and the Play Console store listing website to `https://hatewatch.dev`. Both are account settings and are among the few direct backlinks available.
4. **Store listing text.** Use the same wording as the website's title and first sentence, so a search for either finds the other. The text is in `app-store/`; changing it goes through the existing upload script, and the owner is asked before anything is uploaded.
5. **Moving share links to hatewatch.dev is a native build.** The universal link and AASA are tied to `hate-watch-api.fly.dev` (`ios.associatedDomains`, `server/src/share.ts`). Moving them changes `app.json`, so it is a **[build]** and a fingerprint change. Not part of this plan unless the owner wants it for other reasons.

## Phase 4: off-site

1. **Where fans already talk.** Rival subreddits and team communities, with a useful reply and the app only where the community's rules allow. Read each self-promotion rule first; a post removed as spam does harm.
2. **Press and fan sites.** A short pitch to sports-tech and fan-culture writers, with the shareable alert cards (the visual hook) and the Successful Hate Watch counter.
3. **The public repository.** If the repository is public, its README linking to the site and the store pages is a free backlink.
4. **Seasonal calendar** (as of 2026-10-19): the NFL and college football are at their peak, the NBA and NHL seasons have just started and MLB's playoffs are under way. League pages should be live before each league's season starts, because a new page takes weeks to be indexed.

## Phase 5: measure

| Signal | Where | Target to judge the plan |
|---|---|---|
| Pages indexed / submitted | Search Console, Pages | all hand-written pages indexed within 4 weeks |
| Impressions and clicks by query | Search Console, Performance | first impressions in 4 to 6 weeks; these queries are the real keyword list |
| Branded queries ("hate watch app") | Search Console | rises as the pages are indexed |
| Store page views from the website | App Store Connect, Play Console | the Smart App Banner and a campaign link show referrals |
| Mobile largest paint | one Lighthouse run per release | under 2.5 s on the landing page |
| Backlinks | Search Console, Links | the two store links, then fan and press links |

Review monthly. If indexed pages earn no impressions after eight weeks, fix the content before adding pages.

## What only the owner can do

- Search Console and Bing Webmaster verification (DNS in Cloudflare).
- The `www` redirect and HTTPS setting in Cloudflare.
- The App Store Connect Marketing URL and the Play Console website field.
- Uploading any changed store listing.
- Keyword data: Search Console queries after four to six weeks, [Google Trends](https://trends.google.com/) for the league and rival terms, and Apple Search Ads' keyword popularity. **Demand estimates in this plan are unverified until this data exists.**
- Approving every commit, push, deploy and build.

## Decisions, not recommendations

- **Full static rendering (`web.output: "static"`).** Not recommended now. It prerenders every route in Node at build time, so any module-scope `window`, `localStorage` or fetch in the app breaks the Cloudflare build or ships hydration errors; it is an `app.json` change (fingerprint risk); and it would prerender app screens nobody searches for. Plain HTML gets the same search benefit without that. Reconsider only if the app's own routes must rank.
- **SDK 58 for `generateMetadata()`.** Not recommended for SEO. An SDK upgrade is a native build and a new runtime version, so every installed build stops receiving over-the-air updates until people update. Only if upgrading for other reasons.
- **Moving share links and the universal link to hatewatch.dev.** A native build (Phase 3, step 5). Only if wanted for other reasons.
- **Team pages at scale.** Only after Phase 2's index check.

## What was not checked

- No keyword volume data of any kind; competitor traffic is unknown.
- The live deploy of Phase 0 was checked with `curl` on 2026-10-19 (`/`, `/robots.txt`, `/sitemap.xml`, `/game/123` and an unknown path); `/about/` has only been tested locally.
- Step 4's live behaviour: tested under `wrangler dev` only; after the push, `curl -I` `/nope` (404), `/game/123` (200) and `/leaderboard` (200) on hatewatch.dev.
- Page speed is the bundle size (509 KB gzip, 1.9 MB raw, from `curl`), not a Lighthouse score; the 7 KB `/about/` page was not run through Lighthouse either (no Chrome on this Mac), only checked at phone width for layout and horizontal scroll.
- The market statements (competitors, App Store search share) come from public pages and old studies, not from Hate Watch's own data.
