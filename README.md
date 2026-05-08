# VTEX IO Grafana Datasource

## What are Grafana data source plugins?

Grafana supports a wide range of data sources, including Prometheus, MySQL, and even Datadog. There's a good chance you can already visualize metrics from the systems you have set up. In some cases, though, you already have an in-house metrics solution that you'd like to add to your Grafana dashboards. Grafana Data Source Plugins enables integrating such solutions with Grafana.

## Using the Plugin

### Querying Metrics

The VTEX IO Grafana datasource provides predefined metric types for easy observability of your VTEX IO applications:

1. **Select Query Type**: Choose "Metrics" from the query type dropdown
2. **Select App Name**: Choose the VTEX IO app you want to monitor
3. **Select Metric Type**: Choose from the predefined metrics:
   - **Request Rate per Account**: Shows the total number of requests over time, grouped by account
   - **Request Rate per Status per Account**: Shows request count broken down by HTTP status code and account
   - **Latency Stats per Account and Handler**: Shows latency percentiles (p50, p95, p99 in ms) per account and handler in a **table**

#### Supported Metrics

All metrics use the `runtime_http_requests_total` metric from the VTEX Observability Platform:

| Metric Type | Description | Grouping | Backend Metric |
|-------------|-------------|----------|----------------|
| Request Rate per Account | Total requests over time | By account | `runtime_http_requests_total` |
| Request Rate per Status per Account | Requests by HTTP status | By account + status code | `runtime_http_requests_total` |
| Latency Stats per Account and Handler | Latency percentiles (p50, p95, p99) per account and handler | By account + handler (table) | `runtime_http_requests_duration_milliseconds` |

**Latency Stats — table visualization:** Results for "Latency Stats per Account and Handler" are intended to be viewed as a **Table** (columns: account, handler, p50, p95, p99 in ms). The plugin signals this to Grafana via the response metadata. When you add a new panel and run a Latency Stats query, Grafana will often suggest or default to the Table visualization. In **Explore** or when changing an existing panel’s query to Latency Stats, if the view does not switch to Table automatically, choose **Table** from the visualization picker (panel options).

### Querying Logs

1. **Select Query Type**: Choose "Logs" from the query type dropdown
2. **Select App Name**: Choose the VTEX IO app whose logs you want to view
3. **Configure Page Size**: Adjust the number of log entries to retrieve (default: 100)
