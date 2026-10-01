# /banks: handover for the web team

Build of 2026-10-01: banks.html is 139.7 KB, sha256 e3c930030a50.

**Not ready to go live.** config.json has no links.email, so the footer and the privacy note have no contact address. config.json has no links.awsContactEmail, so the AWS door has no contact address. LV will send a new build.

## Files

| File | Put it at |
| --- | --- |
| banks.html | public/banks/index.html |
| og-banks.png | public/banks/og-banks.png |
| banks-film.html | public/banks/banks-film.html |
| banks-film-poster.webp | public/banks/banks-film-poster.webp |

banks.html is the whole page: both doors, both languages, and all CSS and JavaScript inline. It has its own header and footer and no main-site navigation. There is no build step, no environment variable and no server code. Each new build from LV replaces index.html; please do not edit the file by hand.

banks-film.html is the overview film: one self-contained file of 1.9 MB, about 1.4 MB as sent compressed. The page fetches it only when a visitor presses play, then shows it in a frame inside the page. Each new build replaces it together with index.html.

The film and its poster are addressed relative to the page. That works at /banks/ with the trailing slash, which is how the site serves pages. If the page is ever served at /banks without the slash, it switches to /banks/ addresses by itself.

The site must allow its own pages to be shown in a frame on the same site. Today it sends no X-Frame-Options header and no frame-ancestors rule, so nothing needs changing. If one is added later, keep the same origin allowed for /banks/banks-film.html.

## Routing

coderpush.com is a Next.js site on Vercel with trailing slashes, so the page must answer at both /banks and /banks/. Merge this into next.config.js:

```js
async rewrites() {
  return [
    { source: '/banks', destination: '/banks/index.html' },
    { source: '/banks/', destination: '/banks/index.html' },
  ];
},
async redirects() {
  return [
    // Temporary until launch week, then set permanent: true.
    { source: '/aws', destination: '/banks?door=aws', permanent: false },
    { source: '/pitchdeck', destination: '/banks', permanent: false },
  ];
},
```

## Analytics

1. Turn on Vercel Web Analytics for the project if it is not on.
2. Paste its script tag from the Vercel dashboard just before `</head>` in public/banks/index.html. Paste it again whenever a new build replaces the file.
3. Custom events need the Pro plan. The page sends these, each with at most two properties:

| Event | When | Properties |
| --- | --- | --- |
| page_open | After the page has been visible for five seconds | for and door, or door and lang |
| locale_switch | The EN or VI switch in the header | lang |
| section_view | A section reaches the middle of the screen, once per door | section, door |
| deploy_select | An option in the diagram's deployment selector | option |
| faq_open | An FAQ answer opens | question |
| cta_click | A booking, share, film or download button, or an email link | cta, and for or door |

Without the script tag the page sends nothing, and it never sets cookies, so it also works opened from disk.

## Addresses to test

- `/banks?lang=vi` and `/banks?lang=en` pick the language. Without `lang`, a browser set to Vietnamese gets Vietnamese.
- `/banks?door=aws` opens the AWS door.
- `/banks?for=Example+Bank&uc=contact-centre,governed-analytics` shows a greeting for Example Bank and puts those two use cases first.
- `#deploy=region`, `#deploy=localzone` and `#deploy=onprem` set the diagram.

## Before announcing

- On a phone, /banks and /banks/ open the bank door, and /aws opens the AWS door.
- Click a button on the live page and check that the click shows up in Vercel Analytics.
- Press play on the poster on the live page: the film opens in the page and plays.
