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

Requirements: a Linux box with Docker and the Compose plugin, a domain whose DNS
A record points at its public IP, and ports 80 + 443 reachable. Caddy obtains and
renews the TLS certificate itself — there is no certbot step.

### 0. Prerequisites, on the server

```bash
docker --version && docker compose version   # need both

# DNS must already resolve to this machine, or the certificate request fails
curl -s ifconfig.me; echo          # this server's public IP
dig +short tracker.example.com     # must match the line above

sudo ufw allow 80 && sudo ufw allow 443   # if ufw is active
```

Getting the certificate wrong is the most common failure: Let's Encrypt has to
reach your server *by name* over port 80 before it will issue anything.

### 1. Choose how the app image gets there

**Option A — build on the server.** No registry needed, and what runs is exactly
the source you can see.

```bash
git clone https://github.com/Arcralius/price-tracker.git tracker && cd tracker
cp .env.prod.example .env.prod
# ... edit .env.prod (step 2), then:
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

**Option B — pull the published image**
([`arcralius/price-tracker`](https://hub.docker.com/r/arcralius/price-tracker),
`linux/amd64`). Faster, and needs no build toolchain or source on the server.
Only three files have to be present:

```bash
mkdir -p /srv/tracker && cd /srv/tracker
curl -O https://raw.githubusercontent.com/Arcralius/price-tracker/main/docker-compose.prod.yml
curl -O https://raw.githubusercontent.com/Arcralius/price-tracker/main/Caddyfile
curl -o .env.prod https://raw.githubusercontent.com/Arcralius/price-tracker/main/.env.prod.example
# ... edit .env.prod (APP_IMAGE is already set to the published tag), then:
docker compose -f docker-compose.prod.yml --env-file .env.prod pull
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --no-build
```

The database migrations travel inside the image, so nothing else is needed.
Pin a version tag rather than `:latest`, so a redeploy can't silently change
the running code.

### 2. Fill in `.env.prod`

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"  # SESSION_SECRET
openssl rand -hex 24                                                   # POSTGRES_PASSWORD
```

At minimum set `DOMAIN`, `ACME_EMAIL`, `POSTGRES_PASSWORD` and `SESSION_SECRET`.
The stack refuses to start if the last two are missing rather than falling back
to a default — that is deliberate.

### 3. Watch it come up

```bash
C="docker compose -f docker-compose.prod.yml --env-file .env.prod"

$C ps                    # web should reach (healthy) within ~30s
$C logs migrate          # want: All migrations have been successfully applied.
$C logs caddy | tail     # want: certificate obtained successfully
curl -I https://tracker.example.com/login    # want: HTTP/2 200
```

Startup order is enforced: `db` must pass its healthcheck, then `migrate` must
exit 0, and only then do `web` and `worker` start. A failed migration therefore
stops the deploy instead of half-starting the app.

### 4. Lock it down — do not skip this

```bash
# create your account at https://tracker.example.com first, then:
sed -i 's/^SIGNUP_MODE=.*/SIGNUP_MODE="closed"/' .env.prod
$C up -d web
```

Until you do, anyone who finds the URL can register an account.

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

### Unraid

Two Unraid-specific things will bite you, both before the app even starts.

**1. Ports 80 and 443 belong to the Unraid webGUI.** Caddy cannot bind them
until you move the GUI or give Caddy its own IP. Pick one:

- *Move the webGUI* — Settings → Management Access, set HTTP to `8080` and
  HTTPS to `8443`. Simplest, but you access Unraid on a new port from then on.
- *Give Caddy its own IP* (usually nicer) — add to the `caddy` service and drop
  its `ports:` block entirely:

  ```yaml
      networks:
        br0:
          ipv4_address: 192.168.1.240   # a free IP outside your DHCP pool
  ```
  ```yaml
  networks:
    br0:
      external: true
  ```
  Then point your router's 80/443 forwards at that IP instead of the server's.
- *Already running SWAG or Nginx Proxy Manager?* Delete the `caddy` service, add
  `ports: ["3000:3000"]` to `web`, and reverse-proxy to it from what you have.

**2. Do not put the database on `/mnt/user/`.** That path is shfs, Unraid's FUSE
overlay across the array. Postgres needs the POSIX locking and honest `fsync`
that a FUSE layer doesn't reliably provide, and "database on /mnt/user" is a
well-known source of corruption. Use the direct pool path:

```ini
# in .env.prod — note /mnt/cache, NOT /mnt/user
PGDATA_VOLUME="/mnt/cache/appdata/price-tracker/pgdata"
CADDY_DATA_VOLUME="/mnt/cache/appdata/price-tracker/caddy-data"
CADDY_CONFIG_VOLUME="/mnt/cache/appdata/price-tracker/caddy-config"
APP_IMAGE="arcralius/price-tracker:0.3.0"
```

If your pool is named something else (Unraid 6.12+ allows this), use that name —
`/mnt/mypool/appdata/...`. Check with `ls /mnt/`.

Then make sure Mover can never relocate live database files: **Shares →
appdata → Primary storage: cache, Secondary storage: none.** If appdata is set
to move to the array, Mover will try to relocate files Postgres has open.

Setup:

```bash
mkdir -p /mnt/cache/appdata/price-tracker/{pgdata,caddy-data,caddy-config}
```

No `chown` needed — the Postgres image fixes ownership of its data directory on
startup. Unraid's usual `PUID`/`PGID` dance doesn't apply here either: only the
`db` container writes to a bind mount, and it manages that itself.

#### With Docker Compose Manager (recommended)

Use **`docker-compose.unraid.yml`**, not the prod one. It drops Caddy — so
nothing fights the Unraid webGUI for ports 80/443, and there's no `Caddyfile` to
place beside it — and publishes `web` on a port instead, ready for LAN access or
for SWAG / Nginx Proxy Manager to sit in front.

1. **Compose → ADD NEW STACK**, name it `price-tracker`.
2. Click the stack's cog → **Edit Stack → Compose File**. Paste the contents of
   [`docker-compose.unraid.yml`](docker-compose.unraid.yml). Save.
3. Cog → **Edit Stack → .env File**. Paste
   [`.env.unraid.example`](.env.unraid.example) and edit the two `CHANGE_ME`
   lines:

   ```bash
   openssl rand -hex 24   # POSTGRES_PASSWORD
   openssl rand -hex 32      # SESSION_SECRET
   ```

   Compose reads `.env` from the project directory automatically — the plugin
   passes no `--env-file`, which is why the file must be named exactly `.env`.
4. Create the data directory, using your actual pool name (`ls /mnt/`):

   ```bash
   mkdir -p /mnt/cache/appdata/price-tracker/pgdata
   ```
5. **COMPOSE UP**, then turn **AUTO START** on so it survives a reboot.
6. Open `http://<your-unraid-ip>:3000`, create your account, then set
   `SIGNUP_MODE=closed` in the .env file and hit Compose Up again.

Compose Up is safe to repeat: migrations run in their own service that exits
before the app starts, and reports `No pending migrations to apply.` when
there's nothing to do. That is also how you upgrade — bump `APP_IMAGE`, then
Update Stack followed by Compose Up.

`COOKIE_SECURE=false` is preset because you'll reach it over plain http at
first. Change it to `true` once HTTPS is terminated in front, or logins are
sent in cleartext.

To check on it:

```bash
cd /boot/config/plugins/compose.manager/projects/price-tracker
docker compose logs -f worker     # the daily scrape
docker compose ps                 # web should show (healthy)
```

#### Without Compose, using Docker → Add Container

Unraid's Add Container form builds one container, and this app needs three
(plus a one-off migration). It works, it's just manual. Do them in this order.

**First, a user-defined network** — on Unraid's default `bridge`, containers
cannot resolve each other by name, and these need to. From a terminal:

```bash
docker network create tracker-net
mkdir -p /mnt/cache/appdata/price-tracker/pgdata
```

`tracker-net` then appears in the Network Type dropdown. Pick it for all three.

**1. Database** — Add Container, Advanced View:

| Field | Value |
|---|---|
| Name | `tracker-db` |
| Repository | `postgres:16-alpine` |
| Network Type | `tracker-net` |
| Path | Container `/var/lib/postgresql/data` → Host `/mnt/cache/appdata/price-tracker/pgdata` |
| Variable | `POSTGRES_USER` = `tracker` |
| Variable | `POSTGRES_PASSWORD` = *(a password you choose)* |
| Variable | `POSTGRES_DB` = `tracker` |

No port mapping — nothing outside the Docker network should reach Postgres.

**2. Migrations** — a one-off, easiest from the terminal. Substitute your
password:

```bash
docker run --rm --network tracker-net \
  -e DATABASE_URL="postgresql://tracker:YOURPASSWORD@tracker-db:5432/tracker?schema=public" \
  arcralius/price-tracker:0.3.0 npx prisma migrate deploy
```

Expect `All migrations have been successfully applied.` Re-run this after
pulling a new image version; it is a no-op when nothing is pending.

**3. Web** — Add Container:

| Field | Value |
|---|---|
| Name | `price-tracker-web` |
| Repository | `arcralius/price-tracker:0.3.0` |
| Network Type | `tracker-net` |
| Port | Container `3000` → Host `3000` |
| WebUI | `http://[IP]:[PORT:3000]` |
| Post Arguments | `node server.js` |
| Variable | `DATABASE_URL` = `postgresql://tracker:YOURPASSWORD@tracker-db:5432/tracker?schema=public` |
| Variable | `SESSION_SECRET` = *(64 random hex chars)* |
| Variable | `COOKIE_SECURE` = `false` |
| Variable | `SIGNUP_MODE` = `open` (change to `closed` once your account exists) |
| Variable | `TZ` = `Asia/Singapore` |

`COOKIE_SECURE=false` matters here. Reached over plain `http://tower:3000`, the
session cookie is otherwise marked `Secure`, the browser drops it, and login
appears to succeed then returns you to the login page with no error. Set it back
to `true` (or remove it) the moment you put HTTPS in front.

**4. Worker** — same image, no ports. This is what does the daily scraping and
sends Telegram alerts; without it nothing is ever re-checked:

| Field | Value |
|---|---|
| Name | `price-tracker-worker` |
| Repository | `arcralius/price-tracker:0.3.0` |
| Network Type | `tracker-net` |
| Post Arguments | `npx tsx worker/index.ts` |
| Variable | `DATABASE_URL` = *(same as web)* |
| Variable | `TELEGRAM_BOT_TOKEN` = *(your token, or leave unset)* |
| Variable | `CHECK_CRON` = `0 9 * * *` |
| Variable | `TZ` = `Asia/Singapore` |

Check its log for `[worker] starting.` and, if you set a token,
`[worker] Telegram alerts enabled.`

Compose does all of the above from one file, including startup ordering and
restart policies, which is why it's the recommended route.

Back up `/mnt/cache/appdata/price-tracker/` with the Appdata Backup plugin, or
use the `pg_dump` cron below — the plugin copies files, which for a running
database is less trustworthy than a dump.

### Putting the database somewhere else

`PGDATA_VOLUME` in `.env.prod` decides where Postgres keeps its files. A bare
name is a Docker named volume; anything starting with `/` or `./` is a host path.

```bash
# 1. create the directory on a local disk
sudo mkdir -p /mnt/data/tracker/pgdata

# 2. point the stack at it
echo 'PGDATA_VOLUME=/mnt/data/tracker/pgdata' >> .env.prod

# 3. up as usual
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

No `chown` needed: the `postgres` image's entrypoint starts as root, fixes
ownership of the data directory itself (`fixing permissions on existing
directory ... ok`), then drops to the `postgres` user. You would only need
`sudo chown -R 999:999` on that directory if you added a `user:` override to the
`db` service, which this stack doesn't.

**Moving a database that already has data.** Changing `PGDATA_VOLUME` does not
migrate anything — Postgres would come up on an empty directory and initialise a
fresh database, and your history would still be sitting in the old volume,
invisible. Copy it across deliberately:

```bash
C="docker compose -f docker-compose.prod.yml --env-file .env.prod"

$C exec -T db pg_dump -U tracker tracker | gzip > pre-move.sql.gz   # safety net
$C down                                                            # stop writers
docker volume ls | grep pgdata                                     # find the old volume name

sudo mkdir -p /mnt/data/tracker/pgdata
docker run --rm \
  -v tracker_pgdata:/from \
  -v /mnt/data/tracker/pgdata:/to \
  alpine sh -c 'cp -a /from/. /to/'      # -a preserves ownership and modes

echo 'PGDATA_VOLUME=/mnt/data/tracker/pgdata' >> .env.prod
$C up -d
```

Substitute the real volume name from `docker volume ls` — Compose prefixes it
with the project name, which defaults to the directory name.

Verify before deleting the old volume:

```bash
$C exec -T db psql -U tracker -d tracker -c \
  'select count(*) as products, (select count(*) from "PricePoint") as points from "Product";'
```

**Do not put the data directory on NFS, SMB/CIFS, or a filesystem shared between
machines.** Postgres depends on POSIX locking and real `fsync` semantics that
network filesystems emulate loosely or not at all; the failure mode is silent
corruption discovered weeks later. Worse, if two hosts ever mount the same
directory and both start Postgres, they will destroy the database — the lock
that normally prevents this doesn't work reliably over NFS.

If the goal is for the data to survive the host or be reachable from elsewhere,
use a local disk (or an attached block volume — EBS, Hetzner Volume, iSCSI LUN,
anything that presents as a real block device) for `PGDATA_VOLUME`, and write
`pg_dump` backups to the network share instead:

```bash
$C exec -T db pg_dump -U tracker tracker | gzip > /mnt/share/tracker-$(date +%F).sql.gz
```

That gives you off-host durability without asking Postgres to run on storage it
can't trust. A nightly cron line does the job:

```
15 3 * * * cd /srv/tracker && docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T db pg_dump -U tracker tracker | gzip > /mnt/share/tracker-$(date +\%F).sql.gz
```

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

1. Message [@BotFather](https://t.me/BotFather), send `/newbot`, copy the token —
   it looks like `8123456789:AAHk9x_PqR3sTuVwXyZ...`.
2. Put it in your env file as `TELEGRAM_BOT_TOKEN`:

   ```ini
   # .env for local dev, .env.prod on a server — same variable name either way
   TELEGRAM_BOT_TOKEN="8123456789:AAHk9x_PqR3sTuVwXyZ..."
   ```

   Quote it: the token contains characters a shell would otherwise interpret.
   Never commit it — `.gitignore` already excludes `.env*` apart from the
   `.example` files.

3. Recreate the two services that read it. **Both** need it: `worker` sends the
   daily alerts and polls for account links, `web` renders the Settings page and
   the test-message button.

   ```bash
   C="docker compose -f docker-compose.prod.yml --env-file .env.prod"
   $C up -d web worker          # picks up the new value; db is untouched
   $C logs worker | grep -i telegram
   # want: [worker] Telegram alerts enabled.
   # not:  [worker] TELEGRAM_BOT_TOKEN not set — alerts disabled.
   ```

   Locally, just restart `npm run dev` and `npm run worker`.

4. Open **Settings** in the app and follow the link button. It opens your bot
   with a one-time code; pressing Start links your account. "Send test message"
   confirms the whole path.

The token is read from the environment at runtime only — it is never written to
the database, baked into the image, or sent to the browser.

Telegram doesn't let bots message people who haven't talked to them first, which is why the linking
step exists. The worker polls `getUpdates` once a minute to pick up new links; the Settings page also
has a "check now" button so you don't have to wait.

**When you get pinged.** Alerts are delivered on a schedule you set, not the
instant a price moves. In **Settings → Notification schedule** you choose the
times of day and the timezone; "how many times a day" is simply how many times
you list. Prices are refreshed just before each one, so the figure you're sent
is the one on the site now, and you get a single message per slot covering
everything that dropped.

Any item can override that from its own page — leave the field blank to follow
the account default. Setting an "alert me below" price means you only hear about
it once it's at or under that number; without one, any drop qualifies. A figure
already announced is never repeated, and the suppression clears if the price
climbs back above it.

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

### What won't work, and the browser fallback

Sites that build their price in JavaScript *and* expose no structured data or
JSON API can't be read from the raw HTML. Most retailers turn out not to be in
that group — they emit JSON-LD for Google's benefit, which is why the static
path covers so much.

For the ones that genuinely are, there's an optional headless browser. It only
runs after every static strategy has failed, so ordinary sites never pay for it:

```ini
# in your .env
COMPOSE_PROFILES=browser
BROWSER_WS_ENDPOINT=ws://browser:3000/
```

Then bring the stack up as usual. The `browser` service is a Playwright server
in its own container, on its own network with no route to `db` — it loads
arbitrary third-party pages, so it shouldn't be able to reach the database. The
image is ~2GB, which is why it's opt-in and why the app image doesn't bundle
Chromium.

It blocks images, fonts and media, waits for something price-shaped to appear
rather than sleeping a fixed time, and hands the rendered DOM back through the
same extractors. A render costs roughly 5-20s versus well under a second for
the static path.

Even this doesn't beat everything: sites behind Cloudflare's interactive
challenge, anything requiring a login, and most airline fares (which are
POST-driven searches with no stable URL to track) remain out of reach.

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
