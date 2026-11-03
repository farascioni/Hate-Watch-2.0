// Moving a device's data to a new install, with a recovery code: the Settings screen shows a code (`createCode`), and a new
// install enters it (`redeem`). Redeeming does not copy rows: the old device's identity (its id, so its follows, favorites,
// hate watches, feed and prefs) gets a new secret and the new install's platform and push token, and the new install's own blank
// device is deleted. The old install's token stops working at once and its sockets are closed.
// Only the code's sha256 is stored, one code per device (a new one replaces the old; deleting the device deletes it). A code lives
// until it is used or replaced, so it still works after an uninstall; 12 characters of a 32-letter alphabet are 60 bits.
// Docs: docs/transfer.md.
import { createHash, randomBytes } from 'node:crypto';
import { db, tx } from './db.ts';
import { forgetDevice } from './fanout.ts';
import { forgetSeasonCards } from './season.ts';
import { engine } from './live.ts';

/** Crockford's base32: no I, L, O or U, so a code read off a screen or a note can't be mistyped into another one. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_LENGTH = 12;

/** What a person typed, as stored: upper case, dashes and spaces dropped, and the look-alikes Crockford folds (O is 0, I and L are 1). */
export const normalize = (raw: string) => raw.toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
const hash = (code: string) => createHash('sha256').update(code).digest('hex');

/** A new code for the device (replacing its last one), shown as XXXX-XXXX-XXXX. It is never stored, only its hash. */
export function createCode(deviceId: string): string {
  const code = Array.from(randomBytes(CODE_LENGTH), (b) => ALPHABET[b & 31]).join(''); // 256 is a multiple of 32: no bias
  db.prepare(`INSERT INTO transfer_codes (device_id, code_hash, created_at) VALUES (?,?,?)
    ON CONFLICT(device_id) DO UPDATE SET code_hash = excluded.code_hash, created_at = excluded.created_at`)
    .run(deviceId, hash(code), Date.now());
  return code.replace(/(.{4})(?=.)/g, '$1-');
}

/** Removes a device's traces from memory (the row and its data are already gone): season cards, cached prefs, open sockets. */
export function dropped(deviceId: string) {
  forgetSeasonCards(deviceId);
  forgetDevice(deviceId);
  engine.kick();
}

/**
 * The caller (a new install's blank device) takes over the device the code belongs to. Returns the new token, null for an
 * unknown code, or 'self' for the caller's own code. Everything changes in one transaction, so a failure leaves both devices as they were.
 */
export function redeem(callerId: string, raw: string): { token: string; deviceId: string } | 'self' | null {
  const secret = randomBytes(24).toString('base64url');
  const moved = tx(() => {
    const hit = db.prepare('SELECT device_id FROM transfer_codes WHERE code_hash = ?').get(hash(normalize(raw))) as { device_id: string } | undefined;
    if (!hit) return null;
    if (hit.device_id === callerId) return 'self' as const;
    const me = db.prepare('SELECT platform, push_token FROM devices WHERE id = ?').get(callerId) as { platform: string | null; push_token: string | null };
    db.prepare('DELETE FROM devices WHERE id = ?').run(callerId); // before the update below, so the push token is never on two rows
    db.prepare('UPDATE devices SET secret = ?, platform = ?, push_token = ? WHERE id = ?').run(secret, me.platform, me.push_token, hit.device_id);
    db.prepare('DELETE FROM live_activities WHERE device_id = ?').run(hit.device_id); // the old phone's lock screen board
    db.prepare('DELETE FROM transfer_codes WHERE device_id = ?').run(hit.device_id);
    return hit.device_id;
  });
  if (moved === null || moved === 'self') return moved;
  forgetDevice(moved); // closes the old phone's socket (the secret is only checked when it connects)
  dropped(callerId);
  return { token: `${moved}.${secret}`, deviceId: moved };
}
