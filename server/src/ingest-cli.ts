import { ingest } from './catalog.ts';

const t0 = Date.now();
const report = await ingest();
console.log(JSON.stringify(report.leagues, null, 2));
console.log(`${report.problems.length} notes:`);
for (const p of report.problems.slice(0, 50)) console.log('  -', p);
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
