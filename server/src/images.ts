// The image switches (flags.ts: images.headshots, images.logos). Off, ESPN's player photos and team logos
// come out of everything the server sends, API responses and live frames alike, on their way out, so every
// app build follows at once. Builds from before already handle what's left: a team or player whose image is
// a "badge://" gets a badge in the team's colour with its code (and a player's jersey number), the way F1
// constructors always have (ESPN has no logo for them); a logo drawn on its own (a box score's team, a stats
// line's opponent) is only drawn when there is one.
import { flagOn } from './flags.ts';

const BADGE = 'badge://hidden';
const isBadge = (v: unknown) => typeof v === 'string' && v.startsWith('badge://');

/** Whether anything has to come out (the common case, everything on, costs nothing). */
export const imagesHidden = () => !flagOn('images.headshots') || !flagOn('images.logos');

/** A copy of what's about to be sent, with the switched-off images taken out. */
export function withoutImages<T>(value: T): T {
  const headshots = flagOn('images.headshots'), logos = flagOn('images.logos');
  if (headshots && logos) return value;
  const walk = (v: any): any => {
    if (Array.isArray(v)) return v.map(walk);
    // Plain objects only (what responses are made of): anything else, a Date say, goes out as it is.
    if (!v || typeof v !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(v))) return v;
    const o: any = {};
    for (const [k, x] of Object.entries(v)) o[k] = walk(x);
    if (!logos) {
      // A team (the Avatar draws its logo, so it needs one): the badge. Anything else: no logo, and it's not drawn.
      if ('logo' in o && !isBadge(o.logo)) o.logo = o.kind === 'team' ? BADGE : null;
      if ('logoDark' in o) o.logoDark = null;
      if ('teamLogo' in o) o.teamLogo = null;
      if ('opponentLogo' in o) delete o.opponentLogo;
    }
    // A player's image is a photo, or their team's logo when ESPN has no photo.
    if (o.kind === 'player' && 'image' in o && !isBadge(o.image) && (o.imageKind === 'headshot' ? !headshots : !logos)) o.image = BADGE;
    return o;
  };
  return walk(value);
}

/** A live frame (JSON), the same way; one that isn't JSON goes as it is (it never stops the rest of a send). */
export function frameWithoutImages(frame: string) {
  if (!imagesHidden()) return frame;
  try { return JSON.stringify(withoutImages(JSON.parse(frame))); } catch { return frame; }
}
