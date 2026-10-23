// Self-hosted entrypoint: runs the bundled Worker (dist/index.js, produced by
// `wrangler deploy --dry-run --outdir dist`) inside workerd via Miniflare.
// This is the same runtime `wrangler dev` uses locally, minus the file watcher.
//
// Bindings are simulated by Miniflare:
//   - caches.default  -> disk-backed cache under CACHE_DIR (survives restarts)
//   - env.IMAGES      -> sharp-based simulator (resizes + re-encodes; ignores
//                        `saturation`, so images arrive in colour — the Kindle
//                        renders them grayscale anyway)
import { readFileSync } from 'node:fs';
import { Log, LogLevel, Miniflare } from 'miniflare';

const here = new URL('.', import.meta.url);
const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? '0.0.0.0';
const cacheDir = process.env.CACHE_DIR ?? '/data/cache';

// Keep compatibility settings in lockstep with wrangler.jsonc (JSONC: strip
// line comments before parsing).
const wranglerConfig = JSON.parse(
  readFileSync(new URL('./wrangler.jsonc', here), 'utf8').replace(/^\s*\/\/.*$/gm, ''),
);

const mf = new Miniflare({
  name: wranglerConfig.name ?? 'lowendwikipedia',
  scriptPath: new URL('./dist/index.js', here).pathname,
  modules: true,
  compatibilityDate: wranglerConfig.compatibility_date,
  compatibilityFlags: wranglerConfig.compatibility_flags ?? [],
  images: { binding: wranglerConfig.images?.binding ?? 'IMAGES' },
  cache: true,
  cachePersist: cacheDir,
  host,
  port,
  log: new Log(LogLevel.INFO),
});

const url = await mf.ready;
console.log(`lowendwikipedia listening on ${url} (cache: ${cacheDir})`);

let stopping = false;
async function stop(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`${signal} received, shutting down`);
  await mf.dispose();
  process.exit(0);
}
process.on('SIGTERM', () => stop('SIGTERM'));
process.on('SIGINT', () => stop('SIGINT'));
