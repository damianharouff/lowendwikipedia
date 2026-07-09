import { SELF } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { transformArticle } from '../src/index';

const ARTICLE_URL = 'https://en.wikipedia.org/wiki/Test_article';

function wikiPage(bodyContent: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Test article - Wikipedia</title><script>evil()</script></head>
<body class="skin-vector-2022">
<header class="vector-header-container"><nav>chrome</nav></header>
<main id="content">
<h1 id="firstHeading">Test article</h1>
${bodyContent}
</main>
<footer class="mw-footer">footer chrome</footer>
</body>
</html>`;
}

async function transform(bodyContent: string, url = ARTICLE_URL, showImages = true): Promise<string> {
  const upstream = new Response(wikiPage(bodyContent), {
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
  return transformArticle(upstream, url, showImages).text();
}

const FIGURE_HTML = `<figure typeof="mw:File/Thumb"><a href="/wiki/File:Photo.jpg"><img src="//upload.wikimedia.org/wikipedia/commons/thumb/d/d4/Photo.jpg/250px-Photo.jpg" width="250" height="188" alt="A photo" srcset="//upload.wikimedia.org/wikipedia/commons/thumb/d/d4/Photo.jpg/500px-Photo.jpg 2x"></a><figcaption>The caption</figcaption></figure>`;

describe('transformArticle', () => {
  it('keeps entity-encoded text intact without decoding it into markup', async () => {
    const out = await transform('<p>Use the &lt;script&gt; tag &amp; enjoy.</p>');
    expect(out).toContain('&lt;script&gt;');
    expect(out).toContain('&amp; enjoy');
    expect(out).not.toContain('<script>');
  });

  it('strips scripts, styles, tables, images, and page chrome', async () => {
    const out = await transform(
      '<p>Body text</p><table class="infobox"><tr><td>info</td></tr></table><img src="/x.png"><style>.a{}</style>'
    );
    expect(out).toContain('Body text');
    expect(out).not.toContain('evil()');
    expect(out).not.toContain('<table');
    expect(out).not.toContain('<img');
    expect(out).not.toContain('chrome');
  });

  it('proxies Wikipedia links and keeps external links direct', async () => {
    const out = await transform(
      '<p><a href="/wiki/Other_page">internal</a> <a href="https://example.com/x">external</a></p>'
    );
    expect(out).toContain('href="/read?a=https%3A%2F%2Fen.wikipedia.org%2Fwiki%2FOther_page"');
    expect(out).toContain('href="https://example.com/x"');
  });

  it('unwraps edit links, red links, and unparseable hrefs but keeps their text', async () => {
    const out = await transform(
      '<p><a href="/w/index.php?title=X&action=edit&redlink=1">Missing page</a> <a href="https://##">broken</a></p>'
    );
    expect(out).toContain('Missing page');
    expect(out).toContain('broken');
    expect(out).not.toContain('action=edit');
  });

  it('removes References/External links sections wrapped in <section>', async () => {
    const out = await transform(`
<section aria-labelledby="History"><h2 id="History">History</h2><p>Old times</p></section>
<section aria-labelledby="References"><h2 id="References">References</h2><ul><li>cite 1</li></ul></section>
<section aria-labelledby="External_links"><h2 id="External_links">External links</h2><ul><li>ext 1</li></ul></section>
<section aria-labelledby="See_also"><h2 id="See_also">See also</h2><ul><li><a href="/wiki/Rel">Related</a></li></ul></section>`);
    expect(out).toContain('Old times');
    expect(out).toContain('Related');
    expect(out).not.toContain('cite 1');
    expect(out).not.toContain('ext 1');
    expect(out).not.toContain('References');
  });

  it('removes sections on legacy pages without <section> wrappers', async () => {
    const out = await transform(`
<div class="mw-heading"><h2 id="History">History</h2></div><p>Old times</p>
<div class="mw-heading"><h2 id="References">References</h2></div><ul><li>cite 1</li></ul><p>stray refs text</p>
<div class="mw-heading"><h2 id="Legacy">Legacy</h2></div><p>Still standing</p>`);
    expect(out).toContain('Old times');
    expect(out).toContain('Still standing');
    expect(out).toContain('Legacy');
    expect(out).not.toContain('cite 1');
    expect(out).not.toContain('stray refs text');
  });

  it('converts strong/em to b/i and unwraps other elements', async () => {
    const out = await transform('<p><strong>bold</strong> and <em>italic</em> and <span data-x="1">plain</span></p>');
    expect(out).toContain('<b>bold</b>');
    expect(out).toContain('<i>italic</i>');
    expect(out).toContain('plain');
    expect(out).not.toContain('<span');
  });

  it('encodes non-ASCII text as numeric entities and transliterates punctuation', async () => {
    const out = await transform('<p>Café — “quoted” 中</p>');
    expect(out).toContain('Caf&#233;');
    expect(out).toContain('- "quoted"');
    expect(out).toContain('&#20013;');
  });

  it('proxies Wikimedia images at highest srcset density with layout dimensions', async () => {
    const out = await transform(FIGURE_HTML);
    expect(out).toContain(
      'src="/img?src=https%3A%2F%2Fupload.wikimedia.org%2Fwikipedia%2Fcommons%2Fthumb%2Fd%2Fd4%2FPhoto.jpg%2F500px-Photo.jpg"'
    );
    expect(out).toContain('width="250"');
    expect(out).toContain('height="188"');
    expect(out).toContain('alt="A photo"');
    // File: page wrapper link is unwrapped, caption becomes small italic text
    expect(out).not.toContain('File%3APhoto');
    expect(out).toContain('<small><i>The caption</i></small>');
  });

  it('removes non-Wikimedia images', async () => {
    const out = await transform('<p>text</p><img src="https://example.com/tracker.png">');
    expect(out).not.toContain('<img');
  });

  it('removes images and threads noimg through links in text-only mode', async () => {
    const out = await transform(`${FIGURE_HTML}<p><a href="/wiki/Other_page">link</a></p>`, ARTICLE_URL, false);
    expect(out).not.toContain('<img');
    expect(out).toContain('/read?a=https%3A%2F%2Fen.wikipedia.org%2Fwiki%2FOther_page&noimg=1');
    expect(out).toContain('Show images');
  });

  it('offers a text-only toggle when images are on', async () => {
    const out = await transform('<p>text</p>');
    expect(out).toContain('&noimg=1');
    expect(out).toContain('Text-only');
  });

  it('strips attributes and injects the browsing form shell', async () => {
    const out = await transform('<p class="x" style="color:red" id="para">text</p>');
    expect(out).toContain('<p>text</p>');
    expect(out).toContain('Browsing URL:');
    expect(out).toContain('<title>Test article - LowEndWikipedia</title>');
  });
});

// Tests and the Worker share an isolate, so stubbing globalThis.fetch
// intercepts the Worker's outbound Wikipedia requests.
function stubWikipedia(routes: Record<string, () => Response>) {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input);
    for (const [prefix, make] of Object.entries(routes)) {
      if (url.startsWith(prefix)) return make();
    }
    throw new Error(`Unexpected outbound fetch: ${url}`);
  });
}

describe('routing', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('serves the home page', async () => {
    const res = await SELF.fetch('https://lowend.example/');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('LowEndWikipedia');
  });

  it('rejects /read without a URL', async () => {
    const res = await SELF.fetch('https://lowend.example/read');
    expect(res.status).toBe(400);
  });

  it('rejects non-Wikipedia URLs, including lookalike domains', async () => {
    for (const bad of ['https://example.com/wiki/X', 'https://evilwikipedia.org/wiki/X', 'http://en.wikipedia.org/wiki/X']) {
      const res = await SELF.fetch(`https://lowend.example/read?a=${encodeURIComponent(bad)}`);
      expect(res.status).toBe(400);
    }
  });

  it('serves an exact search match as an article directly', async () => {
    stubWikipedia({
      'https://en.wikipedia.org/wiki/Direct_hit': () =>
        new Response(wikiPage('<p>Direct hit body</p>'), {
          headers: { 'content-type': 'text/html; charset=utf-8' },
        }),
    });

    const res = await SELF.fetch('https://lowend.example/?q=Direct+hit');
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('Direct hit body');
  });

  it('falls back to search results when no exact article exists', async () => {
    stubWikipedia({
      'https://en.wikipedia.org/wiki/No_such_page_xyz': () =>
        new Response('not found', { status: 404, headers: { 'content-type': 'text/html' } }),
      'https://en.wikipedia.org/w/api.php': () =>
        Response.json([
          'No such page xyz',
          ['Result one', 'Result two'],
          ['', ''],
          ['https://en.wikipedia.org/wiki/Result_one', 'https://en.wikipedia.org/wiki/Result_two'],
        ]),
    });

    const res = await SELF.fetch('https://lowend.example/?q=No+such+page+xyz');
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('Result one');
    expect(text).toContain('/read?a=https%3A%2F%2Fen.wikipedia.org%2Fwiki%2FResult_two');
  });

  it('shows a friendly error page when the search API fails', async () => {
    stubWikipedia({
      'https://en.wikipedia.org/wiki/Api_down_test': () =>
        new Response('not found', { status: 404, headers: { 'content-type': 'text/html' } }),
      'https://en.wikipedia.org/w/api.php': () => new Response('server error', { status: 500 }),
    });

    const res = await SELF.fetch('https://lowend.example/?q=Api+down+test');
    expect(res.status).toBe(502);
    expect(await res.text()).toContain('Search failed');
  });

  it('rejects /img for missing or non-Wikimedia sources', async () => {
    let res = await SELF.fetch('https://lowend.example/img');
    expect(res.status).toBe(400);
    res = await SELF.fetch(`https://lowend.example/img?src=${encodeURIComponent('https://example.com/x.png')}`);
    expect(res.status).toBe(400);
  });

  it('serves images from the /img proxy', async () => {
    // Minimal valid 1x1 PNG
    const png = Uint8Array.from(
      atob(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
      ),
      (c) => c.charCodeAt(0)
    );
    stubWikipedia({
      'https://upload.wikimedia.org/': () =>
        new Response(png, { headers: { 'content-type': 'image/png' } }),
    });

    const src = encodeURIComponent('https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/X.jpg/500px-X.jpg');
    const res = await SELF.fetch(`https://lowend.example/img?src=${src}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^image\//);
    expect(res.headers.get('cache-control')).toContain('max-age');
  });

  it('serves /wiki/ paths directly', async () => {
    stubWikipedia({
      'https://en.wikipedia.org/wiki/Pretty_path': () =>
        new Response(wikiPage('<p>Pretty path body</p>'), {
          headers: { 'content-type': 'text/html; charset=utf-8' },
        }),
    });

    const res = await SELF.fetch('https://lowend.example/wiki/Pretty_path');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Pretty path body');
  });
});
