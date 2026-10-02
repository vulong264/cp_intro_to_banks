# /banks and /aws: handover for the web team

Build of 2026-10-02: banks.html is 135.8 KB, sha256 069ae7492c39; aws.html is 142.7 KB, sha256 5d70f93d7699.

**Not ready to go live.** config.json has no links.email, so the footer and the privacy note of banks.html have no contact address. LV will send a new build.

## Files

| File | Put it at |
| --- | --- |
| banks.html | public/banks/index.html |
| og-banks.png | public/banks/og-banks.png |
| banks-film.html | public/banks/banks-film.html |
| banks-film-poster.webp | public/banks/banks-film-poster.webp |
| coderpush-banks-profile-en.pdf | public/banks/coderpush-banks-profile-en.pdf |
| coderpush-banks-profile-vi.pdf | public/banks/coderpush-banks-profile-vi.pdf |
| aws.html | public/aws/index.html |
| og-aws.png | public/aws/og-aws.png |
| coderpush-aws-profile-en.pdf | public/aws/coderpush-aws-profile-en.pdf |
| coderpush-aws-profile-vi.pdf | public/aws/coderpush-aws-profile-vi.pdf |

There are two pages. banks.html is the page for banks at coderpush.com/banks. aws.html is the page for AWS teams at coderpush.com/aws: the same design, with its own copy and use cases. Each is whole in one file, in both languages, with all CSS and JavaScript inline, its own header and footer and no main-site navigation. There is no build step, no environment variable and no server code. Each new build from LV replaces both index.html files; please do not edit them by hand.

Search engines may list both pages. Please add /banks and /aws to the site's sitemap.

banks-film.html is the overview film: one self-contained file of 1.9 MB, about 1.4 MB as sent compressed. The banks page fetches it only when a visitor presses play, then shows it in a frame inside the page. The AWS page has no film. Each new build replaces the film together with index.html.

The site must allow its own pages to be shown in a frame on the same site. Today it sends no X-Frame-Options header and no frame-ancestors rule, so nothing needs changing. If one is added later, keep the same origin allowed for /banks/banks-film.html.

The 4 PDF files are the pages themselves, printed for A4 paper, one per language and view. The Download PDF button in the header and at the end of each page fetches the one for the language in view. Each new build replaces them.

Files next to a page are addressed relative to it. That works at /banks/ and /aws/ with the trailing slash, which is how the site serves pages. If a page is ever served without the slash, it switches to addresses with the slash by itself.

## Routing

coderpush.com is a Next.js site on Vercel with trailing slashes, so each page must answer with and without the slash. Merge this into next.config.js:

```js
async rewrites() {
  return [
    { source: '/banks', destination: '/banks/index.html' },
    { source: '/banks/', destination: '/banks/index.html' },
    { source: '/aws', destination: '/aws/index.html' },
    { source: '/aws/', destination: '/aws/index.html' },
  ];
},
async redirects() {
  return [
    // Temporary until launch week, then set permanent: true.
    { source: '/pitchdeck', destination: '/banks', permanent: false },
    // The AWS door of the banks page is now the AWS page.
    { source: '/banks', has: [{ type: 'query', key: 'door', value: 'aws' }], destination: '/aws', permanent: false },
  ];
},
```

/aws used to be a redirect to /banks?door=aws. Remove that redirect: /aws now has its own page, and the banks page no longer has an AWS door. The redirect above sends old links the other way. Without it the banks page still does the same from the browser.

## Analytics

1. Turn on Vercel Web Analytics for the project if it is not on.
2. Paste its script tag from the Vercel dashboard just before `</head>` in public/banks/index.html and public/aws/index.html. Paste it again whenever a new build replaces the files.
3. Custom events need the Pro plan. The pages send these, each with at most two properties:

| Event | When | Properties |
| --- | --- | --- |
| page_open | After the page has been visible for five seconds | for and door, or door and lang |
| locale_switch | The EN or VI switch in the header | lang |
| section_view | A section reaches the middle of the screen, once | section, door |
| deploy_select | An option in the diagram's deployment selector | option |
| faq_open | An FAQ answer opens | question |
| cta_click | A booking, share, film, PDF or download button, or an email link | cta, and for or door |

The door property is bank on the banks page and aws on the AWS page. Without the script tag the pages send nothing, and they never set cookies, so they also work opened from disk.

## Addresses to test

- `/banks?lang=vi` and `/banks?lang=en` pick the language, and the same on `/aws`. Without `lang`, a browser set to Vietnamese gets Vietnamese.
- `/banks?door=aws` goes to `/aws`, keeping the language.
- `/banks?for=Example+Bank&uc=contact-centre,governed-analytics` shows a greeting for Example Bank and puts those two use cases first.
- `#deploy=region` and `#deploy=localzone` set the diagram on both pages, and `#deploy=onprem` on the banks page.

## Before announcing

- On a phone, /banks and /banks/ open the banks page, and /aws and /aws/ open the AWS page.
- Click a button on each live page and check that the click shows up in Vercel Analytics.
- Press play on the poster on the live banks page: the film opens in the page and plays.
- Press Download PDF on each live page, once in English and once in Vietnamese: each gives a PDF in that language.
