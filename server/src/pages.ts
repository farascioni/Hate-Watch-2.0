// Public HTML pages linked from the App Store listing and the app's Settings screen.
const CONTACT = process.env.HW_CONTACT_EMAIL ?? 'support@example.com';
const UPDATED = 'October 3, 2026';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function layout(title: string, body: string) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · Hate Watch</title>
<style>
  :root { --bg:#0B0B0D; --surface:#16161A; --border:#2A2A31; --text:#F4F4F5; --dim:#A1A1AA; --red:#E5232B; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font:16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  main { max-width: 720px; margin: 0 auto; padding: 32px 16px 64px; }
  header { display:flex; align-items:center; gap:12px; margin-bottom: 8px; }
  header b { font-size: 20px; letter-spacing: .3px; }
  .dot { width: 12px; height: 12px; border-radius: 50%; background: var(--red); box-shadow: 0 0 12px var(--red); }
  h1 { font-size: 28px; line-height: 1.2; margin: 16px 0 4px; }
  h2 { font-size: 18px; margin: 32px 0 8px; color: var(--text); }
  p, li { color: var(--dim); }
  strong { color: var(--text); }
  a { color: var(--red); }
  ul { padding-left: 20px; }
  .muted { color: var(--dim); font-size: 14px; }
  .card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 4px 16px; margin-top: 16px; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th, td { text-align: left; vertical-align: top; padding: 10px 8px; border-bottom: 1px solid var(--border); color: var(--dim); }
  th { color: var(--text); font-weight: 600; }
  footer { margin-top: 48px; font-size: 13px; color: var(--dim); }
</style>
</head>
<body><main>
<header><span class="dot"></span><b>Hate Watch</b></header>
${body}
<footer>
  Hate Watch is an independent app. It is not affiliated with, endorsed by, or sponsored by ESPN, the NBA, MLB, the NFL, the NHL,
  or any team or player. Team names, logos and player images are the property of their respective owners.
  <br><a href="/privacy">Privacy Policy</a> · <a href="/support">Support</a>
</footer>
</main></body></html>`;
}

export function privacyPage() {
  const mail = `<a href="mailto:${esc(CONTACT)}">${esc(CONTACT)}</a>`;
  return layout('Privacy Policy', `
<h1>Privacy Policy</h1>
<p class="muted">Last updated ${UPDATED}</p>

<p>Hate Watch sends you alerts when the athletes and teams you choose to track have a bad moment. This policy explains
exactly what the app collects to do that, and nothing more. <strong>There is no sign-up: we never ask for your name,
email address or phone number.</strong></p>

<h2>What we collect</h2>
<div class="card"><table>
<tr><th>Data</th><th>Why</th></tr>
<tr><td><strong>A random device ID</strong> created when you first open the app, plus a secret key that proves requests come from your device</td><td>To keep your settings and alerts separate from everyone else's. The ID is random; it is not your Apple or Google advertising ID.</td></tr>
<tr><td><strong>Device platform</strong> (iOS or Android)</td><td>To format notifications correctly.</td></tr>
<tr><td><strong>Push notification token</strong>, only if you allow notifications</td><td>To deliver alerts to your device.</td></tr>
<tr><td><strong>The teams and players you track</strong>, and your <strong>notification settings</strong> (alert types, leagues, muted items, quiet hours and the time zone they apply in)</td><td>To decide which alerts to send you and when.</td></tr>
<tr><td><strong>Your alert feed</strong>: the alerts that were delivered to you</td><td>To show your feed history in the app.</td></tr>
</table></div>

<h2>What we don't collect</h2>
<ul>
<li>No name, email, phone number, contacts, photos or precise location.</li>
<li>No advertising identifiers, no ads, and no analytics or tracking SDKs.</li>
<li>We do not track you across other companies' apps or websites, and we do not sell or share your data for advertising.</li>
</ul>

<h2>Who else processes data</h2>
<p>We use a small number of service providers, only to run the app:</p>
<ul>
<li><strong>Fly.io</strong> hosts our server and database in the United States. Like any web host, it processes your IP address to route requests.</li>
<li><strong>Expo push service, Apple Push Notification service and Google Firebase Cloud Messaging</strong> receive your push token and the text of each alert in order to deliver it.</li>
<li><strong>Apple App Store and Google Play</strong> process donations (in-app tips). The payment happens entirely between you and Apple or Google; we never receive your name, card or payment details, and donating unlocks nothing and changes nothing about your data.</li>
<li><strong>ESPN.</strong> Our server reads public sports data (rosters, scores, play-by-play) from ESPN. The app loads player photos and team logos directly from ESPN's image servers, so ESPN receives your device's IP address and standard request information when those images load. We never send ESPN any of the data listed above.</li>
</ul>

<h2>How long we keep it</h2>
<p>We keep your data while you use the app. You can delete it at any time:</p>
<ul>
<li><strong>Settings → Delete all my data</strong> immediately and permanently deletes your device ID, tracked teams and players, settings, push token and alert feed from our server, and gives the app a fresh anonymous identity.</li>
<li><strong>Settings → Clear feed</strong> deletes your alert history only.</li>
<li>Deleted data may remain in encrypted server backups for up to 5 days before those backups expire.</li>
</ul>
<p>Uninstalling the app removes the device ID from your phone, but not from our server. To remove server data, use
<strong>Delete all my data</strong> before uninstalling, or email us.</p>

<h2>Security</h2>
<p>All traffic between the app and our server is encrypted with HTTPS/TLS. Our database is stored on an encrypted volume.
Your device's secret key is kept in the iOS Keychain or Android Keystore.</p>

<h2>Children</h2>
<p>Hate Watch is not directed to children under 13, and we do not knowingly collect information from them.</p>

<h2>Your choices and rights</h2>
<p>You can turn notifications off in the app's Settings or your phone's settings, change exactly which alerts you get, and
delete your data as described above. Depending on where you live (for example under the GDPR or CCPA), you may have the right
to access, correct or delete your data. Because we never know who you are, the easiest way to exercise these rights is in the
app; you can also email ${mail}.</p>

<h2>Changes</h2>
<p>If this policy changes, we will update the date at the top of this page. Significant changes will also be noted in the app.</p>

<h2>Contact</h2>
<p>${mail}</p>
`);
}

export function supportPage() {
  const mail = `<a href="mailto:${esc(CONTACT)}">${esc(CONTACT)}</a>`;
  return layout('Support', `
<h1>Support</h1>
<p>Questions, bugs or feature requests: email ${mail}. We usually reply within a few days.</p>

<h2>I'm not getting alerts</h2>
<ul>
<li>Make sure notifications are allowed for Hate Watch in your phone's settings, and that <strong>Push notifications</strong> is on in the app's Settings tab.</li>
<li>Check that the alert type and the league are switched on in Settings, that the player or team isn't muted on the Tracking tab, and that you're not inside your quiet hours.</li>
<li>Alerts only fire during live games (or when standings and injury reports change). The Feed tab shows everything that was sent to you.</li>
</ul>

<h2>Why do alerts arrive a minute or two after the play?</h2>
<p>We check each live game every two seconds, but our sports data provider itself publishes plays roughly 1–2 minutes after
they happen. Hate Watch sends your alert as soon as the play appears in that feed.</p>

<h2>How do I delete my data?</h2>
<p>Open <strong>Settings → Delete all my data</strong>. Everything is removed from our server immediately. See the
<a href="/privacy">Privacy Policy</a> for details.</p>
`);
}
