# Moving to a new install

<!-- README section: the README has its summary and links here; the vault puts this text back in its place -->

## Index

**Summary:** A device's data (what it tracks, its alert choices, favorites, Hate Watch counts and feed) is keyed to an anonymous device id, so a new install starts blank, and moving from TestFlight to the App Store version is a new install. Settings → "Move to a new install" fixes that with a recovery code: the old install shows a 12-character code, the new install enters it, and the old install's device (its id and everything under it) becomes the new install's. The code works once, is valid until it is used or replaced, and only its hash is stored. Saved alerts, profiles, presets, the most hated list, the language and layouts live on the device only and do not move.

**Sections:**
- **Why a new install is blank**: the device id and secret live in the app's storage; TestFlight and App Store builds are separate installs.
- **The code**: how it is made, its alphabet, how long it lives, what is stored.
- **Redeeming it**: what moves, what is deleted, the old install signed out.
- **What stays on the old install**: the data that is local only.
- **Limits and failures**: the rate limits and every error.
- **The Settings screen**: both halves of `app/src/app/transfer.tsx`.
- **Rolling it out**: the order of a release.

The README's "Moving to a new install" has the summary; this is the full detail. Read this index first, then only the part you need.

## Why a new install is blank

**In short:** a device has no account. `POST /devices` returns a token (`<id>.<secret>`) that the app keeps in its own storage, and everything on the server (follows, favorites, hate watches, feed, prefs) hangs off that id with `ON DELETE CASCADE` (`server/src/db.ts`). A different install, such as the App Store build replacing a TestFlight one, registers its own device and starts with nothing.

## The code

**In short:** Settings → Move to a new install → "Show my recovery code" calls `POST /me/transfer-code` (`createCode` in `server/src/transfer.ts`) and shows the code as `XXXX-XXXX-XXXX`.

- **Alphabet and size:** 12 characters of Crockford's base32 (`0123456789ABCDEFGHJKMNPQRSTVWXYZ`, no I, L, O or U), 60 bits, drawn from `randomBytes` (256 is a multiple of 32, so no bias).
- **Typing it back:** `normalize` upper-cases, drops dashes and spaces, and reads O as 0 and I or L as 1.
- **Stored:** only the sha256 of the normalized code, one row per device in `transfer_codes` (`device_id`, `code_hash`, `created_at`). A new code replaces the old one; deleting the device (Settings → Delete all my data, `DELETE /me`) deletes its code.
- **Lifetime:** valid until it is used or replaced. It survives an uninstall, so the code is made on the old install and kept (copied, written down) before the old install is removed.

## Redeeming it

**In short:** the new install, a blank device of its own, calls `POST /transfer/redeem` with `{code}` (`redeem` in `server/src/transfer.ts`). No rows are copied: the old device keeps its id and everything under it, and takes the new install's identity.

In one transaction:
1. The code's hash finds the old device. An unknown code is `null`; the caller's own code is `'self'`.
2. The caller's blank device row is deleted first, so the push token is never on two rows.
3. The old device gets a new secret and the caller's platform and push token.
4. Its lock screen scoreboard rows (`live_activities`) and its code are deleted.

Then `forgetDevice` closes the old install's socket (a secret is only checked when a socket connects) and `dropped` clears the blank device's season cards and cached prefs. The response is `{token: "<old id>.<new secret>", deviceId}`; the old install's token stops working at once. The app stores the new token and reloads the account (`restoreFromCode` in `app/src/lib/store.tsx`).

A failure leaves both devices as they were.

## What stays on the old install

**In short:** anything the app keeps in its own storage rather than on the server does not move: saved alerts (the star), tracking profiles, alert presets, the most hated list, the language and the layouts. The screen says so ("Saved alerts, profiles, presets and your most hated list stay on the old install").

## Limits and failures

**In short:** a device makes few codes and an address gets few wrong guesses.

| Case | Answer |
|---|---|
| More than 10 new codes an hour from one device (`newCodes`) | 429 `too many new codes, try again later` |
| More than 10 wrong codes an hour from one address (`wrongCodes`, bumped only on an unknown code) | 429 `too many wrong codes from this address, try again later`, checked before the code is looked at |
| A body without a string `code`, or one over 64 characters | 400 `code is a string` |
| The caller's own code | 400 `that code belongs to this install` |
| An unknown code, or one already used | 404 `no such code` |

Both caps are in memory (`windowCap`), so a restart clears them (`docs/known-limits.md`). The app maps 404 to "That code is not valid, or was already used.", 429 to "Too many wrong codes. Try again in an hour." and anything else to "Could not restore".

A related client fix: if a request is rejected (401) with a token that is no longer the current one, `request()` in `app/src/lib/api.ts` retries with the current token instead of registering a blank device, so a restore never races an in-flight request into losing the new identity.

## The Settings screen

**In short:** Settings → Data → "Move to a new install" opens `app/src/app/transfer.tsx` (route `transfer` in `_layout.tsx`), in two halves.

- **On your old install:** "Show my recovery code". The code is selectable and tapping it copies it.
- **On the new install:** a text field and "Restore my data". It asks first ("Replace this install's data?"), because what the new install tracks now is replaced.

Its words are in `app/src/lib/strings/*.ts` (`transfer.*` and `settings.transfer*`) in all six languages. It is JavaScript only, so it can reach builds over the air once the server has the endpoints.

## Rolling it out

**In short:** the server first, then the app.

1. Back up production (`VACUUM INTO`), then deploy the server (`transfer_codes` is created on start).
2. Push the app's JavaScript to `main`, then publish an over-the-air update; no native build is needed.
3. TestFlight users must be on a build that has the screen (the update) before they can make a code. A TestFlight install that never gets the update cannot make one.

Tests: `server/test/transfer.test.ts` (8 tests: the code's shape and normalization, redeem moving the data and signing the old token out, own code, unknown code, replacing a code, the caps, delete).
