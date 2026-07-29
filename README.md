# Price Tracker

Paste a product URL from anywhere — Uniqlo SG, Amazon.sg, a Shopify store, a fare page — and it gets
checked once a day. Each item has a detail page with the current price, the historical low, when it was
last discounted and by how much, and a chart of every price we've recorded. When something drops, a
Telegram bot messages you.

## Stack

- **Next.js 15** (App Router, server actions) — UI and all mutations
- **Postgres + Prisma** — users, products, price history
- **A separate worker process** — `node-cron` runs the daily scrape and polls Telegram for account links
- **No paid APIs** — prices come from the pages themselves

## Running it

```bash
cp .env.example .env
# put a real SESSION_SECRET in .env:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

docker compose up --build
```

Open http://localhost:3000, create an account, paste a URL.

### Developing on the host

```bash
docker compose up -d db      # Postgres only
npm install
npm run db:push              # create tables
npm run dev                  # http://localhost:3000
npm run worker               # in a second terminal — the daily scheduler
npm run check-now            # scrape everything right now, ignoring the schedule
```

## Deploying to your own server

Requirements: a Linux box with Docker, a domain whose A record points at it, and
ports 80 + 443 open. Caddy handles certificates itself — there is no certbot step.

```bash
git clone <your-repo> tracker && cd tracker
cp .env.prod.example .env.prod

# fill in .env.prod — every CHANGE_ME matters
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"  # SESSION_SECRET
openssl rand -base64 24                                                   # POSTGRES_PASSWORD

docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

Then open `https://your-domain`, create your account, and **set `SIGNUP_MODE=closed`
in `.env.prod` and re-run the compose command.** Otherwise anyone who finds the
URL can register.

How the prod stack differs from the dev one:

| | dev (`docker-compose.yml`) | prod (`docker-compose.prod.yml`) |
|---|---|---|
| Postgres | published on `localhost:5432` | internal network only |
| Password | hardcoded `tracker` | required from env, no default |
| Schema | `prisma migrate deploy` | same, in a separate one-shot `migrate` service that must exit 0 before the app starts |
| TLS | none | Caddy + automatic Let's Encrypt |
| Restarts | manual | `unless-stopped`, with healthchecks |
| Container user | root | `node` (uid 1000) |
| Registration | open | `invite` / `closed` |

Everyday operations:

```bash
C="docker compose -f docker-compose.prod.yml --env-file .env.prod"

$C logs -f worker            # watch the daily scrape
$C exec worker npx tsx worker/run-once.ts   # force a check now
$C ps                        # health status
$C up -d --build             # deploy an update (migrations run first)

# back up — the price history is the only thing that can't be re-derived
$C exec -T db pg_dump -U tracker tracker | gzip > backup-$(date +%F).sql.gz
```

To restore: `gunzip -c backup.sql.gz | $C exec -T db psql -U tracker tracker`.

## Telegram alerts

1. Message [@BotFather](https://t.me/BotFather), send `/newbot`, copy the token.
2. Put it in `.env` as `TELEGRAM_BOT_TOKEN`, restart.
3. Open **Settings** in the app and follow the link button. It opens your bot with a one-time code;
   pressing Start links your account.

Telegram doesn't let bots message people who haven't talked to them first, which is why the linking
step exists. The worker polls `getUpdates` once a minute to pick up new links; the Settings page also
has a "check now" button so you don't have to wait.

**When you get pinged:** by default, any price drop. Set an "alert me below" price on an item and
you'll only hear about it once it's at or under that number. Repeat alerts for the same price are
suppressed.

## How price extraction works

`src/lib/extract/` tries strategies in order, first hit wins:

1. **Site adapters** (`adapters.ts`) — Amazon, Uniqlo (via their public storefront API, since the page
   is client-rendered), Zalora, and any Shopify store (via `<product-url>.json`).
2. **JSON-LD** `Product`/`Offer` blocks — the single highest-yield strategy across retailers.
3. **Microdata** (`itemprop="price"`).
4. **Meta tags** (`product:price:amount`, `og:price:amount`).
5. **Inline app state** — `__NEXT_DATA__`, `__NUXT_DATA__`, `__INITIAL_STATE__`, searched for price-shaped keys.
6. **Visible DOM** — common `.price` class names, as a last resort.

Adding a site is a matter of appending one object to the `adapters` array.

### What won't work

Sites that render prices only after a JS fetch **and** expose no JSON API or structured data. In
practice that's most airline booking engines (fare pages are usually POST-driven searches, not stable
URLs) and anything behind Cloudflare bot protection or a login. Those fail loudly — the item shows
"Check failed" with the reason on its page rather than silently recording nothing.

If you hit a wall on a site you care about, the fix is either a site adapter or swapping `fetchText`
in `src/lib/extract/fetcher.ts` for a headless browser or a scraping API.

### Politeness

The worker checks products serially with a 3-second gap, sends a normal browser User-Agent, and
doesn't retry within a run. Products are shared across users, so ten people tracking the same URL
still means one request a day.

## Layout

```
prisma/schema.prisma        User, Product, PricePoint, TrackedItem
src/lib/extract/            fetching + price extraction
src/lib/tracker.ts          check one product, record it, fire alerts
src/lib/stats.ts            historical low, last discount, deltas
src/lib/telegram.ts         send messages, poll for /start links
src/app/actions/            server actions (auth, add/edit/remove, telegram)
src/app/                    login, dashboard, product detail, settings
worker/index.ts             cron scheduler
```

## Security notes

- Passwords are bcrypt-hashed (cost 12). Sessions are HMAC-signed cookies, httpOnly, 30-day expiry.
- Pasted URLs are checked against private IP ranges before every fetch, so nobody can point the
  scraper at your internal network or a cloud metadata endpoint.
- Fetches are capped at 5 MB and 20 seconds.
