// Sends the pushes `publish()` decides on, through Expo's push service (one API in front of APNs on iOS and FCM on
// Android), and checks on them afterwards. Expo answers a send at once with a ticket per message: 'ok' with an id, or an
// error (DeviceNotRegistered clears the device's token). The verdict from Apple and Google comes later, in a receipt
// for that id, so about 15 minutes after each chunk (Expo's advice) we ask for the receipts of its 'ok' tickets:
// DeviceNotRegistered there clears the token the same way, so a dead token isn't sent to again (Apple and Google
// throttle apps that keep sending to them); any other error is logged once and forgotten. An id Expo hasn't reported
// yet, or a request that failed, is asked about once more 15 minutes later, then dropped.
//
// The ids wait in a timer's closure, not a table: a restart forgets the receipts due in the next 15 minutes (their
// dead tokens turn up on a later send's ticket or receipt instead). A chunk is at most 100 messages, so one receipts
// request is always under Expo's limit of 1000 ids.
import { db } from './db.ts';
import type { PushMessage } from './fanout.ts';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push';
const RECEIPT_WAIT_MS = 15 * 60_000;

/** What Expo returns per message: a ticket (with an id) at send time, a receipt (keyed by that id) later. */
type Ticket = { status: string; id?: string; message?: string; details?: { error?: string } };

const headers = () => ({
  'content-type': 'application/json', accept: 'application/json', 'accept-encoding': 'gzip, deflate',
  ...(process.env.EXPO_ACCESS_TOKEN ? { authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` } : {}),
});

const clearToken = (token: string) => db.prepare('UPDATE devices SET push_token = NULL WHERE push_token = ?').run(token);

export function sendPushes(messages: PushMessage[]) {
  // Fire immediately; chunks of 100 per Expo's limit. Never awaited by the detection path.
  for (let i = 0; i < messages.length; i += 100) void sendChunk(messages.slice(i, i + 100));
}

async function sendChunk(chunk: PushMessage[]) {
  try {
    const res = await fetch(`${EXPO_PUSH_URL}/send`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(chunk),
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await res.json()) as { data?: Ticket[] };
    const accepted = new Map<string, string>(); // ticket id -> the token it was for
    json.data?.forEach((ticket, i) => {
      if (ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered') clearToken(chunk[i].to);
      else if (ticket.status === 'ok' && ticket.id) accepted.set(ticket.id, chunk[i].to);
    });
    if (accepted.size) scheduleReceipts(accepted, false);
  } catch (e) {
    console.error('[push] send failed', String(e));
  }
}

function scheduleReceipts(tickets: Map<string, string>, retry: boolean) {
  setTimeout(() => void checkReceipts(tickets, retry), RECEIPT_WAIT_MS).unref();
}

async function checkReceipts(tickets: Map<string, string>, retry: boolean) {
  const left = new Map(tickets); // ids with no verdict yet
  try {
    const res = await fetch(`${EXPO_PUSH_URL}/getReceipts`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ ids: [...tickets.keys()] }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as { data?: Record<string, Ticket> };
    for (const [id, token] of tickets) {
      const receipt = json.data?.[id];
      if (!receipt) continue;
      left.delete(id);
      if (receipt.status === 'ok') continue;
      if (receipt.details?.error === 'DeviceNotRegistered') clearToken(token);
      else console.error(`[push] receipt ${id} ${receipt.details?.error ?? receipt.status}: ${receipt.message ?? ''}`);
    }
  } catch (e) {
    console.error('[push] receipts failed', String(e));
  }
  if (!left.size) return;
  if (retry) console.error(`[push] no receipt for ${left.size} tickets, giving up`);
  else scheduleReceipts(left, true);
}
