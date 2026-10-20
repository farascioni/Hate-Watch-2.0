# Motion

<!-- README section: the README has its summary and links here; the vault puts this text back in its place -->

## Index

**Summary:** the app moves a little where something just happened: a live alert drops in, the counter and a score roll up, a series cell fills, the heart and the red X pop, the share check pops; a live game's dot sends out rings, the first cards of a tab wave in, a game that just ended in a loss gets a gold glint, an F1 order slides when it reshuffles, and the Plus upsell breathes. It is React Native's own `Animated` on the native driver (opacity and transform only), plus the phone's reduce-motion setting, so every bit of it ships over the air with no new build. Nothing here depends on a haptic (the web version has none).

**Sections:**
- **The pieces**: `lib/motion.ts` and `components/RollingNumber.tsx`.
- **Where it moves**: each animation, its trigger and its files.
- **Rules**: what keeps it OTA-safe and quiet.

## The pieces
- `app/src/lib/motion.ts`: `reduceMotion()` (the setting, read once and kept current), `useOnChange(value, fn)` (calls `fn(prev, next)` on a change after the first render, never on mount) and `usePop(peak)` (a `scale` value and `pop()`: swell to `peak` in 130 ms, spring back; does nothing under reduce motion).
- Also in `motion.ts`: `usePulse(on)` and `useBreath(on)` (a looping 0 to 1 value, 1,600 ms and 4,200 ms; it runs only while `on`, its screen is the focused one and reduce motion is off, and resets to 0 when it stops; `running` says whether it moves) and `useWave(tab)` (the first-load entrance of a list: the first 6 rows to mount within 400 ms of the tab's first row rise 16 px and fade in over 300 ms, 45 ms apart; once per launch per tab name; with no tab, or under reduce motion, the finished state).
- `app/src/components/RollingNumber.tsx`: a number that slides the old text out the top and the new in from below (320 ms), only for an increase from a number. `lineHeight` is required because the box is clipped to one line. `onRoll` fires when it rolls.

## Where it moves
- **Alert lands** (`FeedCard.tsx`): a `fresh` card (the Feed passes it for an alert detected after the app opened, for a minute) drops in with a spring and a red wash fades over it. Once per alert id for the app's life (a module-level set), so scrolling it away and back never replays it. The static red `fresh` border stays the full minute.
- **Counter** (`HateWatchCounter.tsx`): the total rolls and a team's chip count pops when a Successful Hate Watch arrives. The counter shows a held copy that updates only while Settings is focused (tabs stay mounted), so the roll happens in front of you, not off screen.
- **Score** (`GameCard.tsx`): a team's score rolls up when it rises and a red wash flashes the row. A drop or the first value just changes.
- **Series strip** (`SeriesStrip.tsx`): a game's mark fills in from the left when its game begins or ends (a recolour from favoriting or tracking does not replay it).
- **Heart** (`FavoriteButton.tsx`) and **red X** (`following.tsx`, `MostHatedStar`): pop when you turn them on. A press arms a ref; the pop fires only when the state then flips, so favorites finishing loading never pop. A failed favorite change disarms it.
- **Share check** (`FeedCard.tsx`): the icon pops when it turns into the check (where the link was copied; on a phone the share sheet opens instead).
- **Live dot** (`GameCard.tsx`, `LiveDot`): two translucent rings swell from the solid green dot (scale 1 to 3, opacity .6 to 0, a 1,600 ms loop, the second half a cycle behind) on a game that is on. Only while the Scores tab is the one showing; none under reduce motion (the dot stays solid). F1 has its own body and no dot.
- **Wave in** (`GridRow.tsx` `wave`, `useWave`): the Scores and Feed lists pass a tab name, so their first rows rise in one after another the first time the tab loads in a launch. A refresh, a filter change or a row scrolled into view later just appears. The Feed skips a row holding a `fresh` alert, which has its own entrance.
- **Loss glint** (`GameCard.tsx`, `Glint`, `noteFinished`): a 28 px flat gold bar crosses the card in 750 ms (opacity up to .5 and back, 200 ms after it lands) when a game turns from on to over while you watch, and one of your sides lost. Scores sections split by game state, so the card remounts when it finishes; `noteFinished` (fed from the Scores render) remembers each game's last state and which ones just finished (10 s), and the card takes that on mount or on a state change. A game already over when the app loads, a scroll or a refresh never glints.
- **Race order** (`RaceOrder.tsx`): when the order changes the rows slide to their new places (`LayoutAnimation`, 420 ms ease-out). When exactly two neighbours swap, the driver who gained the place flashes green and the one passed red for 900 ms; a pit-stop shuffle of several rows just slides. Android's sliding is not verified (`setLayoutAnimationEnabledExperimental` is never called). The green and red are the plain good-and-bad reading of a pass, not the app's usual tracked-driver colours (there, a tracked driver losing places is hate-coloured good news).
- **Plus glow** (`Plus.tsx`): behind the subscribe button of the upsell, two concentric translucent rings in the accent colour breathe (opacity .35 to .7, scale 1 to 1.12, 4,200 ms). Only while the upsell shows (not for members, not without a store) and Settings is focused.

## Rules
- Only `Animated` from `react-native`, with `useNativeDriver: true` (opacity and transform). A glow or wash is an overlay `View` whose opacity animates. Never drive one value with both drivers. No Reanimated, gesture handler, Lottie or Skia: a new native module changes the fingerprint and stops updates reaching builds already out.
- Every trigger is a real change in the session (`useOnChange`, a fresh id, an increase), never the first render or a reload.
- Reduce motion skips everything to its end state.
- Haptics are never added for motion; the existing ones stay (`.catch(() => {})`).
- Not built: layout make-room when an alert lands, a "swept" wipe on the series strip, a shake on a card, burst dots on the heart and X, the emoji stamping onto a landing alert.
