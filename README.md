# LowEndWikipedia

A lightweight Wikipedia proxy for low-power clients and vintage computers, delivered as a Cloudflare Worker.

## About

LowEndWikipedia provides simplified Wikipedia access for devices that can't handle modern web complexity. It strips JavaScript, CSS, and complex HTML to deliver content that works on machines from the 1980s and 1990s, as well as modern low-power devices and text-based browsers.

![Example on Kindle](https://static-objects.cekkent.net/kindle-jupiter3.jpg)

Inspired by [FrogFind](http://frogfind.com/) by [Action Retro](https://youtube.com/ActionRetro).

## Features

- **Direct Wikipedia Access**: Search goes straight to Wikipedia articles
- **Simplified HTML**: Converts modern Wikipedia to basic HTML 2.0
- **No JavaScript Required**: Works on the most basic browsers
- **Clean Reading Experience**: Removes sidebars, navigation, edit links, and references
- **Link Proxying**: All Wikipedia links stay within the simplified interface
- **Image Support**: Basic image viewing for JPG/PNG files
- **Low Bandwidth**: Stripped-down HTML reduces data transfer

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

### Deployment

Deploy to Cloudflare Workers:
```bash
npm run deploy
```
The worker deploys to production at `https://lowendwikipedia.your-account-name.workers.dev`

## What Gets Removed

- JavaScript and CSS
- Navigation menus and sidebars
- Edit links and buttons
- References and external links sections
- Language selection lists
- Infoboxes and complex tables
- Thumbnails and image galleries
- Table of contents
- Footer sections

## What Remains

- Article title and main text
- Basic formatting (headings, paragraphs, lists)
- Internal Wikipedia links (proxied)
- Essential structure for readability

## License

See LICENSE file for details.