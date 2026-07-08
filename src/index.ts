/**
 * LowEndWikipedia — a streaming Wikipedia proxy for low-power clients
 * (Kindle e-ink browsers, vintage machines, text-mode browsers).
 *
 * Articles are fetched from Wikipedia and rewritten on the fly with
 * HTMLRewriter into simple HTML 2.0-era markup: no scripts, styles,
 * images, tables, or navigation chrome, with all output encoded as
 * pure ASCII (numeric character references for anything beyond it).
 */

const USER_AGENT = 'LowEndWikipedia/1.0 (Cloudflare Worker; lowend-browser-proxy)';
const CONTENT_TYPE = 'text/html; charset=iso-8859-1';
const CACHE_CONTROL = 'public, max-age=600';
const MAX_DOWNLOAD_BYTES = 8_000_000;

// Sections dropped from articles, matched by MediaWiki heading id
// (heading ids are the heading text with spaces as underscores).
// "See also" is intentionally kept.
const REMOVED_SECTION_IDS = [
  'Notes',
  'References',
  'Citations',
  'Footnotes',
  'External_links',
  'Further_reading',
  'Bibliography',
  'Sources',
  'Works_cited',
  'Languages',
];
const REMOVED_SECTION_ID_SET = new Set(REMOVED_SECTION_IDS);

// Elements whose entire subtree is dropped.
const REMOVED_TAGS = new Set([
  'script', 'style', 'noscript', 'template', 'link', 'meta', 'iframe',
  'object', 'embed', 'video', 'audio', 'canvas', 'svg', 'math', 'img',
  'picture', 'source', 'figure', 'map', 'table', 'form', 'input', 'button',
  'select', 'textarea', 'label', 'nav', 'footer', 'aside', 'dialog',
]);

// Wikipedia chrome, citations, and layout furniture removed by selector.
const REMOVED_SELECTORS = [
  // Vector 2022 / MediaWiki page chrome
  '.vector-header-container',
  '.vector-column-start',
  '.vector-column-end',
  '.vector-page-toolbar',
  '.vector-body-before-content',
  '.vector-settings',
  '#mw-navigation',
  '#mw-panel',
  '#vector-toc',
  '#siteNotice',
  '#siteSub',
  '#contentSub',
  '#contentSub2',
  '.mw-indicators',
  '.mw-jump-link',
  '.mw-editsection',
  '.mw-portlet',
  '.printfooter',
  '.mw-footer',
  '#footer',
  'div[role="navigation"]',
  // Categories and interlanguage links
  '#catlinks',
  '.catlinks',
  '.mw-hidden-catlinks',
  '#p-lang',
  '#p-lang-btn',
  '.interlanguage-link',
  // Citations and reference lists (belt and suspenders for section removal)
  'sup.reference',
  '.mw-cite-backlink',
  '.reflist',
  '.refbegin',
  '.mw-references-wrap',
  // Content furniture that doesn't survive simplification
  '.hatnote',
  '.ambox',
  '.infobox',
  '.navbox',
  '.vertical-navbox',
  '.sidebar',
  '.thumb',
  '.gallery',
  '.toc',
  '#toc',
  '.noprint',
  '.mwe-math-element',
];

// Elements kept as-is (attributes stripped). Everything else is unwrapped.
const KEPT_TAGS = new Set([
  'html', 'head', 'body',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'blockquote', 'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'pre', 'code', 'tt', 'kbd', 'samp',
  'b', 'i', 'u', 'small', 'big', 'center',
  'br', 'hr',
]);

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Transliterate typographic punctuation that pre-Unicode charsets lack.
function cleanStr(str: string): string {
  return str
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/ /g, ' ');
}

// Encode remaining non-ASCII as numeric character references so the byte
// stream is pure ASCII — valid under the declared ISO-8859-1 charset and
// renderable on both e-ink browsers and vintage machines.
function toAsciiEntities(str: string): string {
  return str.replace(/[^\x00-\x7F]/gu, (ch) => `&#${ch.codePointAt(0)};`);
}

// Full treatment for text we author ourselves (titles, queries, URLs).
function safeText(str: string): string {
  return toAsciiEntities(escapeHtml(cleanStr(str)));
}

function isWikipediaUrl(urlStr: string): boolean {
  try {
    const url = new URL(urlStr);
    return (
      url.protocol === 'https:' &&
      (url.hostname === 'wikipedia.org' || url.hostname.endsWith('.wikipedia.org'))
    );
  } catch {
    return false;
  }
}

function titleFromUrl(urlStr: string): string {
  try {
    const segment = new URL(urlStr).pathname.split('/').pop() || '';
    return decodeURIComponent(segment).replace(/_/g, ' ') || 'Article';
  } catch {
    return 'Article';
  }
}

function wikiFetch(url: string): Promise<Response> {
  return fetch(url, { headers: { 'User-Agent': USER_AGENT } });
}

function pageShell(title: string, body: string): string {
  return `<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 2.0//EN">
<html>
<head>
<meta http-equiv="Content-Type" content="text/html; charset=iso-8859-1">
<title>${title}</title>
</head>
<body>
${body}
</body>
</html>`;
}

// The "Browsing URL" bar shown above articles and error pages.
function browsingForm(articleUrl: string): string {
  return `<p><form action="/read" method="get"><a href="/">Back to <b>LowEndWikipedia</b></a> | Browsing URL: <input type="text" size="30" name="a" value="${safeText(articleUrl)}"> <input type="submit" value="Go!"></form></p>
<hr>`;
}

function htmlResponse(html: string, status = 200, cacheable = false): Response {
  const headers: Record<string, string> = { 'Content-Type': CONTENT_TYPE };
  if (cacheable && status === 200) {
    headers['Cache-Control'] = CACHE_CONTROL;
  }
  return new Response(html, { status, headers });
}

function errorResponse(articleUrl: string, message: string, status: number): Response {
  return htmlResponse(
    pageShell('LowEndWikipedia - Error', `${browsingForm(articleUrl)}
<p><b>${safeText(message)}</b></p>`),
    status
  );
}

function renderHomePage(): string {
  return pageShell(
    'LowEndWikipedia',
    `<br><br><center><h1><font size=7>LowEndWikipedia</font></h1></center>
<center><h2>Wikipedia for low-power clients</h2></center>
<br><br>
<center>
<form action="/" method="get">
Search Wikipedia: <input type="text" size="30" name="q"><br>
<input type="submit" value="Search">
</form>
</center>
<br><br><br>
<small><center>Inspired by <b><a href="https://frogfind.com/">FrogFind</a> by <a href="https://youtube.com/ActionRetro">Action Retro</a></b> on YouTube</center></small>
<small><center>Simplified Wikipedia browsing for low-power clients</center></small>`
  );
}

/**
 * Rewrite a Wikipedia HTML response into simplified, ASCII-safe markup.
 *
 * Streaming, so the client starts receiving bytes before Wikipedia has
 * finished sending them and the Worker never buffers the page.
 */
export function transformArticle(upstream: Response, articleUrl: string): Response {
  const title = safeText(`${titleFromUrl(articleUrl)} - LowEndWikipedia`);
  const rewriter = new HTMLRewriter();

  // Modern parser output wraps each section in
  // <section aria-labelledby="<HeadingId>"> — remove unwanted ones whole.
  for (const id of REMOVED_SECTION_IDS) {
    rewriter.on(`section[aria-labelledby="${id}"]`, {
      element(el) {
        el.remove();
      },
    });
  }

  for (const selector of REMOVED_SELECTORS) {
    rewriter.on(selector, {
      element(el) {
        el.remove();
      },
    });
  }

  rewriter.on('head', {
    element(el) {
      el.setInnerContent(
        `<meta http-equiv="Content-Type" content="text/html; charset=iso-8859-1"><title>${title}</title>`,
        { html: true }
      );
    },
  });

  rewriter.on('body', {
    element(el) {
      el.prepend(`${browsingForm(articleUrl)}<font size="4">`, { html: true });
      el.append('</font>', { html: true });
    },
  });

  // Fallback for pages without <section> wrappers: when a heading matches a
  // removed section, drop it and everything after it until the next heading
  // at the same or higher level. skipLevel is per-request state.
  let skipLevel: number | null = null;
  const headingHandler = (level: number) => ({
    element(el: Element) {
      if (el.removed) return;
      const id = el.getAttribute('id') || '';
      if (REMOVED_SECTION_ID_SET.has(id)) {
        skipLevel = level;
        el.remove();
      } else if (skipLevel !== null && level <= skipLevel) {
        skipLevel = null;
      }
    },
  });
  rewriter.on('h2', headingHandler(2));
  rewriter.on('h3', headingHandler(3));

  rewriter.on('a', {
    element(el) {
      if (el.removed) return;
      const href = el.getAttribute('href');
      stripAttributes(el);
      if (!href) {
        el.removeAndKeepContent();
        return;
      }
      let resolved: URL;
      try {
        resolved = new URL(href, articleUrl);
      } catch {
        el.removeAndKeepContent();
        return;
      }
      if (isWikipediaUrl(resolved.href)) {
        const samePage = resolved.href.split('#')[0] === articleUrl.split('#')[0];
        const isEditLink = resolved.searchParams.has('action') || resolved.searchParams.has('redlink');
        if (samePage || isEditLink) {
          // Fragment anchors don't survive attribute stripping, and edit /
          // red links lead nowhere useful — keep the text, drop the link.
          el.removeAndKeepContent();
        } else {
          el.setAttribute('href', `/read?a=${encodeURIComponent(resolved.href)}`);
        }
      } else if (['http:', 'https:', 'mailto:'].includes(resolved.protocol)) {
        // Non-Wikipedia links are left as direct links rather than proxied.
        el.setAttribute('href', resolved.href);
      } else {
        el.removeAndKeepContent();
      }
    },
  });

  rewriter.on('*', {
    element(el) {
      if (el.removed) return;
      const tag = el.tagName.toLowerCase();
      if (REMOVED_TAGS.has(tag)) {
        el.remove();
        return;
      }
      if (tag === 'a') {
        // Rewritten by the handler above; only enforce section skipping.
        if (skipLevel !== null) el.remove();
        return;
      }
      if (KEPT_TAGS.has(tag)) {
        if (skipLevel !== null && !['html', 'head', 'body'].includes(tag)) {
          el.remove();
          return;
        }
        stripAttributes(el);
        return;
      }
      if ((tag === 'strong' || tag === 'em') && skipLevel === null) {
        const replacement = tag === 'strong' ? 'b' : 'i';
        el.before(`<${replacement}>`, { html: true });
        el.after(`</${replacement}>`, { html: true });
      }
      // Wrappers (div, section, span, header, cite, ...) are unwrapped; while
      // skipping, their children are then removed individually, so a wrapper
      // never hides the heading that ends the skip.
      el.removeAndKeepContent();
    },
  });

  rewriter.onDocument({
    comments(comment) {
      comment.remove();
    },
    text(text) {
      if (skipLevel !== null) {
        if (text.text) text.replace('');
        return;
      }
      const original = text.text;
      if (!original) return;
      // Text chunks arrive as raw source text (entities intact), so no
      // escaping is needed — only transliteration and ASCII encoding.
      const cleaned = toAsciiEntities(cleanStr(original));
      if (cleaned !== original) text.replace(cleaned, { html: true });
    },
  });

  const transformed = rewriter.transform(upstream);
  return new Response(transformed.body, {
    headers: {
      'Content-Type': CONTENT_TYPE,
      'Cache-Control': CACHE_CONTROL,
    },
  });
}

function stripAttributes(el: Element): void {
  const names = [...el.attributes].map(([name]) => name);
  for (const name of names) {
    el.removeAttribute(name);
  }
}

// Errors the piped body if the upstream sends more than `max` bytes,
// so unknown-length downloads can't stream unbounded data.
function byteLimit(max: number): TransformStream<Uint8Array, Uint8Array> {
  let total = 0;
  return new TransformStream({
    transform(chunk, controller) {
      total += chunk.byteLength;
      if (total > max) {
        controller.error(new Error('Download exceeds size limit'));
      } else {
        controller.enqueue(chunk);
      }
    },
  });
}

function proxyDownload(upstream: Response, articleUrl: string): Response {
  const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
  const contentLength = upstream.headers.get('content-length');
  if (contentLength && parseInt(contentLength, 10) > MAX_DOWNLOAD_BYTES) {
    return errorResponse(
      articleUrl,
      "Failed to proxy file download, it's too large (8 MB limit). Try downloading it directly.",
      413
    );
  }
  const rawName = new URL(articleUrl).pathname.split('/').pop() || 'download';
  const filename = rawName.replace(/[^\w.-]/g, '_');
  const headers: Record<string, string> = {
    'Content-Type': contentType,
    'Content-Disposition': `attachment; filename="${filename}"`,
  };
  if (contentLength) {
    headers['Content-Length'] = contentLength;
  }
  const body = upstream.body ? upstream.body.pipeThrough(byteLimit(MAX_DOWNLOAD_BYTES)) : null;
  return new Response(body, { status: upstream.status, headers });
}

async function handleArticle(articleUrl: string): Promise<Response> {
  if (!isWikipediaUrl(articleUrl)) {
    return errorResponse(articleUrl, 'Only Wikipedia URLs are supported.', 400);
  }

  let upstream: Response;
  try {
    upstream = await wikiFetch(articleUrl);
  } catch {
    return errorResponse(articleUrl, 'Failed to get the article :(', 502);
  }

  const contentType = upstream.headers.get('content-type') || '';
  if (contentType.includes('text/plain')) {
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
  if (!contentType.includes('text/html')) {
    return proxyDownload(upstream, articleUrl);
  }
  if (!upstream.ok) {
    return errorResponse(
      articleUrl,
      upstream.status === 404
        ? 'Wikipedia has no article at this URL.'
        : `Wikipedia returned an error (HTTP ${upstream.status}).`,
      upstream.status === 404 ? 404 : 502
    );
  }
  return transformArticle(upstream, upstream.url || articleUrl);
}

async function renderSearchResults(query: string): Promise<Response> {
  const safeQuery = safeText(query);
  try {
    const apiUrl = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=15&namespace=0&format=json`;
    const response = await wikiFetch(apiUrl);
    if (!response.ok) {
      throw new Error(`opensearch returned HTTP ${response.status}`);
    }
    const data = (await response.json()) as unknown[];
    const titles = Array.isArray(data?.[1]) ? (data[1] as unknown[]) : [];
    const urls = Array.isArray(data?.[3]) ? (data[3] as unknown[]) : [];

    let items = '';
    for (let i = 0; i < titles.length; i++) {
      const resultTitle = titles[i];
      const resultUrl = urls[i];
      if (typeof resultTitle !== 'string' || typeof resultUrl !== 'string') continue;
      items += `<li><a href="/read?a=${encodeURIComponent(resultUrl)}">${safeText(resultTitle)}</a></li>\n`;
    }

    const body =
      items === ''
        ? `<h2>No results found for "${safeQuery}"</h2>
<p>Try a different search term.</p>`
        : `<h2>Search results for "${safeQuery}"</h2>
<ul>
${items}</ul>`;

    return htmlResponse(
      pageShell(
        'LowEndWikipedia - Search Results',
        `<p><a href="/">Back to <b>LowEndWikipedia</b></a></p>
<hr>
${body}`
      ),
      200,
      true
    );
  } catch {
    return htmlResponse(
      pageShell(
        'LowEndWikipedia - Error',
        `<p><a href="/">Back to <b>LowEndWikipedia</b></a></p>
<hr>
<p><b>Search failed — Wikipedia may be unreachable. Please try again.</b></p>`
      ),
      502
    );
  }
}

// Serve an exact-title match directly (one round trip, no redirect);
// otherwise fall back to search results.
async function handleSearch(query: string): Promise<Response> {
  const trimmed = query.trim();
  if (!trimmed) {
    return htmlResponse(renderHomePage(), 200, true);
  }
  const articleUrl = `https://en.wikipedia.org/wiki/${encodeURIComponent(trimmed.replace(/ /g, '_'))}`;
  try {
    const upstream = await wikiFetch(articleUrl);
    if (upstream.ok && (upstream.headers.get('content-type') || '').includes('text/html')) {
      return transformArticle(upstream, upstream.url || articleUrl);
    }
  } catch {
    // Fall through to search results.
  }
  return renderSearchResults(trimmed);
}

async function handleRequest(url: URL): Promise<Response> {
  const path = url.pathname;

  if (path === '/' || path === '/index.php') {
    const query = url.searchParams.get('q');
    if (query) {
      return handleSearch(query);
    }
    return htmlResponse(renderHomePage(), 200, true);
  }

  if (path === '/read' || path === '/read.php') {
    const articleUrl = url.searchParams.get('a');
    if (!articleUrl) {
      return errorResponse('', "No article URL specified. Provide one with the 'a' parameter.", 400);
    }
    return handleArticle(articleUrl);
  }

  // Convenience: /wiki/Foo works like on Wikipedia itself.
  if (path.startsWith('/wiki/') && path.length > '/wiki/'.length) {
    return handleArticle(`https://en.wikipedia.org${path}`);
  }

  return new Response('Not Found', { status: 404 });
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const cacheable = request.method === 'GET';
    if (cacheable) {
      const cached = await caches.default.match(request);
      if (cached) return cached;
    }

    const response = await handleRequest(new URL(request.url));

    if (
      cacheable &&
      response.status === 200 &&
      (response.headers.get('Cache-Control') || '').includes('max-age')
    ) {
      ctx.waitUntil(caches.default.put(request, response.clone()));
    }
    return response;
  },
} satisfies ExportedHandler<Env>;
