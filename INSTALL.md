# Installing Stillwater

Stillwater is a self-hosted team wiki. There are two ways to run it.

## A. With Docker (recommended for a team server)

1. Copy `.env.example` to `.env` and set `POSTGRES_PASSWORD` and
   `SESSION_SECRET` (`openssl rand -hex 32`). Set `PUBLIC_URL` to the address
   people will use.
2. Run `docker compose up -d`.
3. Open `http://localhost:3000` (or your `PORT`). The first person to sign up
   becomes the admin.

The app waits for Postgres, runs its migrations, then starts. Data lives in
the `stillwater_db` and `stillwater_uploads` volumes.

## B. Without Docker (install.sh)

Needs Node.js 22 or newer and npm. Nothing else: a local Postgres is
downloaded as an npm package and started for you.

```sh
PORT=3000 ./install.sh
```

This, in the foreground:

1. installs the packages (`npm ci`),
2. builds the web app and the server (`npm run build`),
3. starts Postgres on a free local port, with its data in `.local-data/pg`,
4. runs the migrations and serves the site on `http://127.0.0.1:$PORT`
   (port 3000 if `PORT` is not set).

Stop it with Ctrl+C; your pages stay in `.local-data/` for the next start.
Uploaded files go to `.local-data/uploads`.

Optional settings for this mode (environment variables):

- `HOST`: the address to listen on (default `127.0.0.1`; `0.0.0.0` to let
  other machines reach it).
- `DATABASE_URL`: use an existing Postgres instead of the local one.
- `PUBLIC_URL`, `ALLOW_SIGNUP`, `MAX_UPLOAD_MB`, `TRASH_RETENTION_DAYS`,
  `AI_PROVIDER`, `ANTHROPIC_API_KEY`, `AI_MODEL`: same meaning as in
  `.env.example`.

## Trash

Deleting a page or a space moves it to the trash, with its sub-pages, history,
comments and files. Editors can restore it from the space's Trash view; space
admins can delete it for good. Anything left in the trash is deleted for good,
files included, `TRASH_RETENTION_DAYS` days after it was deleted (default 30;
`0` = never, so only emptying the trash by hand removes it). The server checks
once at start and then every hour. A value that is not a whole number of days,
0 or more, stops the server with a message saying so.

## Export

Anyone who can read a page can download it, alone or with its sub-pages, as
Markdown (a `.md` file, or a `.zip` with its files) or as a PDF. Nothing needs
setting up: the PDF is made on the server with fonts shipped inside the app,
and nothing is fetched from the internet. One export holds at most 200 pages
and 100 MB of files. The PDF font covers Latin, Greek and Cyrillic; other
scripts (for example Chinese or Japanese) show as blank boxes for now.

## AI features

Set `ANTHROPIC_API_KEY` (in `.env`, or in the environment for install.sh).
Without a key the AI buttons stay hidden.

## Backup and restore

- Docker: `docker compose exec db pg_dump -U stillwater stillwater > backup.sql`,
  plus a copy of the `stillwater_uploads` volume. Restore with
  `docker compose exec -T db psql -U stillwater stillwater < backup.sql`.
- install.sh: stop the app and copy the whole `.local-data/` folder.
