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
- **Phase 2: about ten hand-written pages**: league pages, then measure before scaling.
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

**Built and tested locally on 2026-10-19, not yet committed:** steps 1 to 3 below. `app/public/robots.txt` and `sitemap.xml` land in the export; `app/src/app/+html.tsx` is **ignored** by SDK 57's default single-page export (the title stayed "Hate Watch"), so the head comes from `app/worker.js` (HTMLRewriter, run for `/` only through `run_worker_first: ["/"]` in `app/wrangler.jsonc`). Under `wrangler dev` against the export: `/` has the new title, description, canonical, Open Graph and Twitter tags, the Smart App Banner and JSON-LD; `/robots.txt` is `text/plain` and `/sitemap.xml` is `application/xml`; `/game/123` still serves the app shell. None of the new files is a fingerprint input (`expo-updates fingerprint:generate --debug`). Not yet done: step 4 (a real 404), and the check on the live Cloudflare deploy.

1. **`robots.txt` and `sitemap.xml`. [push]** Create `app/public/robots.txt` (allow all, `Sitemap: https://hatewatch.dev/sitemap.xml`) and `app/public/sitemap.xml` (the homepage, then each page as it exists). Verify before pushing: `npx expo export --platform web --output-dir <tmp>` in `app/`, confirm both files are in the output, and that a local static server serves them as text, not the app shell (`curl -I`). Cloudflare serves an exact file before the single-page fallback; confirm that after the first push with `curl -I https://hatewatch.dev/robots.txt` (`content-type: text/plain`).
2. **A real head for the shell. [push]** Give the shell a title and description that say what it is ("Hate Watch: rival loss alerts for NFL, NBA, MLB, NHL, soccer, F1, UFC and college sports"), a canonical, Open Graph and Twitter tags, a Smart App Banner (`apple-itunes-app`, App Store id 6819054268; iOS Safari only, [Apple's guide](https://developer.apple.com/documentation/webkit/promoting-apps-with-smart-app-banners)) and `SoftwareApplication` JSON-LD. `app/src/app/+html.tsx` is ignored in the default single-page output (tested), so the tags go in the Cloudflare HTMLRewriter Worker (step 3). Do not set `web.output: "static"` for this (see the decisions below).
3. **The Worker (built):** a small Worker in front of the assets that rewrites the head per path with `HTMLRewriter`, from a table in the Worker. It leaves `app.json` alone. **[push]**
4. **A real 404. [push]** `not_found_handling` is `single-page-application` so the app's own deep links work. Keep it, but make the Worker (or a `_redirects`-style rule) return a real 404 status for paths that are neither a file nor an app route. Verify that `/game/<id>`, `/a/<code>` and `/leaderboard` still open the app.
5. **Search Console and Bing Webmaster Tools. [you]** Verify `hatewatch.dev` as a domain property by DNS (Cloudflare). Submit the sitemap. This is the only source of real query data.
6. **One canonical host. [you]** Redirect `www.hatewatch.dev` to `hatewatch.dev` (Cloudflare Redirect Rule) and force HTTPS.
7. **Analytics.** Cloudflare Web Analytics is enough (no cookies). If any analytics script is added to the site, update the privacy policy in `server/src/pages.ts` in the same step and deploy it **[server]**.

Done when: both files return as real files, the homepage has a title, description and canonical in its first HTML, an unknown URL returns 404, and Search Console shows the sitemap as read.

## Phase 1: a real landing page

The app's own screens stay as they are. The pages a search engine reads are **plain HTML files in `app/public/`**, a few KB each instead of 509 KB gzip, which is what mobile page-speed scores need.

1. **Homepage.** One sentence of value in the first screen ("Get a push the moment the team you can't stand loses"), the nine leagues, how it works in three steps, store badges, a screenshot, a short FAQ. Use the screenshots in `app-store/`, not live ESPN images. Add `FAQPage` markup only if the FAQ is visible on the page.
2. **Why it differs** (one short section, not a competitor-bashing page): nine leagues, any team or player, a Successful Hate Watch counter, a share card. Name OPPS and Score Losers only as "single-sport".
3. **Privacy and support, linked from the footer.** They exist on fly.dev already; link them. Moving them to hatewatch.dev would change the store listings, which the owner does (Phase 3).
4. **Every page** has a unique title (under about 60 characters), a description (under about 160), a canonical, one `h1`, internal links to the others, and an entry in `sitemap.xml`.
5. **Languages.** The app has English, Spanish, French, Portuguese, German and Japanese. Hold translated pages until the English pages are indexed; then add `hreflang` pairs for the languages that show demand in Search Console.

Done when: the homepage is indexed (URL Inspection), shows the right title in results, and one mobile Lighthouse run gives a largest paint under 2.5 s.

## Phase 2: about ten hand-written pages

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
- The live Cloudflare deploy: the Worker was tested with `wrangler@latest` locally; Cloudflare's `npx wrangler deploy` may resolve another version. After the first push, `curl` `/`, `/robots.txt` and `/game/<id>` on hatewatch.dev.
- Step 4, a real 404, is not built; unknown paths still return the app shell with 200.
- Page speed is the bundle size (509 KB gzip, 1.9 MB raw, from `curl`), not a Lighthouse score.
- The market statements (competitors, App Store search share) come from public pages and old studies, not from Hate Watch's own data.
