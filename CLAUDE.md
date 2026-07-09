# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

A Cloudflare Worker that proxies Wikipedia into HTML 2.0-era markup for
low-power clients. The primary target device is a **Kindle Oasis** (7" e-ink,
300 ppi, old WebKit); vintage machines and text browsers are secondary.

## Commands

- `npm run dev` — local server at localhost:8787
- `npm test` — vitest (Workers pool, runs in workerd)
- `npm run check` — `wrangler types && tsc` (regenerates `worker-configuration.d.ts`, gitignored)
- `npm run deploy` — deploy (requires `npx wrangler login` in an interactive shell)

Verify changes end-to-end with `wrangler dev` + curl against real Wikipedia,
not just tests.

## Architecture

Everything is in `src/index.ts`. Routes: `/` (home + `?q=` search),
`/read?a=<url>` (article proxy), `/wiki/<title>` (convenience),
`/img?src=<url>` (image proxy). No dependencies — article transformation is
streaming `HTMLRewriter` (never buffer the page; Wikipedia articles run to
~750 KB). Successful GET responses with `max-age` are cached via
`caches.default`; `/wiki/Special:Random` bypasses the cache.

## Invariants and gotchas

- **Output must be pure ASCII.** Pages declare ISO-8859-1; the document text
  handler transliterates typographic punctuation (`cleanStr`) and encodes all
  other non-ASCII as numeric character references. Anything injected into the
  output (including attribute values like `alt`) must be ASCII-safe.
- **HTMLRewriter text chunks are raw source text** — entities arrive
  undecoded (`&lt;` stays `&lt;`). Do NOT escape text chunks; that
  double-escapes. Only transliterate/entity-encode. (This differs from DOM
  `textContent`, which decodes.)
- **Handler order matters.** Handlers run in registration order per element:
  section/chrome removals first, then `head`/`body`/`h1`, then `h2`/`h3`
  (section-skip state machine + `<a name>` anchors), then `a`, then `img`,
  then the `*` catch-all (tag whitelist, attribute stripping, skip
  enforcement), then `onDocument` text/comments.
- **Section removal** is primarily `section[aria-labelledby="<HeadingId>"]`
  selectors (modern Parsoid output); a heading-id state machine
  (`skipLevel`) handles legacy pages without section wrappers. "See also" is
  intentionally kept.
- **SSRF allowlists are exact.** Articles: `wikipedia.org` or
  `*.wikipedia.org`, https only (`endsWith('wikipedia.org')` alone would
  match `evilwikipedia.org` — that was a real bug). Images:
  `upload.wikimedia.org` only, plus `wikimedia.org` restricted to
  `/api/rest_v1/media/math/render/`.
- **The mobile site is gone.** `*.m.wikipedia.org` 301s to desktop; target
  desktop Vector 2022 / Parsoid markup only.
- **Images**: pick the highest-density srcset candidate (~500px thumbnails,
  never originals), keep 1x `width`/`height` attrs for fast e-ink layout,
  route through `/img` (Images binding: grayscale, 500px cap, JPEG q65,
  white background). **Math formulas**: swap Wikimedia's SVG render for its
  PNG render (`/render/svg/` → `/render/png/`) and pass through untouched —
  re-encoding line art blurs glyphs; old WebKit can't draw SVG. `noimg=1`
  is text-only mode and must thread through all rewritten links; formulas
  then render as TeX from the fallback image's `alt`.
- **TOC** is fetched from the MediaWiki `action=parse&prop=sections` API in
  parallel with the article (a streaming rewriter can't know headings in
  advance) and injected after the first `h1`; anchors are HTML 2.0-safe
  `<a name>` on kept headings.
- **Search** serves an exact-title match directly (no HEAD probe, no
  redirect — round trips are expensive on slow clients), falling back to
  OpenSearch results. All upstream failures must render friendly error
  pages, never raw Worker exceptions.
- **User-Agent** carries repo URL + contact email per Wikimedia policy —
  keep it on every upstream fetch (`wikiFetch`).

## Testing notes

Vitest 4 + `@cloudflare/vitest-pool-workers` 0.18+ (the `cloudflareTest`
Vite plugin — `defineWorkersConfig` and `fetchMock` are gone). Tests and the
Worker share an isolate, so stub outbound requests with
`vi.stubGlobal('fetch', ...)`. Unit tests drive `transformArticle` directly
with fixture HTML; the local Images binding simulator resizes but ignores
`saturation`, so verify grayscale in production, not locally.
