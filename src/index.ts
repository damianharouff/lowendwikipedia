import { parseHTML } from 'linkedom';

export interface Env {
  // Add any environment variables or KV namespaces here
}

function cleanStr(str: string): string {
  return str
    .replace(/'/g, "'")
    .replace(/'/g, "'")
    .replace(/"/g, '"')
    .replace(/"/g, '"')
    .replace(/–/g, '-')
    .replace(/&#x27;/g, "'");
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

async function handleWikipediaSearch(query: string): Promise<string> {
  // Direct Wikipedia search - try to go directly to the article
  const articleUrl = `https://en.wikipedia.org/wiki/${encodeURIComponent(query.replace(/ /g, '_'))}`;
  
  // Redirect directly to the Wikipedia article through our proxy
  return `<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 2.0//EN">
<meta http-equiv="Content-Type" content="text/html; charset=utf-8">
<meta http-equiv="refresh" content="0; url=/read?a=${encodeURIComponent(articleUrl)}">

<html>
<head>
  <title>LowEndWikipedia</title>
</head>
<body>
  <center>Loading Wikipedia article for "<b>${query}</b>"...</center>
  <br>
  <center><a href="/read?a=${encodeURIComponent(articleUrl)}">Click here if not redirected</a></center>
</body>
</html>`;
}

async function handleArticle(articleUrl: string): Promise<Response> {
  if (!articleUrl.startsWith('http')) {
    return new Response("That's not a web page :(", { status: 400 });
  }
  
  try {
    // Check if this is a Wikipedia URL and convert to mobile version for cleaner content
    let fetchUrl = articleUrl;
    const url = new URL(articleUrl);
    
    if (url.hostname.includes('wikipedia.org') && !url.hostname.includes('.m.')) {
      // Convert to mobile Wikipedia for simpler HTML
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
          `Failed to proxy file download, it's too large. :( <br>You can try downloading the file directly: ${articleUrl}`,
          { status: 400 }
        );
      }
      
      // Proxy the file
      const filename = new URL(articleUrl).pathname.split('/').pop() || 'download';
      return new Response(response.body, {
        headers: {
          'Content-Type': contentType,
          'Content-Length': contentLength || '0',
          'Content-Disposition': `attachment; filename="${filename}"`
        }
      });
    }
    
    const html = await response.text();
    const { document } = parseHTML(html);
    
    // Extract title
    const titleElement = document.querySelector('title');
    const title = titleElement ? cleanStr(titleElement.textContent || 'Article') : 'Article';
    
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
    
    // Special Wikipedia cleaning
    if (url.hostname.includes('wikipedia.org')) {
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
        '.languages'
      );
    }
    
    for (const selector of selectorsToRemove) {
      const elements = document.querySelectorAll(selector);
      elements.forEach(el => el.remove());
    }
    
    // For Wikipedia, remove footer sections and navigation
    if (url.hostname.includes('wikipedia.org')) {
      // Remove the header navigation tabs (Article, Talk, etc.)
      const headerNav = document.querySelector('.vector-page-toolbar');
      if (headerNav) headerNav.remove();
      
      const pageActions = document.querySelector('#p-views');
      if (pageActions) pageActions.remove();
      
      const namespaces = document.querySelector('#p-namespaces');
      if (namespaces) namespaces.remove();
      
      // Remove any ul that contains these navigation items
      const navLists = document.querySelectorAll('ul');
      for (const list of navLists) {
        const text = list.textContent || '';
        if (text.includes('Article') && text.includes('Talk') && (text.includes('Edit') || text.includes('Watch'))) {
          list.remove();
        }
      }
      
      // Find and remove specific sections by heading
      const sectionsToRemove = ['Notes', 'References', 'External links', 'External Links', 'Further reading', 'See also', 'Languages', 'Bibliography', 'Sources'];
      const headings = document.querySelectorAll('h2, h3');
      
      for (const heading of headings) {
        const headingText = heading.textContent?.trim() || '';
        if (sectionsToRemove.some(section => headingText.toLowerCase() === section.toLowerCase())) {
          // Remove everything from this heading until the next heading of same or higher level
          let sibling = heading as Element | null;
          const headingLevel = heading.tagName;
          
          while (sibling) {
            const next = sibling.nextElementSibling;
            sibling.remove();
            
            // Stop if we hit another heading of same or higher level
            if (next && (next.tagName === 'H1' || next.tagName === 'H2' || (headingLevel === 'H3' && next.tagName === 'H3'))) {
              break;
            }
            
            sibling = next;
          }
        }
      }
      
      // Remove any remaining edit text
      const allElements = document.querySelectorAll('*');
      for (const element of allElements) {
        const text = element.textContent?.trim() || '';
        if (text === 'edit' || text === '[edit]' || text === 'Edit') {
          element.remove();
        }
      }
    }
    
    // Get the main content
    let contentElement = document.querySelector('main') || 
                        document.querySelector('article') || 
                        document.querySelector('#content') ||
                        document.querySelector('.content') ||
                        document.querySelector('body');
    
    if (!contentElement) {
      throw new Error('Could not find content');
    }
    
    // Convert to simplified HTML
    const simplifiedHtml = simplifyElement(contentElement, articleUrl);
    
    return new Response(`<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 2.0//EN">
<meta http-equiv="Content-Type" content="text/html; charset=utf-8">

<html>
<head>
  <title>${title}</title>
</head>
<body>
  <p>
    <form action="/read" method="get">
    <a href="/">Back to <b>LowEndWikipedia</b></a> | Browsing URL: <input type="text" size="38" name="a" value="${articleUrl}">
    <input type="submit" value="Go!">
    </form>
  </p>
  <hr>
  <h1>${title}</h1>
  <p><font size="4">${simplifiedHtml}</font></p>
</body>
</html>`, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
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
    <a href="/">Back to <b>LowEndWikipedia</b></a> | Browsing URL: <input type="text" size="38" name="a" value="${articleUrl}">
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
      
      // Handle specific tags
      switch (tagName) {
        case 'a':
          const href = el.getAttribute('href');
          if (href) {
            let absoluteUrl = href;
            try {
              // Convert relative URLs to absolute
              absoluteUrl = new URL(href, baseUrl).href;
              // Route through proxy
              absoluteUrl = `/read?a=${absoluteUrl}`;
            } catch {
              // If URL parsing fails, skip the link
            }
            html += `<a href="${absoluteUrl}">${simplifyElement(el, baseUrl)}</a>`;
          } else {
            html += simplifyElement(el, baseUrl);
          }
          break;
          
        case 'strong':
        case 'em':
          const newTag = tagName === 'strong' ? 'b' : 'i';
          html += `<${newTag}>${simplifyElement(el, baseUrl)}</${newTag}>`;
          break;
          
        case 'h1':
        case 'h2':
        case 'h3':
        case 'h4':
        case 'h5':
        case 'h6':
        case 'p':
        case 'br':
        case 'blockquote':
        case 'ul':
        case 'ol':
        case 'li':
          html += `<${tagName}>${simplifyElement(el, baseUrl)}</${tagName}>`;
          break;
          
        case 'img':
          // Skip images for now (we removed image proxy support)
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
        const results = await handleWikipediaSearch(query);
        return new Response(results, {
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
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
