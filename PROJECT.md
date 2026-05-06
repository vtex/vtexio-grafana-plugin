# PROJECT.md — Technical Decisions, Invariants & Feature Summary

> Canonical reference for agents. Read this file for architecture invariants, technical decisions, and feature scope before implementing.

---

## 1. Feature Summary

### Metrics (Predefined Types)
- **Query type:** Metrics — user selects app and a predefined metric type.
- **Request Rate per Account:** Total request count over time, grouped by account; backend metric `runtime_http_requests_total`.
- **Request Rate per Status per Account:** Request count by HTTP status code and account; same backend metric, grouped by `account` + `status_code`.
- **Error Rate by Handler:** Error rate over time by app/handler (`ERROR_RATE_BY_HANDLER`); computed as `(error_count / total_requests) * 100` for status ≥ 400.
- **Latency Stats per Account and Handler:** **Table** with one row per (account, handler) and columns account, handler, p50, p95, p99 (ms) (`LATENCY_STATS_BY_ACCOUNT_AND_HANDLER`). Uses `runtime_http_requests_duration_milliseconds` (histogram). The API returns histogram bucket data (ExplicitBounds, BucketCounts) per (time, account, handler); quantile computation is done in the plugin (including +Inf bucket handling when BucketCounts has length bounds.length + 1). Data is aggregated over time so each row shows percentiles for that account+handler.
- **Latency Stats per Account:** **Table** with one row per account and columns account, p50, p95, p99 (ms) (`LATENCY_STATS_PER_ACCOUNT`). Uses the same histogram metric; API returns bucket data grouped by account only (no handler). Quantile computation in the plugin via `createLatencyStatsPerAccountTableDataFrame`.
- **2xx Latency P50 / P90 / P99 per Handler:** **Graph** (time series) with one line per handler; X = timestamp, Y = percentile (ms). `LATENCY_P50_PER_HANDLER`, `LATENCY_P90_PER_HANDLER`, `LATENCY_P99_PER_HANDLER`. Same API as latency stats by account and handler (histogram, group_by time+account+handler); plugin aggregates by (time, handler), computes the single quantile per (time, handler), and builds a graph DataFrame with legend `"p50 | {{handler}}"` (or p90/p99). `createLatencyPercentileByHandlerGraphDataFrame`.
- No free-form metric name input; all metrics use predefined types only.

### Logs
- **Query type:** Logs — user selects app, optional page size (default 100).
- Logs API returns Grafana DataFrame format; plugin builds logs DataFrame with `timestamp`, `body`, attribute fields, and `labels`.
- Filterable fields in log details: **account**, **workspace**, **level** only (Grafana ADD_FILTER / ADD_FILTER_OUT).
- Dashboard/Explore filters passed via `query.filters` and merged with base filters (app, time range) when calling the API.

### Data Source Configuration
- **App Key** (jsonData) — VTEX app key; tenant extracted from key pattern for API routing.
- **App Token** (secureJsonData) — never sent to frontend; used only in backend proxy requests.
- **Test datasource:** Validates tenant and connectivity via `FetchLogsFields()`.

### API & Routing
- All requests go through **Grafana Data Source Proxy**; routes defined in `plugin.json` (local vs remote).
- **Remote:** `https://{tenant}.vtexcommercebeta.com.br/api/extensions/observability/...`
- Endpoints: `/apps`, `/logs/fields`, `/logs/query`, `/metrics/fields`, `/metrics/query`.

---

## 2. Technical Decisions

### Architecture
- **Stack:** TypeScript 5.5, React 18, Grafana SDK (@grafana/data, @grafana/ui, @grafana/runtime, @grafana/schema v11.5.x), Webpack 5.
- **Runtime:** Node.js ≥22; npm 10.9.2.
- **Flow:** Grafana UI → QueryEditor/ConfigEditor → DataSource.query() → O11yApi (getBackendSrv().fetch) → plugin proxy routes → VTEX Observability API.
- **No backend binary:** Plugin is frontend-only; backend is Grafana’s proxy + VTEX APIs.

### Datasource & API Client
- **DataSource** holds a single **O11yApi** instance: `ProductionO11yApiClient(tenant, instanceSettings.url)` (url = Grafana proxy base).
- **O11yApiClient** uses path prefix `local` or `remote` to pick proxy path; `ProductionO11yApiClient` uses `remote`.
- **Proxy paths** (e.g. `remote/apps`, `remote/logs/query`) must match `plugin.json` route `path` values exactly.
- **API timeout:** 30 seconds (`API_REQUEST_TIMEOUT_MS`); user-facing timeout message in `extractErrorMessage`.

### Metrics
- **Predefined only:** `PredefinedMetricType.REQUEST_RATE`, `ERROR_RATE_BY_HANDLER`, `LATENCY_STATS_BY_ACCOUNT_AND_HANDLER`, `LATENCY_STATS_PER_ACCOUNT`, `LATENCY_P50_PER_HANDLER`, `LATENCY_P90_PER_HANDLER`, `LATENCY_P99_PER_HANDLER`; no custom metric names.
- **Backend metric:** Request-count metrics use `runtime_http_requests_total`; latency stats use `runtime_http_requests_duration_milliseconds` (histogram). Filters applied in `buildFetchFilters`.
- **Columns:** Built in `buildMetricsColumns(predefinedMetric)` — e.g. sum aggregation for REQUEST_RATE; error_rate expression for ERROR_RATE_BY_HANDLER; account, handler, ExplicitBounds, BucketCounts for LATENCY_STATS_BY_ACCOUNT_AND_HANDLER and for P50/P90/P99 per handler; account, ExplicitBounds, BucketCounts (no handler) for LATENCY_STATS_PER_ACCOUNT.
- **Time series DataFrame:** One value field per series (account or account+status_code); time field from `O11Y_API_TIMESTAMP_COLUMN`; labels for account, metric, app, optional status_code. Latency P50/P90/P99 per handler use `createLatencyPercentileByHandlerGraphDataFrame`: one line per handler, displayName `"p50 | {{handler}}"` (or p90/p99), unit ms, `preferredVisualisationType: 'graph'`.
- **Table DataFrame:** Latency stats by account+handler use `createLatencyStatsTableDataFrame` with `preferredVisualisationType: 'table'`; columns account, handler, p50, p95, p99 (ms), one row per (account, handler). Latency stats per account use `createLatencyStatsPerAccountTableDataFrame`; columns account, p50, p95, p99 (ms), one row per account. Grafana may use this hint to suggest Table when creating a new panel or in Explore; for an existing panel, users may need to select Table from the visualization picker if it does not switch automatically.

### Logs
- **Logs DataFrame:** Requires time field (`TimestampTime` or `Timestamp`); `body` from `data`/`message`/`body`; meta `DataFrameType.LogLines`, `preferredVisualisationType: 'logs'`.
- **Filterable:** Only `account`, `workspace`, `level` get `config.filterable = true` for log details filter actions.
- **modifyQuery:** Handles ADD_FILTER and ADD_FILTER_OUT; updates `query.filters` by column; preserves filters in subsequent query runs.

### Errors & Validation
- **Per-target errors:** Failed targets push to `errors[]` with refId and message; other targets still return DataFrames.
- **User-facing messages:** `extractErrorMessage()` handles isFetchError, timeouts, and parsed API error payloads.
- **Missing app/predefined metric:** Returns empty DataFrame (no throw); console logging for debugging (to be removed post-beta).

### Infrastructure & Deployment
- **Build:** Webpack (`.config/webpack/`); output to `dist/`.
- **E2E:** Playwright; Grafana via Docker Compose (`.config/docker-compose-base.yaml`, `Dockerfile`).
- **CI:** GitHub Actions (build, typecheck, lint, unit tests, E2E); plugin version from `src/plugin.json`; beta deployment via VTEX pipeline and Argo CD to VTEX Grafana Beta.

---

## 3. Invariants — Non-Negotiable Rules

### Data Ownership & Flow
| Concern | Owner |
|--------|--------|
| Query shape (queryType, appName, predefinedMetric, filters, pageSize) | QueryEditor + defaults in types |
| API request building (filters, columns, body) | `clients/o11yApi.ts` |
| DataFrame construction (metrics vs logs) | `datasource.ts` (createTimeSeriesDataFrame, createErrorRateByHandlerDataFrame, createLatencyPercentileByHandlerGraphDataFrame, createLatencyStatsTableDataFrame, createLatencyStatsPerAccountTableDataFrame, createLogsDataFrame) |
| Proxy URL and route path | Grafana + plugin.json routes |
| Tenant | ConfigEditor (from App Key) + jsonData.tenant |

### Domain Invariants
- **Metrics:** `appName` and `predefinedMetric` are required; missing either yields empty DataFrame, no API call.
- **Logs:** `appName` is required; missing yields empty DataFrame.
- **Logs DataFrame:** Must have a time field; if none found, throw (no silent fallback).
- **Filterable log fields:** Only `account`, `workspace`, `level` are filterable — no other fields get filter icons in log details.
- **modifyQuery:** Only ADD_FILTER and ADD_FILTER_OUT are handled; filters are keyed by column (and operator for conflict resolution).

### Process Invariants
- All API calls go through **Grafana backend proxy** (getBackendSrv().fetch); no direct browser-to-VTEX calls from the plugin.
- **O11yApi** does not depend on React or QueryEditor; it only needs tenant, proxy URL, and request payloads.
- **Heavy logging** (FIXME in code): Verbose request/response and debug logs are temporary for beta; remove or gate before release.
- **Test datasource** uses a lightweight call (FetchLogsFields); no heavy queries.
- **Fail fast:** If tenant is missing, testDatasource returns error; query path validates required fields and returns empty DataFrame or throws as above.

### Compatibility
- **Grafana:** >= 10.4.0 (plugin.json).
- **Breaking change (documented):** Dynamic metric selection was removed; only predefined metric types are supported.

---

## 4. Data Model

No server-side database. All state is query/config and API responses.

### Query & Config Types (src/types.ts)
- **AppQuery:** queryType (logs | metrics), filters, orders, pageSize, predefinedMetric?, appName?, metricType?, refId.
- **VTEXIODataSourceOptions:** appKey, tenant? (DataSourceJsonData).
- **VTEXIOSecureJsonData:** appToken (never sent to frontend).
- **QueryFilter:** column, operator, type, value.
- **O11yQueryRequest:** page, pageSize, filters, orders, columns?, group_by?.
- **O11yQueryResponse:** refId, name, fields (GrafanaField[]), meta?.
- **GrafanaField:** name, type, values, labels?.
- **AppsResponse:** LogsApps[], MetricsApps[].

### Enums
- **QueryType:** logs | metrics.
- **PredefinedMetricType:** REQUEST_RATE | ERROR_RATE_BY_HANDLER | LATENCY_STATS_BY_ACCOUNT_AND_HANDLER | LATENCY_STATS_PER_ACCOUNT | LATENCY_P50_PER_HANDLER | LATENCY_P90_PER_HANDLER | LATENCY_P99_PER_HANDLER.
- **MetricType:** gauge | sum | counter | histogram (legacy/default: sum).

### Constants
- **O11Y_API_TIMESTAMP_COLUMN:** `'TimestampTime'`.
- **API_REQUEST_TIMEOUT_MS:** 30000.
- **DEFAULT_QUERY:** queryType logs, filters [], orders TimestampTime desc, pageSize 100.

---

## 5. Project Structure

```
vtexio-grafana-plugin/
├── src/
│   ├── module.ts              # DataSourcePlugin registration, ConfigEditor, QueryEditor
│   ├── datasource.ts         # DataSource class: query(), getApps(), modifyQuery(), testDatasource(), DataFrame builders
│   ├── types.ts              # AppQuery, options, API request/response, enums
│   ├── plugin.json           # Plugin id, routes (local/remote), dependencies
│   ├── utils/
│   │   └── histogramQuantiles.ts  # computeHistogramQuantiles for latency stats (plugin-side quantile from buckets)
│   ├── clients/
│   │   └── o11yApi.ts        # O11yApi, O11yApiClient, ProductionO11yApiClient; ListApps, FetchLogs, FetchMetrics, request()
│   └── components/
│       ├── QueryEditor.tsx   # Query type, app, predefined metric, page size; runs query
│       ├── ConfigEditor.tsx  # App Key, App Token, tenant extraction
│       ├── utils.ts          # e.g. extractTenantFromAppKey
│       └── __tests__/        # Unit tests (e.g. utils.test.ts)
├── tests/
│   └── e2e/                  # Playwright E2E (queryEditor.spec.ts, queryEditor.api.spec.ts, fixtures)
├── .config/
│   ├── webpack/              # Webpack config
│   ├── Dockerfile            # Grafana + plugin for E2E
│   └── docker-compose-base.yaml
├── .github/workflows/
│   └── ci.yml                # Build, lint, typecheck, unit tests, E2E
├── AGENTS.md                 # Instructions for AI agents working in this repo
├── README.md                 # User-facing plugin docs
└── PROJECT.md                # This file
```
