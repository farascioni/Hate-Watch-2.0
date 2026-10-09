// ESPN's video clips on alerts. Each clip of a play names it (the clip API's `plays`), with the same id the
// alert keeps (meta.playId), so a clip goes on exactly the alerts about its play, 4 to 9 minutes after them.
// A loss's alerts get the winning play's clip (meta.clipPlayId, the play that put the winner ahead for good),
// else the game's recap. Stored on the alert (events.clip), sent to the feeds that have it (an eventUpdate,
// no push), and shown while ESPN has it up and its switch is on (flags.ts).
import { db } from './db.ts';
import { flagOn } from './flags.ts';
import type { Clip } from './highlights.ts';

/** A clip from ESPN's video list (a game summary's `videos`), unless it's gone or has no video. */
export function clipFromVideo(v: any, now = Date.now()): Clip | null {
  const expires = Date.parse(v?.timeRestrictions?.expirationDate ?? '') || null;
  const hls = v?.links?.source?.HLS?.href ?? null, mp4 = v?.links?.source?.href ?? null;
  if ((expires && expires < now) || !(hls || mp4) || v?.id == null) return null;
  return {
    id: String(v.id), title: String(v.headline ?? ''), seconds: Number(v.duration) || 0, thumb: v.thumbnail ?? null,
    hls, mp4, at: Date.parse(v.originalPublishDate ?? '') || 0, expires,
  };
}

/**
 * The game's recap ("Celtics vs. Cavaliers: Game Highlights", about 75s): it names a play, but it's the
 * whole game. By its title: a long clip of one play (a fight, a long review) is still that play's.
 */
export const isRecap = (c: Pick<Clip, 'title'>) => /\bhighlights\b/i.test(c.title);

/**
 * The play ids a clip names, from the clip API's raw text: they're 19 digits ("4019079930801990057"), too
 * many for a JSON number, which would round them.
 */
export function playIdsIn(raw: string): string[] {
  return [...raw.matchAll(/"plays"\s*:\s*\[([^\]]*)\]/g)].flatMap((m) => [...m[1].matchAll(/"id"\s*:\s*"?(\d+)"?/g)].map((x) => x[1]));
}

/** Whether a stored clip shows on its alert: still up at ESPN and its switch on. */
export function clipShown(clip: Clip | null, meta: { lossClip?: boolean } | null, now = Date.now()): Clip | null {
  if (!clip || (clip.expires && clip.expires < now)) return null;
  return flagOn(meta?.lossClip ? 'clips.loss' : 'clips.feed') ? clip : null;
}

/**
 * Put the game's clips on its alerts that don't have one: a play's clip on the alerts about that play, and
 * on a loss's alerts the winning play's clip, or the recap if that play has none. Returns the alerts that
 * got one (the caller tells their feeds).
 */
export function attachClips(gameId: string, byPlay: Map<string, Clip>, recap: Clip | null): string[] {
  if (!byPlay.size && !recap) return [];
  const rows = db.prepare('SELECT id, meta FROM events WHERE game_id = ? AND clip IS NULL').all(gameId) as { id: string; meta: string | null }[];
  const set = db.prepare('UPDATE events SET clip = ? WHERE id = ? AND clip IS NULL');
  const got: string[] = [];
  for (const r of rows) {
    const meta = r.meta ? JSON.parse(r.meta) : null;
    const clip = meta?.lossClip
      ? (flagOn('clips.loss') ? byPlay.get(String(meta.clipPlayId ?? '')) ?? recap : undefined)
      : meta?.playId != null && flagOn('clips.feed') ? byPlay.get(String(meta.playId)) : undefined;
    if (clip && set.run(JSON.stringify(clip), r.id).changes) got.push(r.id);
  }
  return got;
}
