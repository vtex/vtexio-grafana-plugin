package plugin

import (
	"testing"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/data"
	"github.com/stretchr/testify/require"
)

// TestTrimUnsettledTrailingBucket is a direct unit test of the trim helper: it should
// remove exactly the last row when that bucket hasn't fully elapsed by `to`, and leave
// the frame untouched otherwise.
func TestTrimUnsettledTrailingBucket(t *testing.T) {
	newFrame := func(times []time.Time) *data.Frame {
		values := make([]*float64, len(times))
		for i := range values {
			v := float64(i)
			values[i] = &v
		}
		return data.NewFrame("metrics",
			data.NewField("Time", nil, times),
			data.NewField("footloose", nil, values),
		)
	}

	t.Run("drops the last bucket when it has not fully elapsed", func(t *testing.T) {
		times := []time.Time{
			time.Date(2026, 1, 1, 0, 58, 0, 0, time.UTC),
			time.Date(2026, 1, 1, 1, 0, 0, 0, time.UTC),
		}
		frame := newFrame(times)
		step := 60
		to := time.Date(2026, 1, 1, 1, 0, 0, 0, time.UTC) // bucket [01:00,01:01) has not elapsed

		trimUnsettledTrailingBucket(frame, &step, to)

		require.Equal(t, 1, frame.Fields[0].Len())
		got, ok := frame.Fields[0].At(0).(time.Time)
		require.True(t, ok)
		require.True(t, got.Equal(times[0]), "must keep the settled bucket, not the unsettled one")
	})

	t.Run("leaves the frame alone when the last bucket has already elapsed", func(t *testing.T) {
		times := []time.Time{
			time.Date(2026, 1, 1, 0, 58, 0, 0, time.UTC),
			time.Date(2026, 1, 1, 0, 59, 0, 0, time.UTC),
		}
		frame := newFrame(times)
		step := 60
		to := time.Date(2026, 1, 1, 1, 0, 0, 0, time.UTC) // bucket [00:59,01:00) already elapsed

		trimUnsettledTrailingBucket(frame, &step, to)

		require.Equal(t, 2, frame.Fields[0].Len())
	})

	t.Run("no-ops without a step", func(t *testing.T) {
		times := []time.Time{time.Date(2026, 1, 1, 1, 0, 0, 0, time.UTC)}
		frame := newFrame(times)

		trimUnsettledTrailingBucket(frame, nil, time.Date(2026, 1, 1, 1, 0, 0, 0, time.UTC))

		require.Equal(t, 1, frame.Fields[0].Len(), "dashboards send no step and must never be trimmed")
	})
}

// TestBuildFramesTrimsUnsettledBucketOnlyForAlerts guards the fix for a false-positive
// firing risk: read-api may not yet have every series' data for the freshest bucket, so
// a missing series there becomes a null point. Grafana's default alert Reduce mode
// ("Strict") turns that null into NaN, and Threshold treats a NaN input as a match —
// firing on a bucket that simply hasn't finished reporting, not on a real spike.
// Trimming that bucket for alert evaluations means "Last" always resolves to a fully
// reported one, regardless of which Reduce mode the alert rule uses. Dashboards must
// keep the freshest point, partial or not.
func TestBuildFramesTrimsUnsettledBucketOnlyForAlerts(t *testing.T) {
	// The 01:00:00 bucket covers [01:00:00, 01:01:00), which has not elapsed by `to` —
	// unsettled. The 00:58:00 bucket has fully elapsed — settled.
	response := O11yQueryResponse{Fields: []O11yField{
		{Name: TimestampColumn, Type: "time", Values: []interface{}{
			"2026-01-01T01:00:00Z", "2026-01-01T00:58:00Z",
		}},
		{Name: "account", Type: "string", Values: []interface{}{"footloose", "footloose"}},
		{Name: "Sum", Type: "number", Values: []interface{}{9.0, 3.0}},
	}}
	q := QueryModel{Type: QueryTypeMetrics, AppName: "a", PredefinedMetric: MetricRequestRate}
	to := time.Date(2026, 1, 1, 1, 0, 0, 0, time.UTC)

	t.Run("alert evaluation drops the unsettled bucket", func(t *testing.T) {
		step := 60
		frames := BuildFrames("A", q, &response, true, &step, to)
		require.Len(t, frames, 1)

		frame := frames[0]
		require.Equal(t, 1, frame.Fields[0].Len(), "only the settled bucket should remain")
		got, ok := frame.Fields[0].At(0).(time.Time)
		require.True(t, ok)
		require.Equal(t, "2026-01-01T00:58:00Z", got.Format(time.RFC3339))
	})

	t.Run("dashboard keeps the freshest partial bucket", func(t *testing.T) {
		frames := BuildFrames("A", q, &response, false, nil, to)
		require.Len(t, frames, 1)

		frame := frames[0]
		require.Equal(t, 2, frame.Fields[0].Len(), "dashboards render whatever arrived, including the freshest point")
	})
}

// TestBuildFramesTrimToEmptyReturnsZeroFrames covers the degenerate case: a series that
// has only just started reporting has exactly one bucket, and it is the unsettled one.
// Trimming it must fall through to the same zero-frames/NoData handling as a
// legitimately empty result, not leave a frame with a time field of length zero.
func TestBuildFramesTrimToEmptyReturnsZeroFrames(t *testing.T) {
	response := O11yQueryResponse{Fields: []O11yField{
		{Name: TimestampColumn, Type: "time", Values: []interface{}{"2026-01-01T01:00:00Z"}},
		{Name: "account", Type: "string", Values: []interface{}{"footloose"}},
		{Name: "Sum", Type: "number", Values: []interface{}{9.0}},
	}}
	q := QueryModel{Type: QueryTypeMetrics, AppName: "a", PredefinedMetric: MetricRequestRate}
	step := 60

	frames := BuildFrames("A", q, &response, true, &step, time.Date(2026, 1, 1, 1, 0, 0, 0, time.UTC))
	require.Empty(t, frames, "trimming the only bucket must produce zero frames, not one with an empty time field")
}

// TestEmptyResultReturnsZeroFrames guards against a real failure found by watching a
// live alert rule: once its fixture data aged out of the rule's relative time window,
// the query legitimately matched zero rows, and the resulting Time-only frame made
// Grafana's expression engine fail evaluation outright —
//
//	[sse.readDataError] [A] got error: input data must be a wide series but got type not
//
// — rather than behaving like an ordinary quiet period. read-api returns proper field
// names with empty value arrays for a no-match query (confirmed directly against a
// window with no data), so every wide-frame builder must treat "fields present, zero
// rows" as "return no frames", not "return a frame with just a time axis".
func TestEmptyResultReturnsZeroFrames(t *testing.T) {
	empty := func(names ...string) O11yQueryResponse {
		fields := make([]O11yField, len(names))
		for i, n := range names {
			fields[i] = O11yField{Name: n, Type: "string", Values: []interface{}{}}
		}
		return O11yQueryResponse{Fields: fields}
	}

	cases := []struct {
		name      string
		metric    PredefinedMetric
		fromAlert bool
		res       O11yQueryResponse
	}{
		{"REQUEST_RATE", MetricRequestRate, false,
			empty(TimestampColumn, "account", "Sum")},
		{"ERROR_RATE_BY_HANDLER", MetricErrorRateByHandler, false,
			empty(TimestampColumn, "app", "handler", "error_rate")},
		{"LATENCY_P99_PER_HANDLER", MetricLatencyP99PerHandler, false,
			empty(TimestampColumn, "handler", "ExplicitBounds", "BucketCounts")},
		{"LATENCY_STATS_BY_ACCOUNT_AND_HANDLER as alert", MetricLatencyStatsByAccountAndHandler, true,
			empty(TimestampColumn, "account", "handler", "ExplicitBounds", "BucketCounts")},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			q := QueryModel{Type: QueryTypeMetrics, AppName: "a", PredefinedMetric: tc.metric}
			frames := BuildFrames("A", q, &tc.res, tc.fromAlert, nil, time.Time{})
			require.Empty(t, frames, "an empty result must produce zero frames, not one unclassifiable frame")
		})
	}
}
