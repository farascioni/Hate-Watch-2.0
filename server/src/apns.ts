// Direct APNs for Live Activities (the lock screen scoreboard, live-activity.ts). Expo's push service can't update a Live
// Activity, so this talks to Apple itself: HTTP/2 with a provider token (an ES256 JWT signed by an APNs .p8 key).
// Inert until APNS_KEY_P8, APNS_KEY_ID and APNS_TEAM_ID are set (docs/live-activity.md: how to make the key).
// Tests swap the sender (`setApnsSender`) and never touch the network.
import { createPrivateKey, sign } from 'node:crypto';
import http2 from 'node:http2';

const TOPIC = 'com.hatewatch.app.push-type.liveactivity';
/** Apple rejects a new provider token more than once every 20 minutes and expires one after an hour. */
const JWT_MS = 50 * 60_000;

export const apnsConfigured = () => !!(process.env.APNS_KEY_P8 && process.env.APNS_KEY_ID && process.env.APNS_TEAM_ID);

const b64 = (v: object | Buffer) => (Buffer.isBuffer(v) ? v : Buffer.from(JSON.stringify(v))).toString('base64url');
let jwt: { token: string; at: number } | null = null;
/** The provider token, signed again every 50 minutes. */
export function apnsJwt(now = Date.now()): string {
  if (jwt && now - jwt.at < JWT_MS) return jwt.token;
  const head = `${b64({ alg: 'ES256', kid: process.env.APNS_KEY_ID })}.${b64({ iss: process.env.APNS_TEAM_ID, iat: Math.floor(now / 1000) })}`;
  const key = createPrivateKey(process.env.APNS_KEY_P8!.replace(/\\n/g, '\n'));
  jwt = { token: `${head}.${b64(sign('sha256', Buffer.from(head), { key, dsaEncoding: 'ieee-p1363' }))}`, at: now };
  return jwt.token;
}

export type ApnsResult = { status: number; reason?: string };
export type ApnsSender = (token: string, sandbox: boolean, payload: object, priority: 5 | 10) => Promise<ApnsResult>;

const sessions = new Map<string, http2.ClientHttp2Session>();
function session(host: string) {
  let s = sessions.get(host);
  if (!s || s.closed || s.destroyed) {
    s = http2.connect(`https://${host}`);
    s.on('error', () => sessions.delete(host));
    s.on('close', () => sessions.delete(host));
    s.unref();
    sessions.set(host, s);
  }
  return s;
}

const realSender: ApnsSender = (token, sandbox, payload, priority) => new Promise((resolve) => {
  try {
    const req = session(sandbox ? 'api.sandbox.push.apple.com' : 'api.push.apple.com').request({
      ':method': 'POST', ':path': `/3/device/${token}`, authorization: `bearer ${apnsJwt()}`,
      'apns-push-type': 'liveactivity', 'apns-topic': TOPIC, 'apns-priority': String(priority),
    });
    let status = 0, body = '';
    req.setTimeout(10_000, () => { req.close(); resolve({ status: 0, reason: 'timeout' }); });
    req.on('response', (h) => { status = Number(h[':status']); });
    req.on('data', (c) => { body += c; });
    req.on('end', () => { let reason: string | undefined; try { reason = JSON.parse(body).reason; } catch { /* no body on success */ } resolve({ status, reason }); });
    req.on('error', (e) => resolve({ status: 0, reason: String(e) }));
    req.end(JSON.stringify(payload));
  } catch (e) { resolve({ status: 0, reason: String(e) }); }
});

let sender: ApnsSender = realSender;
export const setApnsSender = (fn: ApnsSender) => { sender = fn; };
export const sendApns: ApnsSender = (...a) => sender(...a);
/** Apple says the token is dead (the activity ended, the app was removed, or it's for the other environment). */
export const tokenGone = (r: ApnsResult) => r.status === 410 || (r.status === 400 && r.reason === 'BadDeviceToken');
