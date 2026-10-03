import { db } from './db.ts';
import type { PushMessage } from './fanout.ts';

// Expo's push service fronts both APNs (iOS) and FCM (Android) with one API.
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

export function sendPushes(messages: PushMessage[]) {
  // Fire immediately; chunks of 100 per Expo's limit. Never awaited by the detection path.
  for (let i = 0; i < messages.length; i += 100) void sendChunk(messages.slice(i, i + 100));
}

async function sendChunk(chunk: PushMessage[]) {
  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json', accept: 'application/json', 'accept-encoding': 'gzip, deflate',
        ...(process.env.EXPO_ACCESS_TOKEN ? { authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` } : {}),
      },
      body: JSON.stringify(chunk),
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await res.json()) as { data?: { status: string; details?: { error?: string } }[] };
    json.data?.forEach((ticket, i) => {
      if (ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered') {
        db.prepare('UPDATE devices SET push_token = NULL WHERE push_token = ?').run(chunk[i].to);
      }
    });
  } catch (e) {
    console.error('[push] send failed', String(e));
  }
}
