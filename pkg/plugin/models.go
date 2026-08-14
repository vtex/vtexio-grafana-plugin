package plugin

// The types here mirror src/types.ts. They are duplicated rather than generated
// because the two runtimes are independent; tests/fixtures/query-contract.json, read by
// both the Go and Jest suites, is what keeps them honest.

// QueryType selects which read-api endpoint and frame shape a target uses.
type QueryType string

const (
	QueryTypeLogs       QueryType = "logs"
	QueryTypeMetrics    QueryType = "metrics"
	QueryTypeLogsVolume QueryType = "logsVolume"
)

// PredefinedMetric is one of the seven curated metrics the query editor offers.
// Alerting supports all of them; see frames.go for the shape each one produces.
type PredefinedMetric string

const (
	MetricRequestRate                     PredefinedMetric = "REQUEST_RATE"
	MetricErrorRateByHandler              PredefinedMetric = "ERROR_RATE_BY_HANDLER"
	MetricLatencyStatsByAccountAndHandler PredefinedMetric = "LATENCY_STATS_BY_ACCOUNT_AND_HANDLER"
	MetricLatencyStatsPerAccount          PredefinedMetric = "LATENCY_STATS_PER_ACCOUNT"
	MetricLatencyP50PerHandler            PredefinedMetric = "LATENCY_P50_PER_HANDLER"
	MetricLatencyP90PerHandler            PredefinedMetric = "LATENCY_P90_PER_HANDLER"
	MetricLatencyP99PerHandler            PredefinedMetric = "LATENCY_P99_PER_HANDLER"
)

// TimestampColumn is the time column read-api returns. It keeps this name even when
// the query is bucketed with `step`.
const TimestampColumn = "TimestampTime"

// isLatencyPercentile reports whether a metric is one of the per-handler percentile
// charts, which share a query shape and are built from histogram buckets.
func (m PredefinedMetric) isLatencyPercentile() bool {
	switch m {
	case MetricLatencyP50PerHandler, MetricLatencyP90PerHandler, MetricLatencyP99PerHandler:
		return true
	}
	return false
}

// isLatencyStats reports whether a metric is one of the two table-shaped latency
// summaries. These are the ones that need a numeric frame when alerting.
func (m PredefinedMetric) isLatencyStats() bool {
	return m == MetricLatencyStatsByAccountAndHandler || m == MetricLatencyStatsPerAccount
}

// usesHistogram reports whether a metric reads the duration histogram rather than the
// request counter.
func (m PredefinedMetric) usesHistogram() bool {
	return m.isLatencyStats() || m.isLatencyPercentile()
}

// quantile returns the percentile a per-handler latency chart plots.
func (m PredefinedMetric) quantile() (label string, q float64, ok bool) {
	switch m {
	case MetricLatencyP50PerHandler:
		return "p50", 0.5, true
	case MetricLatencyP90PerHandler:
		return "p90", 0.9, true
	case MetricLatencyP99PerHandler:
		return "p99", 0.99, true
	}
	return "", 0, false
}

// QueryModel is the per-target JSON Grafana sends to the backend. JSON tags match
// the AppQuery interface in src/types.ts; the Go field is named Type rather than
// QueryType to avoid the query.QueryType stutter at call sites.
type QueryModel struct {
	Type             QueryType        `json:"queryType"`
	AppName          string           `json:"appName"`
	PredefinedMetric PredefinedMetric `json:"predefinedMetric"`
	MetricType       string           `json:"metricType,omitempty"`
	PageSize         int              `json:"pageSize"`
	Filters          []QueryFilter    `json:"filters"`
}

// QueryFilter is one read-api filter clause.
type QueryFilter struct {
	Column   string `json:"column"`
	Operator string `json:"operator"`
	Type     string `json:"type"`
	Value    string `json:"value"`
}

// Order is one read-api ordering clause.
type Order struct {
	Column string `json:"column"`
	Dir    string `json:"dir"`
}

// GroupBy is the read-api grouping clause.
type GroupBy struct {
	Columns []string `json:"columns"`
}

// O11yQueryRequest is the read-api POST body. Field order and names must match what
// the TypeScript client sends; see the shared fixtures.
type O11yQueryRequest struct {
	Page     int           `json:"page"`
	PageSize int           `json:"pageSize"`
	Filters  []QueryFilter `json:"filters"`
	OrderBy  []Order       `json:"orders"`
	Columns  []string      `json:"columns,omitempty"`
	GroupBy  *GroupBy      `json:"group_by,omitempty"`
	// Step buckets the time column server-side, in seconds. Sent only for alert
	// evaluations, where a truncated series would mean a silently wrong threshold.
	Step *int `json:"step,omitempty"`
}

// O11yField is one column of a read-api response.
type O11yField struct {
	Name   string        `json:"name"`
	Type   string        `json:"type"`
	Values []interface{} `json:"values"`
}

// O11yQueryResponse is the read-api Grafana-DataFrame-shaped response.
type O11yQueryResponse struct {
	RefID  string                 `json:"refId"`
	Name   string                 `json:"name"`
	Fields []O11yField            `json:"fields"`
	Meta   map[string]interface{} `json:"meta,omitempty"`
}

// IsTruncated reports whether read-api cut the result short.
//
// It reads meta.truncated, never meta.pagination.hasMore: hasMore comes from a
// COUNT(*) that ignores GROUP BY, so it is true for essentially every grouped query
// even when the result is complete.
func (r *O11yQueryResponse) IsTruncated() bool {
	if r == nil || r.Meta == nil {
		return false
	}
	truncated, ok := r.Meta["truncated"].(bool)
	return ok && truncated
}

// field returns the named response column, or nil when absent.
func (r *O11yQueryResponse) field(name string) *O11yField {
	for i := range r.Fields {
		if r.Fields[i].Name == name {
			return &r.Fields[i]
		}
	}
	return nil
}
