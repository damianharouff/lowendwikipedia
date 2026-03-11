import { parseHTML } from 'linkedom';

export interface Env {
  // Add any environment variables or KV namespaces here
}

// #1, #2, #3: HTML-escape strings to prevent XSS
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function cleanStr(str: string): string {
  return str
    .replace(/\u2018/g, "'")
    .replace(/\u2019/g, "'")
    .replace(/\u201C/g, '"')
    .replace(/\u201D/g, '"')
    .replace(/\u2013/g, '-')
    .replace(/&#x27;/g, "'");
}

// #4: Validate that a URL points to a Wikipedia domain
function isWikipediaUrl(urlStr: string): boolean {
  try {
    const url = new URL(urlStr);
    return url.protocol === 'https:' && url.hostname.endsWith('wikipedia.org');
  } catch {
    return false;
  }
}

function renderHomePage(): string {
  return `<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 2.0//EN">
<meta http-equiv="Content-Type" content="text/html; charset=utf-8">

<html>
<head>
  <title>LowEndWikipedia</title>
</head>
<body>
  <br><br><center><h1><font size=7>LowEndWikipedia</font></h1></center>
  <center><h2>Wikipedia for low-power clients</h2></center>
  <br><br>
  <center>
  <form action="/" method="get">
  Search Wikipedia: <input type="text" size="30" name="q"><br>
  <input type="submit" value="Search">
  </center>
  <br><br><br>
  <small><center>Inspired by <b><a href="https://frogfind.com/">FrogFind</a> by <a href="https://youtube.com/ActionRetro">Action Retro</a></b> on YouTube</center><br>
  <small><center>Simplified Wikipedia browsing for low-power clients</center></small>
</form>
</body>
</html>`;
}

// #10: Search Wikipedia API and return a results page
async function searchWikipedia(query: string): Promise<string> {
  const searchApiUrl = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=15&format=json`;
  const response = await fetch(searchApiUrl, {
    headers: {
      'User-Agent': 'LowEndWikipedia/1.0 (Cloudflare Worker; lowend-browser-proxy)'
    }
  });
  const data = await response.json() as [string, string[], string[], string[]];
  const titles = data[1];
  const urls = data[3];

  // #1: escape query for safe HTML insertion
  const safeQuery = escapeHtml(query);

  if (titles.length === 0) {
    return `<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 2.0//EN">
<meta http-equiv="Content-Type" content="text/html; charset=utf-8">

<html>
<head>
  <title>LowEndWikipedia - Search Results</title>
</head>
<body>
  <p><a href="/">Back to <b>LowEndWikipedia</b></a></p>
  <hr>
  <h2>No results found for "${safeQuery}"</h2>
  <p>Try a different search term.</p>
</body>
</html>`;
  }

  let resultsHtml = '';
  for (let i = 0; i < titles.length; i++) {
    const proxyUrl = `/read?a=${encodeURIComponent(urls[i])}`;
    resultsHtml += `<li><a href="${proxyUrl}">${escapeHtml(titles[i])}</a></li>\n`;
  }

  return `<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 2.0//EN">
<meta http-equiv="Content-Type" content="text/html; charset=utf-8">

<html>
<head>
  <title>LowEndWikipedia - Search Results</title>
</head>
<body>
  <p><a href="/">Back to <b>LowEndWikipedia</b></a></p>
  <hr>
  <h2>Search results for "${safeQuery}"</h2>
  <ul>
${resultsHtml}  </ul>
</body>
</html>`;
}

// #7: no longer async since it doesn't await; #10: uses search API with fallback
async function handleWikipediaSearch(query: string): Promise<Response> {
  const articleName = query.replace(/ /g, '_');
  const articleUrl = `https://en.wikipedia.org/wiki/${encodeURIComponent(articleName)}`;

  // Try fetching the article directly first
  const checkResponse = await fetch(articleUrl, {
    method: 'HEAD',
    headers: {
      'User-Agent': 'LowEndWikipedia/1.0 (Cloudflare Worker; lowend-browser-proxy)'
    },
    redirect: 'follow'
  });

  if (checkResponse.ok) {
    // Article exists — redirect to it through the proxy
    return Response.redirect(`/read?a=${encodeURIComponent(articleUrl)}`, 302);
  }

  // Article not found — fall back to search results
  const searchHtml = await searchWikipedia(query);
  return new Response(searchHtml, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}

async function handleArticle(articleUrl: string): Promise<Response> {
  // #4: Only allow Wikipedia URLs
  if (!isWikipediaUrl(articleUrl)) {
    return new Response("Only Wikipedia URLs are supported.", { status: 400 });
  }

  // #2, #3: Escape the URL for safe embedding in HTML attributes
  const safeArticleUrl = escapeHtml(articleUrl);

  try {
    // Convert to mobile version for cleaner content
    let fetchUrl = articleUrl;
    const url = new URL(articleUrl);

    if (!url.hostname.includes('.m.')) {
      fetchUrl = articleUrl.replace(/([a-z]+)\.wikipedia\.org/, '$1.m.wikipedia.org');
    }

    const response = await fetch(fetchUrl, {
      headers: {
        'User-Agent': 'LowEndWikipedia/1.0 (Cloudflare Worker; lowend-browser-proxy)'
      }
    });
    const contentType = response.headers.get('content-type') || '';
    const contentLength = response.headers.get('content-length');

    // Handle non-HTML content (downloads)
    if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
      const fileSize = contentLength ? parseInt(contentLength) : 0;
      const maxSize = 8000000; // 8MB

      if (fileSize > maxSize) {
        return new Response(
          `Failed to proxy file download, it's too large. :( <br>You can try downloading the file directly: ${safeArticleUrl}`,
          { status: 400 }
        );
      }

      // #12: Only include Content-Length if known
      const proxyHeaders: Record<string, string> = {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${new URL(articleUrl).pathname.split('/').pop() || 'download'}"`
      };
      if (contentLength) {
        proxyHeaders['Content-Length'] = contentLength;
      }

      return new Response(response.body, { headers: proxyHeaders });
    }

    const html = await response.text();
    const { document } = parseHTML(html);

    // Extract title
    const titleElement = document.querySelector('title');
    const title = titleElement ? escapeHtml(cleanStr(titleElement.textContent || 'Article')) : 'Article';

    // Remove unwanted elements
    const selectorsToRemove = [
      'script',
      'style',
      'noscript',
      'iframe',
      'object',
      'embed',
      'video',
      'audio',
      'canvas',
      'svg',
      '.advertisement',
      '.ads',
      '#cookie-notice',
      '.cookie-banner'
    ];

    // Wikipedia-specific selectors
    selectorsToRemove.push(
      // Navigation and UI elements
      '#mw-navigation',
      '#mw-panel',
      '.mw-editsection',
      '.mw-jump-link',
      '.mw-portlet',
      '.sidebar',
      'div[role="navigation"]',
      '.page-actions-menu',
      '.header-action',
      '.page-actions',
      '.talk',
      '.language-selector',

      // Mobile Wikipedia specific
      '.header',
      '.header-chrome',
      '.minerva__tab-container',
      '.page-actions-menu__list',

      // Content elements to remove
      '.infobox',
      '.navbox',
      '.vertical-navbox',
      '.wikitable',
      '.thumb',
      '.toc',
      '#toc',
      '.reflist',
      '.references',
      'sup.reference',
      '.hatnote',
      '.ambox',

      // Language links
      '#p-lang',
      '.interlanguage-link',
      '.languages',

      // Categories
      '#catlinks',
      '.catlinks',
      '#mw-normal-catlinks',
      '.mw-normal-catlinks',
      '#mw-hidden-catlinks',
      '.mw-hidden-catlinks',
      '[data-mw-interface]'
    );

    for (const selector of selectorsToRemove) {
      const elements = document.querySelectorAll(selector);
      elements.forEach((el: Element) => el.remove());
    }

    // Remove footer sections and navigation
    const headerNav = document.querySelector('.vector-page-toolbar');
    if (headerNav) headerNav.remove();

    const pageActions = document.querySelector('#p-views');
    if (pageActions) pageActions.remove();

    const namespaces = document.querySelector('#p-namespaces');
    if (namespaces) namespaces.remove();

    // Remove any ul that contains navigation items
    const navLists = document.querySelectorAll('ul');
    for (const list of navLists) {
      const text = list.textContent || '';
      if (text.includes('Article') && text.includes('Talk') && (text.includes('Edit') || text.includes('Watch'))) {
        list.remove();
      }
    }

    // #8: Remove sections by heading — walk both siblings and <section> wrappers
    const sectionsToRemove = ['Notes', 'References', 'External links', 'External Links', 'Further reading', 'See also', 'Languages', 'Bibliography', 'Sources'];
    const headings = document.querySelectorAll('h2, h3');

    for (const heading of headings) {
      const headingText = heading.textContent?.trim() || '';
      if (!sectionsToRemove.some(section => headingText.toLowerCase() === section.toLowerCase())) {
        continue;
      }

      // Mobile Wikipedia wraps sections in <section> elements
      const parentSection = heading.parentElement;
      if (parentSection && parentSection.tagName === 'SECTION') {
        parentSection.remove();
        continue;
      }

      // Desktop Wikipedia wraps headings in <div class="mw-heading">
      // Walk siblings of the wrapper div instead of the heading itself
      let startEl: Element = heading;
      if (parentSection && parentSection.classList?.contains('mw-heading')) {
        startEl = parentSection;
      }

      // Walk siblings from the start element
      let sibling: Element | null = startEl;
      const headingLevel = heading.tagName;

      while (sibling) {
        const next = sibling.nextElementSibling;
        sibling.remove();

        if (next) {
          // Check if next element is a heading wrapper or a heading itself at same/higher level
          const nextHeading = next.classList?.contains('mw-heading') ? next.querySelector('h1, h2, h3, h4, h5, h6') : null;
          const nextTag = nextHeading ? nextHeading.tagName : next.tagName;
          if (nextTag === 'H1' || nextTag === 'H2' || (headingLevel === 'H3' && nextTag === 'H3')) {
            break;
          }
        }

        sibling = next;
      }
    }

    // Remove any remaining edit text and category remnants
    const allElements = document.querySelectorAll('*');
    for (const element of allElements) {
      const text = element.textContent?.trim() || '';
      if (text === 'edit' || text === '[edit]' || text === 'Edit') {
        element.remove();
        continue;
      }
      // Catch any category containers that survived selector removal
      const id = element.getAttribute('id') || '';
      if (id === 'catlinks' || id === 'mw-normal-catlinks' || id === 'mw-hidden-catlinks') {
        element.remove();
      }
    }

    // Get the main content
    const contentElement = document.querySelector('main') ||
                          document.querySelector('article') ||
                          document.querySelector('#content') ||
                          document.querySelector('.content') ||
                          document.querySelector('body');

    if (!contentElement) {
      throw new Error('Could not find content');
    }

    // Convert to simplified HTML and strip Wikipedia footer (categories, "Retrieved from")
    let simplifiedHtml = simplifyElement(contentElement, articleUrl);
    const retrievedIdx = simplifiedHtml.indexOf('Retrieved from');
    if (retrievedIdx !== -1) {
      simplifiedHtml = simplifiedHtml.substring(0, retrievedIdx);
    }
    // Also strip standalone "Categories:" or "Hidden categories:" that may appear without "Retrieved from"
    const catIdx = simplifiedHtml.search(/Categories\s*:/);
    if (catIdx !== -1) {
      // Only strip if it's near the end (last 20% of the content) to avoid false positives in article text
      if (catIdx > simplifiedHtml.length * 0.8) {
        simplifiedHtml = simplifiedHtml.substring(0, catIdx);
      }
    }

    // #13: Add cache headers
    return new Response(`<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 2.0//EN">
<meta http-equiv="Content-Type" content="text/html; charset=utf-8">

<html>
<head>
  <title>${title}</title>
</head>
<body>
  <p>
    <form action="/read" method="get">
    <a href="/">Back to <b>LowEndWikipedia</b></a> | Browsing URL: <input type="text" size="38" name="a" value="${safeArticleUrl}">
    <input type="submit" value="Go!">
    </form>
  </p>
  <hr>
  <h1>${title}</h1>
  <p><font size="4">${simplifiedHtml}</font></p>
</body>
</html>`, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=600'
      }
    });
  } catch (error) {
    return new Response(`<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 2.0//EN">
<meta http-equiv="Content-Type" content="text/html; charset=utf-8">

<html>
<head>
  <title>Error</title>
</head>
<body>
  <p>
    <form action="/read" method="get">
    <a href="/">Back to <b>LowEndWikipedia</b></a> | Browsing URL: <input type="text" size="38" name="a" value="${safeArticleUrl}">
    <input type="submit" value="Go!">
    </form>
  </p>
  <hr>
  <p><font color="red">Failed to get the article :(</font></p>
</body>
</html>`, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  }
}

function simplifyElement(element: Element, baseUrl: string): string {
  let html = '';

  for (const node of element.childNodes) {
    if (node.nodeType === 3) { // Text node
      html += cleanStr(node.textContent || '');
    } else if (node.nodeType === 1) { // Element node
      const el = node as Element;
      const tagName = el.tagName.toLowerCase();

      // Skip certain tags
      if (['script', 'style', 'noscript'].includes(tagName)) {
        continue;
      }

      // Skip category containers and other unwanted elements by id/class
      const elId = el.getAttribute('id') || '';
      const elClass = el.getAttribute('class') || '';
      if (elId === 'catlinks' || elId === 'mw-normal-catlinks' || elId === 'mw-hidden-catlinks' ||
          elClass.includes('catlinks') || elClass.includes('mw-hidden-catlinks')) {
        continue;
      }

      // Handle specific tags
      switch (tagName) {
        case 'a': {
          const href = el.getAttribute('href');
          if (href) {
            let proxyUrl = href;
            try {
              const absoluteUrl = new URL(href, baseUrl).href;
              // #5: encode the URL in query string
              proxyUrl = `/read?a=${encodeURIComponent(absoluteUrl)}`;
            } catch {
              // If URL parsing fails, skip the link
            }
            html += `<a href="${proxyUrl}">${simplifyElement(el, baseUrl)}</a>`;
          } else {
            html += simplifyElement(el, baseUrl);
          }
          break;
        }

        // #11: pass through b and i tags directly
        case 'b':
        case 'i':
          html += `<${tagName}>${simplifyElement(el, baseUrl)}</${tagName}>`;
          break;

        case 'strong':
        case 'em': {
          const newTag = tagName === 'strong' ? 'b' : 'i';
          html += `<${newTag}>${simplifyElement(el, baseUrl)}</${newTag}>`;
          break;
        }

        case 'h1':
        case 'h2':
        case 'h3':
        case 'h4':
        case 'h5':
        case 'h6':
        case 'p':
        case 'blockquote':
        case 'ul':
        case 'ol':
        case 'li':
          html += `<${tagName}>${simplifyElement(el, baseUrl)}</${tagName}>`;
          break;

        // #6: br is a void element — no closing tag
        case 'br':
          html += '<br>';
          break;

        case 'img':
          // Skip images for now
          break;

        default:
          // For other elements, just process their children
          html += simplifyElement(el, baseUrl);
      }
    }
  }

  return html;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Handle routes
    if (path === '/' || path === '/index.php') {
      const query = url.searchParams.get('q');
      if (query) {
        return handleWikipediaSearch(query);
      }
      return new Response(renderHomePage(), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }

    if (path === '/read' || path === '/read.php') {
      const articleUrl = url.searchParams.get('a');
      if (!articleUrl) {
        return new Response("No article URL specified. Please provide a URL using the 'a' parameter.", { status: 400 });
      }
      return handleArticle(articleUrl);
    }

    // 404 for unknown paths
    return new Response('Not Found', { status: 404 });
  },
};
