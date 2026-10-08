# VTEX IO Grafana Datasource

## What are Grafana data source plugins?

Grafana supports a wide range of data sources, including Prometheus, MySQL, and even Datadog. There's a good chance you can already visualize metrics from the systems you have set up. In some cases, though, you already have an in-house metrics solution that you'd like to add to your Grafana dashboards. Grafana Data Source Plugins enables integrating such solutions with Grafana.

## Requirements

- Grafana >= 10.4.0
- A VTEX account
- The VTEX IO apps you want to monitor must be running on builder-node 7.x

## Installation

The VTEX IO Grafana Datasource plugin is currently in **Closed Beta** and distributed as a signed zip file attached to each [GitHub Release](https://github.com/vtex/vtexio-grafana-plugin/releases). Since it isn't published on the official Grafana plugin catalog yet, it must be installed manually.

For the full step-by-step guide — downloading the plugin, installing it on Linux/macOS/Windows/Docker, and configuring the datasource with your VTEX App Key and Token — see [`docs/PLUGIN_SETUP_CLOSED_BETA.md`](https://github.com/vtex/vtexio-grafana-plugin/blob/main/docs/PLUGIN_SETUP_CLOSED_BETA.md).

Once the plugin is listed in the Grafana catalog:

1. In Grafana, go to the **Plugins** section and search for **VTEX IO**.
2. Click **Install plugin**.
3. With the plugin installed, click **Add new data source**.
4. Fill in the fields with your VTEX account data:
   - **App Key**: your VTEX API app key
   - **Account**: your VTEX account name (lowercase letters and numbers only)
   - **App Token**: your VTEX API app token
5. Click **Save & test**.

## Using the Plugin

### Querying Metrics

The VTEX IO Grafana datasource provides predefined metric types for easy observability of your VTEX IO applications:

1. **Select Query Type**: Choose "Metrics" from the query type dropdown
2. **Select App Name**: Choose the VTEX IO app you want to monitor
3. **Select Metric Type**: Choose from the predefined metrics:
   - **Request Rate per Account**: Total number of requests over time, grouped by account
   - **Error Rate per Handler**: Error rate over time, grouped by app and handler
   - **Latency Stats per Account and Handler**: Latency percentiles (p50, p95, p99 in ms) per account and handler in a **table**
   - **Latency Stats per Account**: Latency percentiles per account
   - **2xx Latency P50 per Handler**: Median latency of successful (2xx) requests per handler
   - **2xx Latency P90 per Handler**: P90 latency of successful (2xx) requests per handler
   - **2xx Latency P99 per Handler**: P99 latency of successful (2xx) requests per handler

#### Supported Metrics

Request and error rates use `runtime_http_requests_total`; every latency metric uses the `runtime_http_requests_duration_milliseconds` histogram.

| Metric Type | Description | Grouping | Backend Metric |
|-------------|-------------|----------|----------------|
| Request Rate per Account | Total requests over time | By account | `runtime_http_requests_total` |
| Error Rate per Handler | Error rate over time | By app + handler | `runtime_http_requests_total` |
| Latency Stats per Account and Handler | Latency percentiles (p50, p95, p99) | By account + handler (table) | `runtime_http_requests_duration_milliseconds` |
| Latency Stats per Account | Latency percentiles (p50, p95, p99) | By account | `runtime_http_requests_duration_milliseconds` |
| 2xx Latency P50 per Handler | Median latency of 2xx requests | By handler | `runtime_http_requests_duration_milliseconds` |
| 2xx Latency P90 per Handler | P90 latency of 2xx requests | By handler | `runtime_http_requests_duration_milliseconds` |
| 2xx Latency P99 per Handler | P99 latency of 2xx requests | By handler | `runtime_http_requests_duration_milliseconds` |

**Latency Stats — table visualization:** Results for "Latency Stats per Account and Handler" are intended to be viewed as a **Table** (columns: account, handler, p50, p95, p99 in ms). The plugin signals this to Grafana via the response metadata. When you add a new panel and run a Latency Stats query, Grafana will often suggest or default to the Table visualization. In **Explore** or when changing an existing panel’s query to Latency Stats, if the view does not switch to Table automatically, choose **Table** from the visualization picker (panel options).

### Querying Logs

1. **Select Query Type**: Choose "Logs" from the query type dropdown
2. **Select App Name**: Choose the VTEX IO app whose logs you want to view
3. **Configure Page Size**: Adjust the number of log entries to retrieve (default: 100)

## Client identification

Every request the plugin makes to the VTEX Observability API (dashboard queries, alert-rule evaluations, health checks, and the autocomplete/field calls) carries two static identification headers so VTEX can tell plugin traffic from direct API calls:

| Header | Value |
|--------|-------|
| `User-Agent` | `vtexio-grafana-datasource/<plugin version>` (`dev` for local builds without a version) |
| `X-VTEX-Client` | `vtexio-grafana-datasource` |

Both are fixed values built from the plugin ID and version. **No usage telemetry is collected**: nothing about the user, your Grafana instance, dashboards, or queries is added beyond these two static headers. The existing `X-Grafana-From-Alert` header (alert rule evaluations) and the App Key/App Token authentication headers are unchanged.

Dashboard requests from the browser reach the API through the plugin backend (`CallResource`), which sets these headers itself. The `routes` in `src/plugin.json` declare the same headers for the Grafana reverse proxy, but they are only used by Grafana when a plugin has no backend; if Grafana's data source proxy is ever in the path it may overwrite `User-Agent` with its own `Grafana/x.y.z`, in which case `X-VTEX-Client` is the reliable signal. Route headers cannot interpolate the plugin version, so the route `User-Agent` is `vtexio-grafana-datasource/unknown`.

## Contributing & Support

Found a bug or want to request a feature? Open a support ticket at [supporticket.vtex.com/support](https://supporticket.vtex.com/support).
