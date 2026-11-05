# Video ads

<!-- README section: the README has its summary and links here; the vault puts this text back in its place -->

## Index

**Summary:** the store and social videos are React components rendered to MP4 with Remotion, in `marketing/video-ads/`: three vertical ads, a video of the startup guide and the App Store header as a landscape App Preview. The sources are in git; the renders (`out/`) are not, since each is a few megabytes and comes back from one command.

**Sections:**
- **The compositions**: the five videos and their files.
- **Rendering**: install, preview and render commands.
- **The App Preview header**: why it is a video, its size and the ffmpeg encode that meets Apple's spec.

## The compositions

`src/Root.tsx` registers five compositions, 1080×1920 at 30 fps except `HeaderPreview` (`src/index.ts` is Remotion's entry):

| Id | File | What it is | Output |
|---|---|---|---|
| `FailFeed` | `src/FailFeed.tsx` | Ad 1: a rival's failures landing in the feed | `out/hate-watch-ad-1-fail-feed.mp4` |
| `FeatureTour` | `src/FeatureTour.tsx` | Ad 2: a tour of the features | `out/hate-watch-ad-2-feature-tour.mp4` |
| `Ad3` | `src/Ad3.tsx` | Ad 3: a rough week for a rival | `out/hate-watch-ad-3-rough-week.mp4` |
| `GuideVideo` | `src/GuideVideo.tsx` | The startup guide as a video | `out/hate-watch-guide-video.mp4` |
| `HeaderPreview` | `src/HeaderPreview.tsx` | The App Store header as a 1920×886, 24 s App Preview | `out/hate-watch-header-preview-raw.mp4`, then the encode below |

`src/theme.tsx` holds the colours and type they share; the Inter fonts are in `public/fonts/`. The copy in them follows the app's own wording (`docs/alerts.md`, `docs/startup-guide.md`): change it there first.

## Rendering

From `marketing/video-ads/`: `npm ci`, then `npm run studio` opens Remotion's preview, and `npm run render:a`, `render:b`, `render:c` and `render:guide` write the four vertical MP4s into `out/` (ignored by git, so render before uploading anywhere). The folder has its own `package.json` and lockfile and is not part of the app's fingerprint or the server.

## The App Preview header

Apple's product-page header image cannot move; only an App Preview video can. `HeaderPreview` is header B of `app-store/header-animated/` (the store header's layout from `app-store/build-store-images.mjs`, scaled to fill the frame): the eye and brow stay still and the last word of "Know the second your rivals ..." rolls through fail, choke, fold, melt down, blow it, fail. 24 s is two 12 s loops, inside Apple's 15 to 30 s. The landing page's hero headline (`.slot`/`.reel` in `app/public/about/index.html`) rolls the same words in CSS.

`npm run render:header` writes the raw render (1920×886, the landscape size Apple takes for every current iPhone; 886×1920 is the portrait one). Apple wants H.264 at 10 to 12 Mbps (High Profile, Level 4.0 at most), at most 30 fps, with a stereo AAC track at 44.1 or 48 kHz. x264 gives flat artwork far less than 10 Mbps, so the encode forces constant bitrate. Remotion bundles `ffmpeg` and `ffprobe` (no system ffmpeg), which need `DYLD_LIBRARY_PATH` set to their folder. From `marketing/video-ads/`:

```bash
D="$PWD/node_modules/@remotion/compositor-darwin-arm64"
DYLD_LIBRARY_PATH="$D" "$D/ffmpeg" -y -loglevel error -i out/hate-watch-header-preview-raw.mp4 -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=48000 -t 24 -map 0:v -map 1:a -c:v libx264 -profile:v high -level 4.0 -pix_fmt yuv420p -r 30 -b:v 11M -minrate 11M -maxrate 11M -bufsize 22M -x264-params nal-hrd=cbr:force-cfr=1 -movflags +faststart -c:a aac -b:a 256k -ar 48000 -ac 2 out/hate-watch-app-preview-header-1920x886.mp4
```

The result (about 31 MiB, 10.9 Mbps, checked with `ffprobe`) uploads by hand in App Store Connect under App Previews and Screenshots, not in the Header slot. It has a silent audio track because Apple requires one.

**Review risk:** App Review Guideline 2.3.4 says previews "may only use video screen captures of the app itself" (overlays and text are allowed on top). This video is artwork only, with no app footage, so Apple may reject it when it is reviewed with a submission. If so, cut real app capture (for example from `GuideVideo` or a simulator recording) under the same headline.
