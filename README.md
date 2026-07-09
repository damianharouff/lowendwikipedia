# LowEndWikipedia

A lightweight Wikipedia proxy for low-power clients and vintage computers, delivered as a Cloudflare Worker.

## About

LowEndWikipedia provides simplified Wikipedia access for devices that can't handle modern web complexity. It rewrites modern Wikipedia into basic HTML 2.0-era markup that works on e-ink readers (its primary target is the Kindle browser), machines from the 1980s and 1990s, and text-based browsers.

![Example on Kindle](https://static-objects.cekkent.net/kindle-jupiter3.jpg)

Inspired by [FrogFind](http://frogfind.com/) by [Action Retro](https://youtube.com/ActionRetro).

## Features

- **Direct Wikipedia Access**: Searching for an exact article title serves the article immediately (no extra redirect round trip); otherwise you get search results
- **Search Results Fallback**: Uses Wikipedia's OpenSearch API to show up to 15 results when no exact match is found
- **Streaming Rewriter**: Articles are transformed with Cloudflare's native `HTMLRewriter` — the Worker never buffers the page, so bytes reach slow clients as soon as Wikipedia sends them
- **Simplified HTML**: Converts modern Wikipedia to basic HTML 2.0 with a small tag whitelist and all attributes stripped
- **ASCII-Safe Output**: Served as ISO-8859-1 with typographic punctuation transliterated and all other non-ASCII characters encoded as numeric character references, so vintage browsers without Unicode support render correctly
- **No JavaScript Required**: Works on the most basic browsers
- **Link Proxying**: Wikipedia links stay within the simplified interface; external links go direct; edit/red links are unwrapped to plain text
- **Table of Contents**: A compact section-link line under the title (fetched from the MediaWiki sections API) with HTML 2.0-safe named anchors
- **Random Article**: `/wiki/Special:Random` link on the home page, never cached
- **Attribution**: Every article carries a CC BY-SA footer linking to the original
- **Pretty URLs**: `/wiki/Article_name` works just like on Wikipedia
- **E-ink-Optimized Images**: Article images are served through Cloudflare Images as small grayscale JPEGs (500px max, from Wikipedia's own thumbnails — never full-size originals) with layout dimensions preserved; a "Text-only" toggle (`noimg=1`) disables them per page
- **Edge Caching**: Rendered pages are cached at the Cloudflare edge for 10 minutes via the Cache API; transformed images for 30 days
- **Security**: SSRF protection (exact Wikipedia-domain match), XSS-safe rewriting, size-capped file proxying

## Setup

### Prerequisites

- Node.js 18+ installed
- A Cloudflare account
- Wrangler CLI (installed with dependencies)

### Installation

1. Install dependencies:
```bash
npm install
```

2. Configure your Cloudflare account:
```bash
npx wrangler login
```

3. Update `wrangler.jsonc` with your account details if needed

### Development

Run a local development server:
```bash
npm run dev
```
The dev server is accessible at `http://localhost:8787`.

Typecheck and run the test suite:
```bash
npm run check
npm test
```

### Deployment

Deploy to Cloudflare Workers:
```bash
npm run deploy
```

View live logs:
```bash
npm run tail
```

## What Gets Removed

- JavaScript and CSS
- Navigation menus, sidebars, and page toolbars
- Edit links and buttons
- References, external links, bibliography, and sources sections
- Inline citation markers ([1], [2], ...)
- Categories and hidden categories
- Language selection lists
- Infoboxes and all tables (including their images)
- Image galleries
- Table of contents
- Footer text ("Retrieved from", Wikimedia links)
- HTML comments and all element attributes

## What Remains

- Article title and main text
- Basic formatting (headings, paragraphs, bold, italic, lists, definition lists, code blocks)
- Article images with captions (grayscale, resized for e-ink; disable with the "Text-only" link)
- Math formulas as PNG renders (SVG-free, e-ink safe); text-only mode shows the TeX source
- "See also" section with internal links
- Internal Wikipedia links (proxied)
- External links (direct)
- Essential structure for readability

## License

See LICENSE file for details.
