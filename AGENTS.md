# AGENTS.md

## Project

VTEX IO Grafana Datasource is a **frontend-only Grafana data source plugin** that exposes VTEX IO Observability (logs + metrics) as Grafana panels. It has no backend binary: queries flow from React UI → `DataSource.query()` → `O11yApi` client → Grafana data-source proxy → VTEX Observability API.

Stack: TypeScript 5.5, React 18, Grafana SDK 11.5.x (`@grafana/data`/`ui`/`runtime`/`schema`), Webpack 5, Node.js ≥22, npm 10.9.2. Tests: Jest (unit) + Playwright (E2E) against a Docker Grafana.

Canonical reference for invariants, technical decisions, and data ownership: `PROJECT.md`.

## Commands

```bash
# Install
npm install

# Dev build (watch mode)
npm run dev

# Production build
npm run build

# Spin up Grafana (Docker) with the plugin mounted from ./dist
npm run server                    # uses default GRAFANA_VERSION=11.5.3
GRAFANA_VERSION=11.3.0 npm run server

# Unit tests (Jest)
npm run test                      # watch + only-changed
npm run test:ci                   # CI mode, --maxWorkers 4
npm run test:single -- <pattern>  # single run, supports name filter

# E2E tests (Playwright; requires `npm run server` running)
npm run e2e
npm run e2e:ui                    # interactive UI
npm run e2e:debug                 # step debugger
npm run e2e:headed                # visible browser
npm run e2e:report                # open last HTML report

# Lint / typecheck
npm run lint
npm run lint:fix                  # eslint --fix + prettier --write
npm run typecheck                 # tsc --noEmit

# Release (see Makefile for full list)
make release-beta                 # bump prerelease, commit, tag, push
make release-beta BUMP=minor      # new minor beta base
make release-stable               # patch by default; BUMP=major|minor|patch
make download-zip                 # download release artifact via gh
```

## Conventions

- Strict TypeScript (`@grafana/tsconfig`); no `any` unless unavoidable and commented.
- React **functional components + hooks**; PascalCase components, camelCase functions/vars, UPPER_SNAKE_CASE for enums and module-level constants.
- File layout: components in `src/components/`, API clients in `src/clients/`, shared types in `src/types.ts`, datasource logic in `src/datasource.ts`, plugin registration in `src/module.ts`, route definitions in `src/plugin.json`.
- Imports: standard libs / third-party first, then `@grafana/*`, then relative.
- Prettier: single quotes, semicolons, 2-space tabs, `printWidth: 120`, `trailingComma: 'es5'`.
- ESLint enforces `@grafana/eslint-config` plus `deprecation/deprecation` (warn) on `src/**`.
- Do **not** edit files under `.config/` (scaffolded by `@grafana/create-plugin`); extend via the project-root configs (`.eslintrc`, `.prettierrc.js`, `jest.config.js`, `tsconfig.json`).
- All API calls go through `O11yApi` (which uses `getBackendSrv().fetch`). Never call VTEX endpoints directly from React.

## Testing

- **Unit (Jest + jsdom):** files in `src/**/__tests__/*.test.ts(x)` and `tests/unit/**/*.test.ts(x)`. Use `@testing-library/react` for components; mock `O11yApi` for datasource tests.
- **E2E (Playwright):** files in `tests/e2e/*.spec.ts` (Jest tests are excluded by `testMatch: /.*\.spec\.ts/`). Auth state is captured by the `auth` project and reused by `chromium`.
- Timezone is forced to UTC in `jest.config.js` — keep snapshots and time-based assertions UTC.
- Async assertions use `await expect(...).toPass()` / Playwright auto-waits — never `setTimeout` / `Thread.Sleep`.
- E2E requires `npm run server` first; default base URL is `http://localhost:3000` (override with `GRAFANA_URL`).
- Per-target query errors must be returned in `errors[]` (not thrown) so other refIds still render — tests for `datasource.query` should assert this contract.

## Architecture boundaries

```
QueryEditor / ConfigEditor (React)
        ↓
   DataSource.query()        ← src/datasource.ts (DataFrame builders live here)
        ↓
   O11yApi (clients)         ← src/clients/o11yApi.ts (request shape + proxy paths)
        ↓
  Grafana Data Source Proxy  ← routes in src/plugin.json (local | remote)
        ↓
  VTEX Observability API
```

- `O11yApi` knows nothing about React or Grafana panels — only `tenant`, proxy base URL, and request payloads.
- DataFrame construction (logs, time series, latency tables, percentile graphs) lives **only** in `datasource.ts`. Plugin-side quantile math lives in `src/utils/histogramQuantiles.ts`.
- Tenant is owned by `ConfigEditor` (extracted from App Key into `jsonData.tenant`); App Token lives in `secureJsonData` and is never read by React code.
- Query shape (`queryType`, `appName`, `predefinedMetric`, `filters`, `pageSize`) is owned by `QueryEditor` + defaults in `src/types.ts`.

## Proxy routes (plugin.json)

Two prefixes — `local` (Docker, `host.docker.internal:8080`) and `remote` (`https://{tenant}.vtexcommercebeta.com.br/api/extensions/observability`). `ProductionO11yApiClient` uses `remote`. All routes inject `X-VTEX-API-AppKey` and `X-VTEX-API-AppToken` headers from datasource config.

| Proxy path                     | Used by                                  |
|--------------------------------|------------------------------------------|
| `{prefix}/apps`                | App dropdowns in `QueryEditor`           |
| `{prefix}/logs/fields`         | `testDatasource()` and logs metadata     |
| `{prefix}/logs/query`          | Logs queries (`O11yApi.FetchLogs`)       |
| `{prefix}/metrics/fields`      | Metrics metadata                         |
| `{prefix}/metrics/query`       | Metrics queries (`O11yApi.FetchMetrics`) |
| `{prefix}/metrics/names`       | Legacy metric name listing               |

Route `path` strings in `plugin.json` must match the prefixes used in `O11yApiClient` exactly.

## Safety

- Never commit `appToken`, `appKey`, or any tenant credentials. They belong only in Grafana datasource config (`secureJsonData` / `jsonData`).
- Never bypass the Grafana proxy with a direct `fetch`/`axios` call to VTEX — it leaks tokens to the browser and breaks CORS in prod.
- Do not modify scaffolded files unless explicitly asked: `.config/**`, `Dockerfile`, `docker-compose*.yaml`, `.github/workflows/**`.
- Do not change `src/plugin.json` `id`, `routes` paths, or signature-affecting fields without coordinating a release.
- Do not force-push or rewrite history on `main`; releases go through `make release-*` which tags off the current commit.
- Bumping versions is done **only** via `make bump-*` / `make release-*` (keeps `package.json` and `package-lock.json` in sync and tags consistently).
