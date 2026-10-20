# Hate Watch Plus: tracking profiles and alert presets

<!-- README section: the README has its summary and links here; the vault puts this text back in its place -->

## Index

**Summary:** Two Hate Watch Plus extras, both kept on the device only: a tracking profile narrows the Feed and the Tracking tab to a named group of the players and teams you track, and an alert preset saves one player's or team's alert choices to apply to another in one tap. Neither changes push notifications.

**Sections:**
- **Tracking profiles**: the chips, what a profile narrows, what it leaves alone.
- **Alert presets**: saving and applying a set of alert choices.
- **Subscription lapse and deleting data**: hidden, never deleted by a lapse.
- **Not built**: push narrowing, a schedule, apply-to-many, a "Big plays only" built-in.
- **Files and checks**: where the code is and how it is tested.

## Tracking profiles

- **What it is:** a named group (24 characters at most, 12 profiles at most) of players and teams you already track. The active profile narrows what the **Feed** and the **Tracking tab** show. **Everyone** (the first chip) is no narrowing.
- **The chips** (`ProfileChips`, `app/src/components/ProfileChips.tsx`): on the Tracking tab, a row of Everyone, one chip per profile and a **+** chip to make one (`ProfileSheet`: a name and a checklist of everyone you track); tapping the active chip edits or deletes it. On the Feed the row is only there once a profile exists, and tapping the active chip goes back to Everyone.
- **Feed rule** (`inProfile` in `app/src/lib/profileLogic.ts`, one predicate): an alert shows when its target is in the profile, **or** it is a developer notice, **or** it is a favorite team's opponent alert (`fav`). A tracked player brings their team's key, so an alert about the team that concerns the player still shows (`profileScope`). Someone you unfollowed since drops out of the scope but stays listed in the profile.
- **Tracking tab rule:** only the profile's own members are listed (not a player's team).
- **Empty profile:** the Feed and the Tracking tab say so and offer **Show everyone**. The **Saved** vault ignores profiles.
- **What it never does:** change push notifications, or `prefs.muted`. A profile is a view; notifications come from the per-target and global alert settings exactly as before. The app says so under the profile name.

## Alert presets

- **What it is:** a named snapshot (24 characters at most, 12 presets at most) of one target's alert choices: each alert type **off**, **in the feed only** or **pushed** (`Tier`). Saved from a followed player's or team's alerts screen (`app/src/app/alerts/[key].tsx`, the gold **Presets** row, `PresetSheet`).
- **Saving** snapshots the effective tier of every alert type for that target, the target's own setting if it has one, otherwise the global one (`snapshotChoices`). It also offers all-off, feed-only and push-all starting points (`uniformChoices`).
- **Editing and making one from scratch:** each preset of yours has an **Edit** button and the sheet has a **New preset** button (a new one starts with every alert in the feed). Both open `PresetEditor` (`PresetSheet.tsx`): a name and, for each alert type this target has, **Off / Feed / Push**; tapping the picked choice again leaves that alert out of the preset. Alerts the preset sets that this target lacks are kept as they are. Save calls `updateAlertPreset` (same id, same place in the list) or `saveAlertPreset`; both refuse an empty name or no choices at all. It needs no custom choices on the target, so a target with nothing customized can still make a preset (before, the sheet only said to change some alerts first). The 12-preset cap blocks New, not Edit.
- **Applying** to another target replaces that target's custom choices in **one** `updatePrefs` call (`presetPatch`): every current custom entry is cleared, then the preset's tier is laid over each alert type that exists for that target. A preset type the target does not have is skipped; a preset that fits none of the target's types (`fitCount` is 0) is disabled. Two writes would race (`updatePrefs` is optimistic), so it is one.
- **Per-target settings beat global ones**, so applying a preset never touches the global alert settings.

## Subscription lapse and deleting data

Both lists are kept when the subscription lapses and come back on resubscribing, like the alert vault: the chips, the Presets row and the narrowing are hidden and the Feed and Tracking tab show everyone (`useProfileScope` returns no scope without Plus). Only **Delete all data** in Settings clears them (`clearProfiles`, `clearAlertPresets` in `deleteAllData`, `app/src/lib/store.tsx`). `lapsePlus()` deliberately does not.

## Not built

- **Narrowing push notifications by profile.** It would need a server change (the server decides who gets a push from the per-target settings it holds) and a deploy; the profile exists only on the phone.
- A profile schedule (a profile on at game time), applying a preset to many targets at once, and a built-in "Big plays only" preset.

## Files and checks

- `app/src/lib/profileLogic.ts` (pure rules, no storage or React), `profiles.ts` (store, AsyncStorage key `hw.profiles`, `useProfileScope`), `alertPresets.ts` (store, key `hw.alertPresets`), `app/src/components/ProfileChips.tsx`, `ProfileSheet.tsx`, `PresetSheet.tsx`, `PlusSheet.tsx` (the shared gold bottom sheet), the Feed (`app/src/app/(tabs)/index.tsx`) and Tracking tab (`following.tsx`). Strings: `profile.*` and `preset.*` in all six language files.
- `node app/scripts/check-profiles.mjs` checks the pure rules (scope, the Feed predicate, tiers, the preset patch). The screens are checked by hand in the dev app.
