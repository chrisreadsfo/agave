# agave — a Fieldwire connector that drives the web app

Fieldwire (Hilti) is widely used on commercial jobs and **Agave does not integrate with
it**. Its API is the gated kind: Enterprise only, or added to a Pro/Business plan "in
conjunction with our sales team." Anyone can open a free account in two minutes.

So the integration surface is the UI. This signs in as the customer and clicks exactly
where they click. One file, top to bottom: `agave.ts`.

## Run

```bash
npm install
npx playwright install chromium
cp .env.example .env     # FIELDWIRE_EMAIL / FIELDWIRE_PASSWORD

npm run local                              # headful Chromium here
npm run local -- --message "Hi Dave"       # ...and post on the first task of mine
npm run local -- --headless                # no window
npm run cloud                              # the same run on a Browserbase session
```

`--project "Sample project - CRE"` picks a project by name; otherwise the first card.

## What it does

1. Stagehand launches the browser; Playwright drives it over CDP, in the tab already open.
2. Signs in (Fieldwire gates the password behind a Continue step while it checks for SSO).
3. Clicks into the project, then the Tasks tab, then the **My tasks** filter.
4. Reads the task names the customer sees.
5. Types a message on the first one and clicks submit.

No LLM, no agent. Every step is a fixed Playwright call, so runs are reproducible and cost
nothing but browser time.

## Things the live site taught us

- Project pages are `app.fieldwire.com/projects/<id>/...`; only the account-level pages
  are under `/index/`.
- The DOM has stable `data-e2e` hooks — `task-name-ontaskpage`,
  `sidebar-my-tasks-filter`, `task-edit-bubble-submit-button` — so no CSS-class guessing.
- Fieldwire calls task comments **bubbles**. Enter inserts a newline, so the submit button
  has to be clicked; `POST .../bubbles -> 201` is the proof it landed.
- A free plan interrupts with an upsell modal whose backdrop silently eats clicks. It has
  to be closed by its **Close** button; Escape alone doesn't always clear it.
- The activity panel scrolls itself as images load and fights Playwright's
  scroll-into-view, so smooth scrolling is disabled before typing.

## Cost controls

Local Chromium unless you run `cloud`. Browserbase sessions are created with
`api_timeout: 300` and `keepAlive: false`, with a local watchdog as a second ceiling.
