# LowEndWikipedia

A lightweight Wikipedia proxy for low-power clients and vintage computers, delivered as a Cloudflare Worker.

## About

LowEndWikipedia provides simplified Wikipedia access for devices that can't handle modern web complexity. It strips JavaScript, CSS, and complex HTML to deliver content that works on machines from the 1980s and 1990s, as well as modern low-power devices and text-based browsers.

![Example on Kindle](https://static-objects.cekkent.net/kindle-jupiter3.jpg)

Inspired by [FrogFind](http://frogfind.com/) by [Action Retro](https://youtube.com/ActionRetro).

## Features

- **Direct Wikipedia Access**: Search checks for an exact article match first, then falls back to search results
- **Search Results Fallback**: Uses Wikipedia's OpenSearch API to show up to 15 results when no exact match is found
- **Simplified HTML**: Converts modern Wikipedia to basic HTML 2.0
- **No JavaScript Required**: Works on the most basic browsers
- **Clean Reading Experience**: Removes sidebars, navigation, edit links, and references
- **Link Proxying**: All Wikipedia links stay within the simplified interface
- **Low Bandwidth**: Stripped-down HTML reduces data transfer
- **Caching**: Article pages are cached for 10 minutes to reduce latency
- **Security**: XSS-safe output escaping, SSRF protection (Wikipedia-only URLs), proper URL encoding

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

3. Update `wrangler.toml` with your account details if needed

### Development

Run a local development server:
```bash
npm run dev
```
The dev server is accessible at `http://localhost:8787`.

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
- Navigation menus and sidebars
- Edit links and buttons
- References, external links, bibliography, and sources sections
- Categories and hidden categories
- Language selection lists
- Infoboxes and complex tables
- Thumbnails and image galleries
- Table of contents
- Footer text ("Retrieved from", Wikimedia links)

## What Remains

- Article title and main text
- Basic formatting (headings, paragraphs, bold, italic, lists)
- "See also" section with internal links
- Internal Wikipedia links (proxied)
- Essential structure for readability

## License

See LICENSE file for details.
