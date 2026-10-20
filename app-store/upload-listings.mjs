// Uploads the translated App Store text and screenshots (locales.mjs, listings/<lang>.md, localized/<lang>/) to the
// app's editable version in App Store Connect. Nothing is submitted for review; it only fills the version's localizations.
// Default is a plan: prints what would be sent, offline, no key needed. Real run: add --apply.
//   node app-store/upload-listings.mjs [lang ...] [--apply] [--no-screenshots] [--replace-screenshots]
// Needs for --apply: ASC_KEY_ID, ASC_ISSUER_ID and the key file (default ~/.appstoreconnect/private_keys/AuthKey_<ASC_KEY_ID>.p8).
// Fills: app name + subtitle (appInfoLocalizations); description, keywords, promotional text (appStoreVersionLocalizations);
// screenshots into APP_IPHONE_69 (screenshots/, 1320x2868) and APP_IPHONE_65 (screenshots-6.5in/, 1284x2778).
// Not done: the Header and Search Results images (no known API, upload by hand), "What's new" (Apple wants it on an update
// version: type it in App Store Connect), Google Play (needs its own service-account key, see docs/android-release.md).
import { createSign, createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { LOCALES } from './locales.mjs';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const apply = flag('--apply');
const picked = args.filter((a) => !a.startsWith('--'));
const langs = (picked.length ? picked : Object.keys(LOCALES)).filter((l) => l !== 'en');
for (const l of langs) if (!LOCALES[l]) throw new Error(`unknown language ${l}`);

const SHOT_SETS = [['APP_IPHONE_69', 'screenshots'], ['APP_IPHONE_65', 'screenshots-6.5in']];
const EDITABLE = ['PREPARE_FOR_SUBMISSION', 'DEVELOPER_REJECTED', 'REJECTED', 'METADATA_REJECTED', 'INVALID_BINARY'];

// The sections of listings/<lang>.md, as check-listings.mjs reads them.
const listing = (lang) => Object.fromEntries([...readFileSync(here(`listings/${lang}.md`), 'utf8').matchAll(/^## (.+)\n([\s\S]*?)(?=^## |(?![\s\S]))/gm)].map((m) => [m[1], m[2].trim()]));
const files = (lang, dir) => readdirSync(here(`localized/${lang}/${dir}`)).filter((f) => f.endsWith('.jpg')).sort();

// ---- the plan (always printed)
for (const lang of langs) {
  const t = listing(lang), code = LOCALES[lang].apple[0];
  console.log(`${lang} -> ${code}: name "${t['App name']}", subtitle "${t['Apple subtitle']}", keywords ${t['Apple keywords'].length} chars, promo ${t['Apple promotional text'].length} chars, description ${t.Description.length} chars`);
  if (!flag('--no-screenshots')) for (const [type, dir] of SHOT_SETS) console.log(`   ${type}: ${files(lang, dir).length} screenshots from localized/${lang}/${dir}/`);
}
if (!apply) { console.log('\nPlan only. Nothing was sent. Add --apply to upload.'); process.exit(0); }

// ---- App Store Connect
const keyId = process.env.ASC_KEY_ID, issuer = process.env.ASC_ISSUER_ID;
if (!keyId || !issuer) throw new Error('set ASC_KEY_ID and ASC_ISSUER_ID');
const keyFile = process.env.ASC_KEY_FILE ?? `${homedir()}/.appstoreconnect/private_keys/AuthKey_${keyId}.p8`;
const b64 = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
const token = () => { // ES256, valid 10 minutes (Apple's maximum is 20)
  const head = `${b64({ alg: 'ES256', kid: keyId, typ: 'JWT' })}.${b64({ iss: issuer, exp: Math.floor(Date.now() / 1000) + 600, aud: 'appstoreconnect-v1' })}`;
  const sig = createSign('SHA256').update(head).sign({ key: readFileSync(keyFile), dsaEncoding: 'ieee-p1363' });
  return `${head}.${sig.toString('base64url')}`;
};
const api = async (method, path, body) => {
  const res = await fetch(path.startsWith('http') ? path : `https://api.appstoreconnect.apple.com${path}`, {
    method, headers: { Authorization: `Bearer ${token()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body && JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 600)}`);
  return text ? JSON.parse(text) : {};
};
const rel = (type, id) => ({ data: { type, id } });

const bundleId = JSON.parse(readFileSync(here('../app/app.json'), 'utf8')).expo.ios.bundleIdentifier;
const app = (await api('GET', `/v1/apps?filter[bundleId]=${bundleId}`)).data[0];
if (!app) throw new Error(`no app with bundle id ${bundleId}`);
const versions = (await api('GET', `/v1/apps/${app.id}/appStoreVersions?filter[platform]=IOS&limit=10`)).data;
const version = versions.find((v) => EDITABLE.includes(v.attributes.appStoreState));
if (!version) throw new Error(`no editable iOS version (states: ${versions.map((v) => v.attributes.appStoreState).join(', ')}); create the next version in App Store Connect first`);
console.log(`\nversion ${version.attributes.versionString} (${version.attributes.appStoreState})`);
const infos = (await api('GET', `/v1/apps/${app.id}/appInfos`)).data;
const info = infos.find((i) => EDITABLE.includes(i.attributes.appStoreState ?? i.attributes.state)) ?? infos[0];

// Create the localization when the locale has none, else update it.
const upsert = async (parent, listPath, createType, locale, attributes, parentType) => {
  const existing = (await api('GET', `${listPath}?limit=50`)).data.find((l) => l.attributes.locale === locale);
  if (existing) { await api('PATCH', `/v1/${createType}/${existing.id}`, { data: { type: createType, id: existing.id, attributes } }); return existing; }
  return (await api('POST', `/v1/${createType}`, { data: { type: createType, attributes: { locale, ...attributes }, relationships: { [parentType]: rel(parent.type, parent.id) } } })).data;
};

for (const lang of langs) {
  const t = listing(lang), locale = LOCALES[lang].apple[0];
  await upsert(info, `/v1/appInfos/${info.id}/appInfoLocalizations`, 'appInfoLocalizations', locale, { name: t['App name'], subtitle: t['Apple subtitle'] }, 'appInfo');
  const loc = await upsert(version, `/v1/appStoreVersions/${version.id}/appStoreVersionLocalizations`, 'appStoreVersionLocalizations', locale,
    { description: t.Description, keywords: t['Apple keywords'], promotionalText: t['Apple promotional text'] }, 'appStoreVersion');
  console.log(`${locale}: text set`);
  if (flag('--no-screenshots')) continue;
  const sets = (await api('GET', `/v1/appStoreVersionLocalizations/${loc.id}/appScreenshotSets`)).data;
  for (const [type, dir] of SHOT_SETS) {
    const set = sets.find((s) => s.attributes.screenshotDisplayType === type)
      ?? (await api('POST', '/v1/appScreenshotSets', { data: { type: 'appScreenshotSets', attributes: { screenshotDisplayType: type }, relationships: { appStoreVersionLocalization: rel('appStoreVersionLocalizations', loc.id) } } })).data;
    const have = (await api('GET', `/v1/appScreenshotSets/${set.id}/appScreenshots`)).data;
    if (have.length && !flag('--replace-screenshots')) { console.log(`  ${type}: already has ${have.length} screenshots, skipped (--replace-screenshots deletes them first)`); continue; }
    for (const s of have) await api('DELETE', `/v1/appScreenshots/${s.id}`);
    for (const name of files(lang, dir)) { // one at a time, so they land in file order
      const path = here(`localized/${lang}/${dir}/${name}`), bytes = readFileSync(path);
      const shot = (await api('POST', '/v1/appScreenshots', { data: { type: 'appScreenshots', attributes: { fileName: name, fileSize: statSync(path).size }, relationships: { appScreenshotSet: rel('appScreenshotSets', set.id) } } })).data;
      for (const op of shot.attributes.uploadOperations) {
        const r = await fetch(op.url, { method: op.method, headers: Object.fromEntries(op.requestHeaders.map((h) => [h.name, h.value])), body: bytes.subarray(op.offset, op.offset + op.length) });
        if (!r.ok) throw new Error(`upload of ${name} failed: ${r.status}`);
      }
      await api('PATCH', `/v1/appScreenshots/${shot.id}`, { data: { type: 'appScreenshots', id: shot.id, attributes: { uploaded: true, sourceFileChecksum: createHash('md5').update(bytes).digest('hex') } } });
    }
    console.log(`  ${type}: ${files(lang, dir).length} screenshots uploaded`);
  }
}
console.log('\nDone. Review in App Store Connect; nothing was submitted.');
