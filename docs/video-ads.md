# Video ads

<!-- README section: the README has its summary and links here; the vault puts this text back in its place -->

## Index

**Summary:** the store and social videos are React components rendered to MP4 with Remotion, in `marketing/video-ads/`: three vertical ads, a video of the startup guide, and the App Store's animated header and search result videos. The sources are in git; the renders (`out/`) are not, since each is a few megabytes and comes back from one command.

**Sections:**
- **The compositions**: the five videos and their files.
- **Rendering**: install, preview and render commands.
- **The header and search result videos**: Apple's specs, the shared roll, the word-to-alert table, and the ffmpeg encode that meets them.

## The compositions

`src/Root.tsx` registers six compositions, 1080×1920 at 30 fps except `HeaderPreview` and `SearchPreview` (`src/index.ts` is Remotion's entry):

| Id | File | What it is | Output |
|---|---|---|---|
| `FailFeed` | `src/FailFeed.tsx` | Ad 1: a rival's failures landing in the feed | `out/hate-watch-ad-1-fail-feed.mp4` |
| `FeatureTour` | `src/FeatureTour.tsx` | Ad 2: a tour of the features | `out/hate-watch-ad-2-feature-tour.mp4` |
| `Ad3` | `src/Ad3.tsx` | Ad 3: a rough week for a rival | `out/hate-watch-ad-3-rough-week.mp4` |
| `GuideVideo` | `src/GuideVideo.tsx` | The startup guide as a video | `out/hate-watch-guide-video.mp4` |
| `HeaderPreview` | `src/HeaderPreview.tsx` | The App Store header video, 3840×1646, 12 s loop | `out/hate-watch-header-raw.mp4`, then the encode below to `out/hate-watch-header-video-3840x1646.mp4` |
| `SearchPreview` | `src/SearchPreview.tsx` | The App Store search result video, 3840×2560, 12 s loop | `out/hate-watch-search-raw.mp4` (`npm run render:search`), then the encode below to `out/hate-watch-search-video-3840x2560.mp4` |

`src/theme.tsx` holds the colours and type they share; the Inter fonts are in `public/fonts/`. The copy in them follows the app's own wording (`docs/alerts.md`, `docs/startup-guide.md`): change it there first.

## Rendering

From `marketing/video-ads/`: `npm ci`, then `npm run studio` opens Remotion's preview, and `npm run render:a`, `render:b`, `render:c` and `render:guide` write the four vertical MP4s, `render:header` and `render:search` the two store videos, into `out/` (ignored by git, so render before uploading anywhere). The folder has its own `package.json` and lockfile and is not part of the app's fingerprint or the server.

## The header and search result videos

Apple's product page takes a video in two places that used to hold images: the header (landscape, 21:9-ish) and the search results graphic (3:2). They are not App Previews, so Guideline 2.3.4 (screen captures only) does not apply. Apple's spec for both: 30 or 60 fps, 5 to 30 s, `.mov`, `.m4v` or `.mp4`, muted, and it loops. The header is 3840×1646 here; the search result video is 1920×1280 to 3840×2560, and ours is 3840×2560. Both are 12 s, H.264 High Level 5.1, constant 20 Mbps (flat artwork gets far less from x264 unless the bitrate is forced), with a silent stereo AAC track (48 kHz). Uploaded by hand in the same "Header" and "Search Results" slots as the images (`docs/deploy.md` "Build the images").

Both share the headline "Know the second your rivals ..." whose last word rolls through fail, choke, fold, melt down, blow it, fail (`WORDS` and `rollStep` in `src/HeaderPreview.tsx`; the landing page's `.slot`/`.reel` in `app/public/about/index.html` rolls the same words in CSS). The beats are at 12%, 29%, 46%, 63% and 80% of the 360 frames, each roll 6% long with a cubic in-out ease, so the slot width, the word reel and the search feed all move together.

`SearchPreview` steps its alert feed with the word, one sport each (scores and bodies are invented, illustrative):

| Word | Alert | League |
|---|---|---|
| fail | Patrick Mahomes threw an interception | NFL |
| choke | Rockets lost to the Pelicans as 77% favorites | NBA |
| fold | No. 2 Georgia lost to unranked Vanderbilt | CFB |
| melt down | Coventry were thrashed 5-0 by Brighton | EPL |
| blow it | Phillies closer blew the save in the 9th | MLB |
| fail | (card 0 again) | NFL |

The feed is 7 cards (the 5 alerts, then cards 0 and 1 again) and the pitch between cards is a whole number of pixels (438), so the last frame equals the first (checked by rendering frames 0 and 359 as stills and comparing the bytes). Mockups before the build: `app-store/header-animated/` (`header-b.html`, `mockups.html`) and `app-store/search-animated/` (`search-c.html`, the chosen one, and `mockups.html` with the A/B/C comparison); `search-c.html` mirrors `CARDS` and the timing of the composition.

Remotion bundles `ffmpeg` and `ffprobe` (no system ffmpeg), which need `DYLD_LIBRARY_PATH` set to their folder. From `marketing/video-ads/`, after `npm run render:header` or `npm run render:search` (the search one shown; the header is the same with its own files, `-t 12`):

```bash
D="$PWD/node_modules/@remotion/compositor-darwin-arm64"
DYLD_LIBRARY_PATH="$D" "$D/ffmpeg" -y -loglevel error -i out/hate-watch-search-raw.mp4 -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=48000 -t 12 -map 0:v -map 1:a -c:v libx264 -profile:v high -level 5.1 -pix_fmt yuv420p -r 30 -b:v 20M -minrate 20M -maxrate 20M -bufsize 20M -nal-hrd cbr -x264-params "nal-hrd=cbr" -c:a aac -b:a 256k -ar 48000 -movflags +faststart out/hate-watch-search-video-3840x2560.mp4
```

Checked with `ffprobe`: search result video 3840×2560, 30 fps, 12.000 s, H.264 High L5.1, 19.83 Mbps, AAC 48 kHz stereo, 29,769,231 bytes (about 28.4 MiB). The header video is 3840×1646, 12 s, about 29.8 MB.
