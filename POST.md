# I got tired of checking whether things went on sale, so I built a tracker

Paste a URL. Any URL — a Uniqlo listing, an Amazon item, a Shopify store's
product page. Once a day it gets scraped, and when the price drops a Telegram
bot messages you. Each item has a page with the current price, the historical
low, when it was last discounted and from what, and a chart of everything
recorded so far.

It's a Next.js app with Postgres behind it and a separate worker process that
owns the schedule. Self-hosted, no paid APIs, one `docker compose up`.

## The interesting part is extraction

Everything else here is a CRUD app. The actual problem is: given an arbitrary
URL from a site you've never seen, find the price.

The naive approach — regex the HTML for something dollar-shaped — is a trap. A
product page has the price, the struck-through original, a "members pay" price,
shipping thresholds, four recommended products with their own prices, and a
footer. Grabbing the first match gets you the wrong number, and the failure is
silent, which is the worst kind: you don't find out until a month of history is
garbage.

So the extractor is a ladder, most trustworthy rung first:

1. **Site adapters.** Hand-written, for sites worth the trouble.
2. **JSON-LD** — `<script type="application/ld+json">` with a `Product` and an
   `Offer`. Google rewards retailers for publishing this, so a startling number
   of them do. This one strategy carries most of the long tail.
3. **Microdata** — the older `itemprop="price"` convention.
4. **Meta tags** — `product:price:amount`, `og:price:amount`.
5. **Inline app state** — `__NEXT_DATA__`, `__NUXT_DATA__`, `__INITIAL_STATE__`,
   searched for price-shaped keys.
6. **Visible DOM** — common `.price` class names. Last resort, and it shows.

Rung 5 needed a second pass. Searching a blob of app state for anything called
`amount` will cheerfully return a shipping surcharge. Now it looks for
unambiguous names (`price`, `salePrice`, `currentPrice`) across the whole tree
first, and only falls back to vague ones (`amount`, `value`) if nothing named a
price outright.

If every rung fails, the item fails loudly and shows you why on its page. A
tracker that quietly records nothing is worse than one that admits defeat.

## Three bugs worth writing down

**Setting `accept-encoding` broke every fetch.** I sent browser-realistic
headers, including `accept-encoding: gzip, deflate, br`. Undici only
auto-decompresses a response when *it* added that header — set it yourself and
you own the problem. Every page was being parsed as raw gzip bytes. The
extractor dutifully found no prices anywhere and reported it as "the site
renders prices in JavaScript." Deleting one line fixed every site at once.

The lesson isn't about undici. It's that the failure mode was a *plausible*
error message. I nearly believed it.

**The SSRF guard checked the wrong URL.** Users paste arbitrary URLs, so before
fetching I resolve the hostname and reject anything on a private range —
localhost, RFC1918, and especially `169.254.169.254`, the cloud metadata
endpoint that hands out credentials to anyone who asks.

The check ran once, on the URL you typed. Then `fetch` followed redirects on its
own. A public URL that 302s to `169.254.169.254` sails straight through, because
the address that gets validated and the address that gets connected to aren't
the same one.

The fix is to stop delegating redirects: `redirect: "manual"`, follow the chain
by hand, re-validate every hop, cap the depth. Verified against a public
redirector — metadata IP blocked, RFC1918 blocked, ordinary multi-hop redirects
still work, loops capped at five.

**Login leaked which emails were registered.** Standard defence: when the
account doesn't exist, compare the password against a dummy hash anyway so both
paths take the same time. I wrote a dummy that *looked* like a bcrypt hash but
wasn't a valid one. bcrypt rejected it structurally and returned immediately.

Measured: 216 ms for a real account, 0 ms for a missing one. A perfectly legible
oracle. Real hash, real fix.

All three are the same shape — code that looks correct, reads correct in review,
and is wrong in a way only measurement reveals.

## On not being a nuisance

Someone else's server does the work here, so:

- One request per product per day, not per user. Ten people tracking the same
  URL is still one fetch — products are shared rows, tracked items just point
  at them.
- Checks run serially with a gap between them.
- A real User-Agent, no retry storms, a 5 MB cap and a 20 s timeout.
- Manual "check now" overwrites the day's data point instead of appending, so
  impatient clicking can't fabricate a sawtooth in your own chart.

## What doesn't work

Sites that render prices only after a JS fetch *and* expose no API or structured
data. That group is smaller than I first assumed — I'd written IKEA off on the
strength of a product URL that turned out to be invalid and redirecting to the
homepage. Real IKEA product pages carry perfectly good JSON-LD. Worth checking
what you actually fetched before blaming the site.

Most airline fares are genuinely out of reach, but for a different reason: they
live behind POST-driven searches with no stable URL to track, which no amount of
scraping cleverness fixes.

For the rest there's an optional headless browser, in its own container, tried
only after every static strategy has failed. Rendering costs 5-20s against well
under a second, so it stays off by default and the app image stays free of
Chromium.

## Adapters, when it's worth it

Two sites earned one.

**Amazon** puts the payable price in a visually-hidden `.a-offscreen` span,
which is more reliable than anything visible on the page.

**Uniqlo** is fully client-rendered — no price in the HTML at all. But the API
its own frontend calls is public. It answers `invalid or missing client id`
until you send `x-fr-clientid`, and the value turned out to be sitting in their
main JS bundle: `uq.<region>.web-spa`. It also returns base and promo prices
separately, so the tracker sees `SGD 14.90 (was 19.90)` and knows it's a
genuine markdown rather than guessing from history.

## Stack

Next.js 15 (App Router, server actions), Postgres via Prisma, a `node-cron`
worker, Recharts for the graph, Caddy for automatic HTTPS. Sessions are
HMAC-signed cookies; passwords are bcrypt at cost 12. Registration can be open,
invite-code, or closed, because a personal tool on a public domain still gets
found.

---

*Self-hosted, one `docker compose up`. Adding a site is one object in an array.*
