# Video ads

<!-- README section: the README has its summary and links here; the vault puts this text back in its place -->

## Index

**Summary:** the store and social videos are React components rendered to MP4 with Remotion, in `marketing/video-ads/`: three vertical ads and a video of the startup guide. The sources are in git; the renders (`out/`) are not, since each is a few megabytes and comes back from one command.

**Sections:**
- **The compositions**: the four videos and their files.
- **Rendering**: install, preview and render commands.

## The compositions

`src/Root.tsx` registers four compositions, all 1080×1920 at 30 fps (`src/index.ts` is Remotion's entry):

| Id | File | What it is | Output |
|---|---|---|---|
| `FailFeed` | `src/FailFeed.tsx` | Ad 1: a rival's failures landing in the feed | `out/hate-watch-ad-1-fail-feed.mp4` |
| `FeatureTour` | `src/FeatureTour.tsx` | Ad 2: a tour of the features | `out/hate-watch-ad-2-feature-tour.mp4` |
| `Ad3` | `src/Ad3.tsx` | Ad 3: a rough week for a rival | `out/hate-watch-ad-3-rough-week.mp4` |
| `GuideVideo` | `src/GuideVideo.tsx` | The startup guide as a video | `out/hate-watch-guide-video.mp4` |

`src/theme.tsx` holds the colours and type they share; the Inter fonts are in `public/fonts/`. The copy in them follows the app's own wording (`docs/alerts.md`, `docs/startup-guide.md`): change it there first.

## Rendering

From `marketing/video-ads/`: `npm ci`, then `npm run studio` opens Remotion's preview, and `npm run render:a`, `render:b`, `render:c` and `render:guide` write the four MP4s into `out/` (ignored by git, so render before uploading anywhere). The folder has its own `package.json` and lockfile and is not part of the app's fingerprint or the server.
