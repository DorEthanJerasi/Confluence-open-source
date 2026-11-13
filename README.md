# Stillwater

<!-- mind:showcase:start -->
<!-- capture 20261113T002433Z -->
[![Test5 in use, click for the full video](docs/showcase/preview.gif)](docs/showcase/showcase.mp4)

Showcase recorded 2026-11-13. Click the preview to watch the full video.
<!-- mind:showcase:end -->

A calm, self-hosted team wiki. Make spaces, nest pages inside pages, and
write in a block editor. Find anything with search, go back to any earlier
version, and ask the AI about your own pages. It works in light and dark
mode, with plenty of space and quiet motion.

## What it does

- **Accounts and roles.** People sign up and log in. Admin, editor and
  viewer roles, plus per-space permissions. The first person to sign up
  becomes the admin.
- **Spaces and nested pages.** Each space holds a tree of pages.
- **Block editor.** Type `/` for commands: headings, lists, tables, code
  blocks, images, files, video and link previews.
- **Search.** Full-text search over every page you are allowed to see.
- **Page history.** Earlier versions of each page are kept (quick
  back-to-back saves by one person are folded into one version). Any of them
  can be previewed and restored, and a restore never deletes history.
- **AI help (optional).** Summarise a page, or ask a question and get an
  answer from your team's pages with links to the sources. It turns on when
  whoever hosts the wiki sets an `ANTHROPIC_API_KEY`. Without a key the AI
  buttons stay hidden.
- **Ready for co-editing later.** Pages are stored as editor JSON in a shape
  that real-time co-editing can take over without a rewrite.

## Install

You can run it with Docker or with the install script. Full steps, settings,
backup and restore are in [INSTALL.md](INSTALL.md).

### With Docker (app + Postgres)

```sh
cp .env.example .env      # set POSTGRES_PASSWORD and SESSION_SECRET
docker compose up -d
```

Open <http://localhost:3000>.

### Without Docker: `install.sh`

Needs Node.js 22 or newer. A local Postgres is downloaded and started for you.

```sh
PORT=3000 ./install.sh
```

[install.sh](install.sh) installs the packages, builds the app, starts
Postgres with its data in `.local-data/`, runs the migrations and serves the
site in the foreground on `http://127.0.0.1:$PORT`. Stop it with Ctrl+C.

## Settings

All settings are environment variables. See [.env.example](.env.example):
`PORT`, `POSTGRES_PASSWORD`, `SESSION_SECRET`, `PUBLIC_URL`, `ALLOW_SIGNUP`,
`MAX_UPLOAD_MB`, `AI_PROVIDER`, `ANTHROPIC_API_KEY`, `AI_MODEL`.

## For developers

```sh
npm ci
npm run dev        # server and web app in watch mode
npm run check      # typecheck, unit tests, originality and contrast checks
npm run test:ai    # AI tests, against a stub (no key, no cost)
npm run test:e2e   # browser tests (Playwright)
scripts/smoke.sh   # starts the real docker compose stack and checks it
```

How it is built (monorepo layout, editor and document model, storage,
permissions, AI design): [ARCHITECTURE.md](ARCHITECTURE.md).
The look and motion rules: [DESIGN.md](DESIGN.md).
