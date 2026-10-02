# cp_intro_to_banks

Two CoderPush pages, each built as one self-contained HTML file: the page for banks at
coderpush.com/banks and the page for AWS teams at coderpush.com/aws. English and Vietnamese, all CSS
and JavaScript inline, each under 150 KB. Both come from the same template and the same copy.

## What is here

| Path | What it is |
| --- | --- |
| content/en.json, content/vi.json | The shared copy, word for word from the copy documents |
| content/aws.en.json, content/aws.vi.json | What the AWS page says differently: its edits and its own use cases |
| config.json | The switches: which clients are named, who is shown, which parts are on, the links |
| template.html | The page: markup, styles and script, with placeholders for the copy |
| build.mjs | The build. Plain Node, no dependencies |
| assets/logos, assets/team, assets/video | Logos, team photos and the film, each with a note on how it is prepared |
| checks/ | Browser checks of the built page |
| dist/ | The last build: the files that go to the web team |

## Build

    node build.mjs

It writes into dist/:

| File | What it is |
| --- | --- |
| banks.html | The page for banks, with its bank door and its older AWS door |
| aws.html | The page for AWS teams |
| HANDOVER.md | The note for the web team: where the files go, routing, analytics, what to test |
| og-banks.png, og-aws.png | The link-preview images, when a local Chrome or Playwright is available |
| banks-film.html, banks-film-poster.webp | The overview film and its poster, while flags.videoReady is on |
| coderpush-banks-profile-*.pdf, coderpush-aws-profile-*.pdf | Each page as a PDF for A4 paper, one per language and view, while flags.profilePdf is on |

The PDFs are printed from the finished page with a local Chrome, so a build with flags.profilePdf on
needs Chrome and a network connection for the font. How they look is decided by the print styles in
template.html (`@media print`), which also serve a visitor who prints the page from the browser.

Options: `--no-og` skips the preview image, `--config other.json`, `--out some/dir`,
`--today 2027-01-15` builds as of another day.

The build stops, and writes nothing, when it finds an em dash or en dash in a source or in the
output, a client's name while that client's switch is off, a hidden person's name, content that
does not match between the two languages, or a page of 150 KB or more.

Every change is an edit to the sources and a new build. dist/ is never edited by hand.

## The AWS page

aws.html is the banks page retold for AWS account managers and solutions architects. The list of pages
is `PAGES` at the top of build.mjs. For the AWS page the build merges content/aws.<lang>.json over the
shared copy:

- An object merges key by key, and `null` removes a key.
- A list of items with a `key` replaces the shared list. Each item starts from the shared item with the
  same key, or the key named in `from`, so it only states what differs. Items not listed are dropped.
- An object given where the shared copy has a list changes the items at those positions.

So a change to the shared copy reaches the AWS page too, unless the AWS page overrides that string.

The page has no film, asks search engines not to list it, and has two places for the data to live:
an AWS Region and the Hanoi Local Zone. The build stops if its output contains on-prem wording, the
word Copilot, or a data centre of the bank's own, in either language. The patterns are in `PAGES`.

## Switches

config.json decides what the built file contains. A part that is switched off is left out of the
file, not hidden in it.

| Switch | While off |
| --- | --- |
| clients.* | The fallback wording replaces the client's name everywhere, and its logo is left out |
| people.* | The person is left off the team section |
| flags.regulationDates | The clock shows only its first line |
| flags.oneDayReply | The AWS door drops the one-business-day promise |
| flags.videoReady | No film: no poster, no button, no film file in dist/ |
| flags.profilePdf | No Download PDF buttons and no PDF files in dist/ |
| flags.downloads | No buttons for the one-page brief and the deck, which are separate files |
| flags.marketplace | No Marketplace line on the AWS door |
| flags.isoMark | ISO/IEC 27001 shows as text only |
| flags.aiPolicyUrl (empty) | No link to the AI principles |
| links.booking (empty) | Booking buttons open an email to links.email |

## Addresses

| Address | Effect |
| --- | --- |
| `?lang=vi`, `?lang=en` | The language. Without it, a browser set to Vietnamese gets Vietnamese |
| `?door=aws` | The AWS door |
| `?for=Example+Bank&uc=contact-centre,governed-analytics` | A greeting for that company, and those use cases first |
| `#deploy=region`, `#deploy=localzone`, `#deploy=onprem` | The diagram's deployment option |

## Checks

    node build.mjs && node checks/run.mjs

Needs Node 22 or newer and a local Chrome. It serves dist/ locally, opens it in headless Chrome
and prints one PASS or FAIL line per check: the views of both pages from disk and from a server,
personal links, a company name containing HTML, the switches, 360 px width, keyboard use, reduced
motion, fonts, analytics events, no cookies, no JavaScript, logos, team, the PDF buttons, the print
layout, the PDF files, the film player, and on the AWS page its use cases and the wording it must
not contain.

The checks describe the page as config.json has it today. The wording check compares the content
files with the copy documents, which are not in this repository, and is skipped without them.

To look at the page as the site would serve it:

    node checks/serve.mjs

then open http://127.0.0.1:8765/banks/ or http://127.0.0.1:8765/aws/. Opening the files in dist/
from disk works too.
