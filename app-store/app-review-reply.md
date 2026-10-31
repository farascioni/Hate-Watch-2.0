# Reply to App Review: Guideline 4.1(a), version 1.2 (20)

Draft, not sent. Paste into the rejection thread in App Store Connect after the new metadata is uploaded.

---

Hello,

Thank you for the review. We have revised the app's metadata to remove the third-party content that guideline 4.1(a) concerns, and we are not claiming any license or affiliation.

What changed:

1. Screenshots, Header and Search Results image: retaken so that no team logo or athlete photo appears. Teams show a coloured badge with their abbreviation and athletes a badge with their jersey number. The league chips that were drawn on the Header and the Play feature graphic are removed.
2. Name, subtitle, keywords, promotional text and description: no league, team or athlete name is used as a keyword or a selling point. The text uses generic sport words (basketball, baseball, hockey, football, motorsport, mixed martial arts) in every localization.
3. App Review notes: updated to match.

Hate Watch is an independent app. It is not affiliated with, endorsed by or sponsored by any league, team, athlete or broadcaster. Team and athlete names appear only as plain text, as a user's own search and tracking choices, and they identify the thing the user follows.

Please let us know if anything else in the metadata needs to change.

---

## Before sending (owner)

- Upload the rebuilt images (`app-store/screenshots*`, `localized/*`, `header-search/`) and the listing text (`app-store/listings/*.md`, `play-listing.md`). The English text exists only in App Store Connect: remove league names from its keywords, subtitle, promotional text and description by hand (generic words as in the other languages, for example `sports,rivals,alerts,scores,basketball,baseball,hockey,football,motorsport,MMA`).
- Upload the iPad set only after it is retaken with `images` off (`docs/deploy.md`, "App Store page images").
- The live app and the production server still show ESPN logos and photos until the `images` switch is turned off on production (`flag-cli.ts images off` over `fly ssh`, affects every install, ask first) or a build ships without them. A reviewer who opens the app would see them.
