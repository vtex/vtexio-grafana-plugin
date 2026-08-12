package plugin

import (
	"fmt"
	"time"
)

// Port of the request-building half of src/clients/o11yApi.ts. The frontend keeps its
// own copy for dashboard queries, so both must produce the same read-api body for the
// same query model — asserted by the shared fixtures in pkg/plugin/testdata.

// Page sizes for the per-handler latency charts, mirroring datasource.ts.
const (
	latencyChartPageSize    = 5000
	latencyChartMinPageSize = 500
	defaultPageSize         = 100
)

// BuildRequest turns a query model and time range into the read-api POST body.
//
// step is sent only for alert evaluations; a nil step leaves read-api at stored
// granularity, which is what dashboards get today.
func BuildRequest(q QueryModel, from, to time.Time, step *int) O11yQueryRequest {
	req := O11yQueryRequest{
		Page:     1,
		PageSize: pageSizeFor(q),
		Filters:  append(buildTimestampFilters(from, to), buildFetchFilters(q)...),
		Orders:   buildOrders(q),
		Step:     step,
	}

	if q.Type == QueryTypeMetrics {
		req.Columns = buildMetricsColumns(q.PredefinedMetric)
	}
	if gb := buildGroupBy(q.PredefinedMetric); gb != nil {
		req.GroupBy = gb
	}

	return req
}

// pageSizeFor mirrors getPageSizeForMetricsQuery in datasource.ts: the percentile
// charts need enough time buckets to draw a continuous line, but still respect a
// user-tuned page size.
func pageSizeFor(q QueryModel) int {
	if q.Type == QueryTypeMetrics && q.PredefinedMetric.isLatencyPercentile() {
		userPageSize := q.PageSize
		if userPageSize == 0 {
			userPageSize = defaultPageSize
		}
		return min(latencyChartPageSize, max(userPageSize, latencyChartMinPageSize))
	}
	if q.PageSize > 0 {
		return q.PageSize
	}
	return defaultPageSize
}

// buildTimestampFilters brackets the query to the Grafana time range.
func buildTimestampFilters(from, to time.Time) []QueryFilter {
	return []QueryFilter{
		{Column: TimestampColumn, Operator: ">=", Type: "timestamp", Value: from.UTC().Format("2006-01-02T15:04:05.000Z")},
		{Column: TimestampColumn, Operator: "<=", Type: "timestamp", Value: to.UTC().Format("2006-01-02T15:04:05.000Z")},
	}
}

// buildFetchFilters constrains the query to the selected app and the metric the
// predefined selection implies, then merges in panel filters.
//
// Base filters win on conflict: they define what the predefined metric *is*, so a panel
// filter must not be able to redefine it. A conflict is the same (column, operator).
func buildFetchFilters(q QueryModel) []QueryFilter {
	base := []QueryFilter{
		{Column: "app", Operator: "=", Type: "string", Value: q.AppName},
	}

	switch {
	case q.PredefinedMetric == MetricRequestRate || q.PredefinedMetric == MetricErrorRateByHandler:
		base = append(base, QueryFilter{
			Column: "MetricName", Operator: "=", Type: "string", Value: "runtime_http_requests_total",
		})
	case q.PredefinedMetric.usesHistogram():
		base = append(base,
			QueryFilter{Column: "MetricName", Operator: "=", Type: "string", Value: "runtime_http_requests_duration_milliseconds"},
			QueryFilter{Column: "MetricType", Operator: "=", Type: "string", Value: "histogram"},
		)
	}

	merged := make([]QueryFilter, 0, len(base)+len(q.Filters))
	merged = append(merged, base...)

	seen := make(map[string]bool, len(base))
	for _, f := range base {
		seen[filterKey(f)] = true
	}
	for _, f := range q.Filters {
		key := filterKey(f)
		if seen[key] {
			continue
		}
		merged = append(merged, f)
		seen[key] = true
	}

	return merged
}

func filterKey(f QueryFilter) string {
	return fmt.Sprintf("%s:%s", f.Column, f.Operator)
}

// buildOrders mirrors the ordering the TypeScript client picks per metric. The charts
// that draw a line over time read ascending; everything else reads newest-first.
func buildOrders(q QueryModel) []Order {
	if q.PredefinedMetric == MetricErrorRateByHandler || q.PredefinedMetric.isLatencyPercentile() {
		return []Order{{Column: TimestampColumn, Dir: "asc"}}
	}
	return []Order{{Column: TimestampColumn, Dir: "desc"}}
}

// buildGroupBy mirrors the group_by the TypeScript client sets per metric.
func buildGroupBy(m PredefinedMetric) *GroupBy {
	switch {
	case m == MetricErrorRateByHandler:
		return &GroupBy{Columns: []string{TimestampColumn, "app", "handler"}}
	case m == MetricLatencyStatsByAccountAndHandler || m.isLatencyPercentile():
		return &GroupBy{Columns: []string{TimestampColumn, "account", "handler"}}
	case m == MetricLatencyStatsPerAccount:
		return &GroupBy{Columns: []string{TimestampColumn, "account"}}
	}
	return nil
}

// buildMetricsColumns mirrors buildMetricsColumns in o11yApi.ts.
func buildMetricsColumns(m PredefinedMetric) []string {
	baseColumns := []string{TimestampColumn, "account", "MetricName", "MetricType", "app"}

	switch m {
	case MetricRequestRate:
		return append(baseColumns, "sumMerge(Sum) as Sum")

	case MetricErrorRateByHandler:
		// Error rate is counted per app and handler, deliberately not per account.
		return []string{
			TimestampColumn,
			"app",
			"ifNull(Attributes['handler'], 'unknown') as handler",
			"count() AS total_requests",
			"countIf(toUInt16(Attributes['status_code']) >= 400) AS error_count",
			"if(total_requests = 0, 0, (error_count / total_requests) * 100) AS error_rate",
		}

	case MetricLatencyStatsByAccountAndHandler, MetricLatencyP50PerHandler,
		MetricLatencyP90PerHandler, MetricLatencyP99PerHandler:
		return []string{
			TimestampColumn,
			"account",
			"ifNull(Attributes['handler'], 'unknown') as handler",
			"anyMerge(ExplicitBounds) AS ExplicitBounds",
			"sumForEachMerge(BucketCounts) AS BucketCounts",
		}

	case MetricLatencyStatsPerAccount:
		return []string{
			TimestampColumn,
			"account",
			"anyMerge(ExplicitBounds) AS ExplicitBounds",
			"sumForEachMerge(BucketCounts) AS BucketCounts",
		}
	}

	return append(baseColumns, "sumMerge(Sum) as Sum")
}
