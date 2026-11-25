# agave — a unified-API connector for Fieldwire

Fieldwire (Hilti) is widely used on commercial jobs and **Agave does not integrate with
it**. Its API is the gated kind: available only on an Enterprise contract, or added to a
Pro/Business plan "in conjunction with our sales team." Meanwhile anyone can open a free
account in two minutes.

So the integration surface is the web app. This is a connector that signs in as the
customer, reads what the customer can already see, and serves it in Agave's shape.

```
Fieldwire web app  →  Stagehand (browser)  →  Playwright (deterministic)  →  Agave-style JSON
```

## Why no agent

The flow is fixed every run: sign in, open the project list, open four tabs per project.
Nothing about that needs a model to decide, and a model in the loop would make it slower,
costlier, and non-reproducible. Stagehand launches and manages the browser — local
Chromium or a Browserbase session — and plain Playwright drives it. **No LLM is called
anywhere in this repo.**

The extraction does not scrape the DOM either. Driving the UI makes Fieldwire's own web
client call its private JSON API, and `NetworkCapture` reads those responses. Layout
changes don't break it; only an API change does.

## Resources

Mapped into Agave's conventions — opaque `id`, native `source_id`, `source_create_time` /
`source_update_time`, and `source_data: { path, data }` carrying the untouched upstream row.

| Unified resource | Fieldwire source |
| --- | --- |
| `projects` | projects |
| `tasks` | tasks (punch items, issues, to-dos) |
| `drawings` | sheets / plans |
| `project_users` | project members, with role and company |
| `files` | files, photos, attachments |

## Run it

```bash
npm install
cp .env.example .env      # add FIELDWIRE_EMAIL / FIELDWIRE_PASSWORD

npm run fixtures          # normalizers over recorded payloads — no network
npm run login             # sign in once, cache the session to .auth/
npm run discover          # map the private endpoints behind each screen
npm run sync              # pull every resource -> out/*.json
npm run serve             # read-only Agave-style REST API on :8787
```

Local Chromium is the default. Add `--remote` (with Browserbase keys in `.env`) to run the
same code on a Browserbase session:

```bash
npm run sync -- --remote
```

### Cost controls

- Local Chromium unless `--remote` is passed explicitly, so keys in `.env` cost nothing.
- Every session is capped at **5 minutes** — Browserbase's own `api_timeout` plus a local
  watchdog, and teardown runs in a `finally`.
- `sync` stops early and records a warning rather than overrunning the budget.
- The login is cached to `.auth/`, so repeat runs skip the form. Set `BROWSERBASE_CONTEXT_ID`
  to persist it remotely too.

## Serving it

```
GET /                      inventory and counts
GET /tasks                 { data: [...], next_page: null }
GET /tasks?project_id=...  filtered
```

Same envelope and field conventions as Agave's other connectors, so a consumer written
against their Procore integration needs no new code path.

## Layout

```
src/browser/session.ts   Stagehand launch + Playwright over CDP + the 5-minute budget
src/browser/auth.ts      sign-in, cached to .auth/
src/browser/capture.ts   records the SPA's private JSON API traffic
src/fieldwire/extract.ts one row per resource: which route to visit, which call to read
src/unified/types.ts     the Agave-style models
src/unified/normalize.ts Fieldwire payloads -> unified models
src/pipeline.ts          live sync and fixture replay
src/server.ts            read-only REST over the last sync
```

## Status

Normalizers and the fixture path are verified end to end. The live path is written against
Fieldwire's real routes; field names in `normalize.ts` accept several candidate keys per
field and `discover` prints the actual payload keys, so the first live run confirms or
corrects the mapping rather than guessing silently.
