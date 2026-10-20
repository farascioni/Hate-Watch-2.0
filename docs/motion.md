# Motion

<!-- README section: the README has its summary and links here; the vault puts this text back in its place -->

## Index

**Summary:** the app moves a little where something just happened: a live alert drops in, the counter and a score roll up, a series cell fills, the heart and the red X pop, the share check pops. It is React Native's own `Animated` on the native driver (opacity and transform only), plus the phone's reduce-motion setting, so every bit of it ships over the air with no new build. Nothing here depends on a haptic (the web version has none).

**Sections:**
- **The pieces**: `lib/motion.ts` and `components/RollingNumber.tsx`.
- **Where it moves**: each animation, its trigger and its files.
- **Rules**: what keeps it OTA-safe and quiet.

## The pieces
- `app/src/lib/motion.ts`: `reduceMotion()` (the setting, read once and kept current), `useOnChange(value, fn)` (calls `fn(prev, next)` on a change after the first render, never on mount) and `usePop(peak)` (a `scale` value and `pop()`: swell to `peak` in 130 ms, spring back; does nothing under reduce motion).
- `app/src/components/RollingNumber.tsx`: a number that slides the old text out the top and the new in from below (320 ms), only for an increase from a number. `lineHeight` is required because the box is clipped to one line. `onRoll` fires when it rolls.

## Where it moves
- **Alert lands** (`FeedCard.tsx`): a `fresh` card (the Feed passes it for an alert detected after the app opened, for a minute) drops in with a spring and a red wash fades over it. Once per alert id for the app's life (a module-level set), so scrolling it away and back never replays it. The static red `fresh` border stays the full minute.
- **Counter** (`HateWatchCounter.tsx`): the total rolls and a team's chip count pops when a Successful Hate Watch arrives. The counter shows a held copy that updates only while Settings is focused (tabs stay mounted), so the roll happens in front of you, not off screen.
- **Score** (`GameCard.tsx`): a team's score rolls up when it rises and a red wash flashes the row. A drop or the first value just changes.
- **Series strip** (`SeriesStrip.tsx`): a game's mark fills in from the left when its game begins or ends (a recolour from favoriting or tracking does not replay it).
- **Heart** (`FavoriteButton.tsx`) and **red X** (`following.tsx`, `MostHatedStar`): pop when you turn them on. A press arms a ref; the pop fires only when the state then flips, so favorites finishing loading never pop. A failed favorite change disarms it.
- **Share check** (`FeedCard.tsx`): the icon pops when it turns into the check (where the link was copied; on a phone the share sheet opens instead).

## Rules
- Only `Animated` from `react-native`, with `useNativeDriver: true` (opacity and transform). A glow or wash is an overlay `View` whose opacity animates. Never drive one value with both drivers. No Reanimated, gesture handler, Lottie or Skia: a new native module changes the fingerprint and stops updates reaching builds already out.
- Every trigger is a real change in the session (`useOnChange`, a fresh id, an increase), never the first render or a reload.
- Reduce motion skips everything to its end state.
- Haptics are never added for motion; the existing ones stay (`.catch(() => {})`).
- Not built: layout make-room when an alert lands, a stagger and "swept" wipe on the series strip, a shake on a card, burst dots on the heart and X, the emoji stamping onto a landing alert.
