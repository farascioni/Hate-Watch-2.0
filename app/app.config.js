// The web export is served under /app (hatewatch.dev is the marketing page, docs/deploy.md "Web").
// experiments.baseUrl is part of the OTA fingerprint, so it is set only while exporting for web:
// native builds, `eas update` and the fingerprint see app.json unchanged.
const webExport = process.argv.includes('export') && process.argv.includes('web');

module.exports = ({ config }) =>
  webExport ? { ...config, experiments: { ...config.experiments, baseUrl: '/app' } } : config;
