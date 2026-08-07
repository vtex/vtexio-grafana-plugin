package plugin

import (
	"math"
	"sort"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/data"
)

// Frame construction. Two shapes matter for alerting:
//
//   - Wide time series (one time field, one numeric field per series) for the five
//     metrics that vary over time. Grafana's Reduce and Threshold expressions consume
//     these directly.
//   - Numeric-long (string label fields plus numeric value fields, no time field) for
//     the two latency-stats metrics, which render as tables on a dashboard but must be
//     reducible when an alert rule evaluates them.

// BuildFrames converts a read-api response into frames for one target. `to` is the
// query's end time — for an alert evaluation this is effectively "now", and it is what
// trimUnsettledTrailingBucket measures bucket freshness against.
func BuildFrames(refID string, q QueryModel, res *O11yQueryResponse, fromAlert bool, step *int, to time.Time) data.Frames {
	var frame *data.Frame

	switch {
	case q.PredefinedMetric == MetricErrorRateByHandler:
		frame = errorRateByHandlerFrame(refID, res)
	case q.PredefinedMetric.isLatencyPercentile():
		frame = latencyPercentileFrame(refID, res, q.PredefinedMetric)
	case q.PredefinedMetric.isLatencyStats():
		if fromAlert {
			frame = latencyStatsNumericFrame(refID, res, q.PredefinedMetric)
		} else {
			frame = latencyStatsTableFrame(refID, res, q.PredefinedMetric)
		}
	default:
		frame = requestRateFrame(refID, res)
	}

	// Alert evaluations only ever reach this line with a wide time-series frame — see
	// the switch above — so trimming by Fields[0] as the time field is safe here.
	if fromAlert {
		trimUnsettledTrailingBucket(frame, step, to)
	}

	// A frame that ends up with no series — either zero fields at all (a required
	// column was missing from the response) or just the leading Time field with no
	// value fields (the query legitimately matched zero rows, or trimming above
	// removed the only bucket it had) — is a shape Grafana's server-side expression
	// engine cannot classify:
	//
	//	[sse.readDataError] [A] got error: input data must be a wide series but got type not
	//
	// which fails the whole evaluation instead of behaving like "no data". Found by
	// watching a real alert rule fail once its seeded fixture data aged out of the
	// rule's relative time window — an ordinary quiet period would trigger the same
	// failure. Returning zero frames instead of one malformed frame lets Grafana's
	// NoDataState policy handle it the way it is designed to.
	if len(frame.Fields) <= 1 || frame.Fields[0].Len() == 0 {
		return data.Frames{}
	}

	if step != nil {
		withMeta(frame, "step", *step)
	}
	return data.Frames{frame}
}

// trimUnsettledTrailingBucket drops the most recent time bucket from an alert-mode
// frame when it started less than one step ago, relative to the query's end time.
// read-api may not yet have every series' data for a bucket that is still open, and a
// missing series there becomes a null point — which Grafana's default alert Reduce
// mode ("Strict") turns into NaN, and a Threshold expression treats a NaN input as a
// match, firing on a bucket that simply hasn't finished reporting rather than on a
// real error-rate spike. Dropping the bucket means "Last" always resolves to a fully
// reported one, independent of which Reduce mode the alert rule uses.
//
// This costs up to one step of extra latency before an alert can fire or recover,
// which is an acceptable trade for alerting to never react to a partial window.
func trimUnsettledTrailingBucket(frame *data.Frame, step *int, to time.Time) {
	if step == nil || len(frame.Fields) == 0 {
		return
	}
	timeField := frame.Fields[0]
	n := timeField.Len()
	if n == 0 {
		return
	}
	last, ok := timeField.At(n - 1).(time.Time)
	if !ok {
		return
	}
	if !last.Add(time.Duration(*step) * time.Second).After(to) {
		return // the bucket had already fully elapsed by `to`
	}
	for _, f := range frame.Fields {
		f.Delete(f.Len() - 1)
	}
}

// withMeta records a key in the frame's custom meta, creating the maps as needed.
// The effective step goes here so bucketing is visible when someone is working out why
// a threshold fired.
func withMeta(frame *data.Frame, key string, value interface{}) {
	if frame.Meta == nil {
		frame.Meta = &data.FrameMeta{}
	}
	custom, ok := frame.Meta.Custom.(map[string]interface{})
	if !ok {
		custom = map[string]interface{}{}
	}
	custom[key] = value
	frame.Meta.Custom = custom
}

// timeSeriesFrame assembles a wide frame from a series-keyed value table.
//
// times must already be sorted. Every series gets a value for every timestamp: absent
// points are nil, not zero, so a gap reads as "no data" to Grafana's reducers rather
// than as a real zero that would drag an average down.
func timeSeriesFrame(
	refID string,
	times []time.Time,
	seriesOrder []string,
	displayName map[string]string,
	labels map[string]data.Labels,
	values map[string]map[time.Time]float64,
	unit string,
) *data.Frame {
	fields := []*data.Field{data.NewField("Time", nil, times)}

	for _, key := range seriesOrder {
		points := make([]*float64, len(times))
		for i, t := range times {
			if v, ok := values[key][t]; ok && !math.IsNaN(v) {
				value := v
				points[i] = &value
			}
		}

		name := displayName[key]
		field := data.NewField(name, labels[key], points)
		field.Config = &data.FieldConfig{DisplayNameFromDS: name}
		if unit != "" {
			field.Config.Unit = unit
		}
		fields = append(fields, field)
	}

	frame := data.NewFrame("metrics", fields...)
	frame.RefID = refID
	frame.Meta = &data.FrameMeta{PreferredVisualization: data.VisTypeGraph}
	return frame
}

// requestRateFrame builds one series per account (or account+status_code), matching
// createTimeSeriesDataFrame in datasource.ts.
func requestRateFrame(refID string, res *O11yQueryResponse) *data.Frame {
	timeField := res.field(TimestampColumn)
	accountField := res.field("account")
	valueField := firstField(res, "Sum", "Value", "Count")
	statusField := res.field("status_code")

	if timeField == nil || accountField == nil || valueField == nil {
		return emptyFrame(refID)
	}

	times, order, names, labels, values := newSeriesTable()
	for i := range timeField.Values {
		t, ok := asTime(timeField.Values[i])
		if !ok {
			continue
		}
		account := asString(at(accountField.Values, i))

		key, name := account, account
		lbl := data.Labels{"account": account}
		if statusField != nil {
			status := asString(at(statusField.Values, i))
			if status != "" {
				key = account + "\x00" + status
				name = account + " (" + status + ")"
				lbl["status_code"] = status
			}
		}

		times.add(t)
		order.add(key, name, lbl, names, labels)
		setValue(values, key, t, asFloat(at(valueField.Values, i)))
	}

	return timeSeriesFrame(refID, times.sorted(), order.keys, names, labels, values, "")
}

// errorRateByHandlerFrame builds one series per handler, carrying error_rate as a
// percentage. Mirrors createErrorRateByHandlerDataFrame in datasource.ts.
func errorRateByHandlerFrame(refID string, res *O11yQueryResponse) *data.Frame {
	timeField := res.field(TimestampColumn)
	appField := res.field("app")
	handlerField := res.field("handler")
	rateField := res.field("error_rate")

	if timeField == nil || appField == nil || handlerField == nil || rateField == nil {
		return emptyFrame(refID)
	}

	times, order, names, labels, values := newSeriesTable()
	for i := range timeField.Values {
		t, ok := asTime(timeField.Values[i])
		if !ok {
			continue
		}
		app := asString(at(appField.Values, i))
		handler := asString(at(handlerField.Values, i))

		key := app + "\x00" + handler
		name := handler
		if name == "" {
			name = "(no handler)"
		}

		times.add(t)
		order.add(key, name, data.Labels{"app": app, "handler": handler}, names, labels)
		setValue(values, key, t, asFloat(at(rateField.Values, i)))
	}

	return timeSeriesFrame(refID, times.sorted(), order.keys, names, labels, values, "percent")
}

// latencyPercentileFrame builds one series per handler, interpolating the requested
// percentile from the merged histogram buckets for each (time, handler).
func latencyPercentileFrame(refID string, res *O11yQueryResponse, metric PredefinedMetric) *data.Frame {
	timeField := res.field(TimestampColumn)
	handlerField := res.field("handler")
	boundsField := firstField(res, "ExplicitBounds", "bounds")
	countsField := firstField(res, "BucketCounts", "counts")

	if timeField == nil || handlerField == nil || boundsField == nil || countsField == nil {
		return emptyFrame(refID)
	}

	label, quantile, ok := metric.quantile()
	if !ok {
		return emptyFrame(refID)
	}

	// Merge bucket counts per (time, handler) before interpolating — summing counts
	// across rows that share a bucket schema, and skipping rows whose schema differs.
	type bucketKey struct {
		t       time.Time
		handler string
	}
	merged := map[bucketKey]*histogram{}
	var mergeOrder []bucketKey

	for i := range timeField.Values {
		t, okTime := asTime(timeField.Values[i])
		if !okTime {
			continue
		}
		bounds := asFloats(at(boundsField.Values, i))
		counts := asFloats(at(countsField.Values, i))
		if bounds == nil || counts == nil {
			continue
		}

		key := bucketKey{t: t, handler: asString(at(handlerField.Values, i))}
		existing, seen := merged[key]
		if !seen {
			merged[key] = &histogram{bounds: bounds, counts: counts}
			mergeOrder = append(mergeOrder, key)
			continue
		}
		existing.merge(bounds, counts)
	}

	times, order, names, labels, values := newSeriesTable()
	for _, key := range mergeOrder {
		h := merged[key]
		q := ComputeHistogramQuantiles(h.bounds, trimToBounds(h.bounds, h.counts), []float64{quantile})

		name := label + " | " + key.handler
		if key.handler == "" {
			name = label + " | (no handler)"
		}

		times.add(key.t)
		order.add(key.handler, name, data.Labels{"handler": key.handler}, names, labels)
		setValue(values, key.handler, key.t, q[0])
	}

	return timeSeriesFrame(refID, times.sorted(), order.keys, names, labels, values, "ms")
}

// latencyStats aggregates histogram rows into p50/p95/p99 per grouping key.
type latencyStats struct {
	keys       []string
	labelNames []string
	labelVals  map[string][]string
	hist       map[string]*histogram
}

// aggregateLatencyStats merges histogram rows by account (and handler, when the metric
// groups by it), which both latency-stats frame shapes are built from.
func aggregateLatencyStats(res *O11yQueryResponse, metric PredefinedMetric) *latencyStats {
	accountField := res.field("account")
	handlerField := res.field("handler")
	boundsField := firstField(res, "ExplicitBounds", "bounds")
	countsField := firstField(res, "BucketCounts", "counts")

	byHandler := metric == MetricLatencyStatsByAccountAndHandler
	if accountField == nil || boundsField == nil || countsField == nil || (byHandler && handlerField == nil) {
		return nil
	}

	stats := &latencyStats{
		labelNames: []string{"account"},
		labelVals:  map[string][]string{},
		hist:       map[string]*histogram{},
	}
	if byHandler {
		stats.labelNames = append(stats.labelNames, "handler")
	}

	for i := range accountField.Values {
		bounds := asFloats(at(boundsField.Values, i))
		counts := asFloats(at(countsField.Values, i))
		if bounds == nil || counts == nil {
			continue
		}

		account := asString(at(accountField.Values, i))
		values := []string{account}
		key := account
		if byHandler {
			handler := asString(at(handlerField.Values, i))
			values = append(values, handler)
			key = account + "\x00" + handler
		}

		if existing, seen := stats.hist[key]; seen {
			existing.merge(bounds, counts)
			continue
		}
		stats.hist[key] = &histogram{bounds: bounds, counts: counts}
		stats.labelVals[key] = values
		stats.keys = append(stats.keys, key)
	}

	return stats
}

// percentiles interpolates p50/p95/p99 for each aggregated key, in key order.
func (s *latencyStats) percentiles() (labels [][]string, p50, p95, p99 []*float64) {
	for _, key := range s.keys {
		h := s.hist[key]
		q := ComputeHistogramQuantiles(h.bounds, trimToBounds(h.bounds, h.counts), []float64{0.5, 0.95, 0.99})
		labels = append(labels, s.labelVals[key])
		p50 = append(p50, nilIfNaN(q[0]))
		p95 = append(p95, nilIfNaN(q[1]))
		p99 = append(p99, nilIfNaN(q[2]))
	}
	return labels, p50, p95, p99
}

// latencyStatsTableFrame is the dashboard shape: a table of percentiles per grouping.
func latencyStatsTableFrame(refID string, res *O11yQueryResponse, metric PredefinedMetric) *data.Frame {
	frame := latencyStatsFrame(refID, res, metric)
	frame.Meta = &data.FrameMeta{PreferredVisualization: data.VisTypeTable}
	return frame
}

// latencyStatsNumericFrame is the alerting shape for the two latency-stats metrics: a
// wide time series carrying p50/p95/p99 per (account[, handler]).
//
// The obvious design here is a numeric frame — these metrics render as a table and
// carry no meaningful time axis for a human. Both numeric shapes were tried against a
// real Grafana 11.5 alert rule and both were rejected by the expression engine:
//
//	numeric-long  -> [sse.readDataError] [A] input data must be a wide series but got type long
//	numeric-wide  -> [sse.readDataError] [A] input data must be a wide series but got type not
//
// A rule built on either fails to evaluate outright. Grafana's Reduce/Threshold
// pipeline wants a time series, so these metrics use the same shape as the other five —
// which is proven to work — and Reduce collapses each series to one value per
// account/handler/percentile. Dashboards keep the table.
func latencyStatsNumericFrame(refID string, res *O11yQueryResponse, metric PredefinedMetric) *data.Frame {
	timeField := res.field(TimestampColumn)
	accountField := res.field("account")
	handlerField := res.field("handler")
	boundsField := firstField(res, "ExplicitBounds", "bounds")
	countsField := firstField(res, "BucketCounts", "counts")

	byHandler := metric == MetricLatencyStatsByAccountAndHandler
	if timeField == nil || accountField == nil || boundsField == nil || countsField == nil ||
		(byHandler && handlerField == nil) {
		return emptyFrame(refID)
	}

	// Merge histogram rows per (bucket, account[, handler]) before interpolating, the
	// same rule the percentile charts use.
	type seriesKey struct {
		t       time.Time
		account string
		handler string
	}
	merged := map[seriesKey]*histogram{}
	var order []seriesKey

	for i := range timeField.Values {
		t, ok := asTime(timeField.Values[i])
		if !ok {
			continue
		}
		bounds := asFloats(at(boundsField.Values, i))
		counts := asFloats(at(countsField.Values, i))
		if bounds == nil || counts == nil {
			continue
		}

		key := seriesKey{t: t, account: asString(at(accountField.Values, i))}
		if byHandler {
			key.handler = asString(at(handlerField.Values, i))
		}

		if existing, seen := merged[key]; seen {
			existing.merge(bounds, counts)
			continue
		}
		merged[key] = &histogram{bounds: bounds, counts: counts}
		order = append(order, key)
	}

	quantiles := []struct {
		name string
		q    float64
	}{{"p50", 0.5}, {"p95", 0.95}, {"p99", 0.99}}

	times, seriesOrd, names, labels, values := newSeriesTable()
	for _, key := range order {
		h := merged[key]
		qs := make([]float64, 0, len(quantiles))
		for _, p := range quantiles {
			qs = append(qs, p.q)
		}
		computed := ComputeHistogramQuantiles(h.bounds, trimToBounds(h.bounds, h.counts), qs)

		for i, p := range quantiles {
			id := key.account + "\x00" + key.handler + "\x00" + p.name
			name := key.account + " | " + p.name
			lbl := data.Labels{"account": key.account, "percentile": p.name}
			if byHandler {
				name = key.account + " | " + key.handler + " | " + p.name
				lbl["handler"] = key.handler
			}

			times.add(key.t)
			seriesOrd.add(id, name, lbl, names, labels)
			setValue(values, id, key.t, computed[i])
		}
	}

	return timeSeriesFrame(refID, times.sorted(), seriesOrd.keys, names, labels, values, "ms")
}

func latencyStatsFrame(refID string, res *O11yQueryResponse, metric PredefinedMetric) *data.Frame {
	stats := aggregateLatencyStats(res, metric)
	if stats == nil {
		return emptyLatencyStatsFrame(refID, metric)
	}

	labelRows, p50, p95, p99 := stats.percentiles()

	fields := make([]*data.Field, 0, len(stats.labelNames)+3)
	for i, name := range stats.labelNames {
		column := make([]string, len(labelRows))
		for row, values := range labelRows {
			column[row] = values[i]
		}
		fields = append(fields, data.NewField(name, nil, column))
	}
	fields = append(fields,
		msField("p50", p50),
		msField("p95", p95),
		msField("p99", p99),
	)

	frame := data.NewFrame("metrics", fields...)
	frame.RefID = refID
	return frame
}

func emptyLatencyStatsFrame(refID string, metric PredefinedMetric) *data.Frame {
	fields := []*data.Field{data.NewField("account", nil, []string{})}
	if metric == MetricLatencyStatsByAccountAndHandler {
		fields = append(fields, data.NewField("handler", nil, []string{}))
	}
	fields = append(fields,
		msField("p50", []*float64{}),
		msField("p95", []*float64{}),
		msField("p99", []*float64{}),
	)
	frame := data.NewFrame("metrics", fields...)
	frame.RefID = refID
	return frame
}

func msField(name string, values []*float64) *data.Field {
	field := data.NewField(name, nil, values)
	field.Config = &data.FieldConfig{Unit: "ms"}
	return field
}

func emptyFrame(refID string) *data.Frame {
	frame := data.NewFrame("metrics")
	frame.RefID = refID
	return frame
}

// histogram is a merged set of bucket bounds and counts.
type histogram struct {
	bounds []float64
	counts []float64
}

// merge sums another row's counts into this histogram, but only when the bucket schema
// matches. Summing across differing bounds would silently produce nonsense percentiles,
// so a mismatched row is dropped instead — same rule as the frontend.
func (h *histogram) merge(bounds, counts []float64) {
	if len(counts) != len(h.counts) || !BoundsEqual(bounds, h.bounds) {
		return
	}
	for i := range counts {
		h.counts[i] += counts[i]
	}
}

// timeSet collects distinct timestamps and returns them sorted.
type timeSet struct {
	seen map[time.Time]bool
}

func (s *timeSet) add(t time.Time) { s.seen[t] = true }

func (s *timeSet) sorted() []time.Time {
	out := make([]time.Time, 0, len(s.seen))
	for t := range s.seen {
		out = append(out, t)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Before(out[j]) })
	return out
}

// seriesOrder records series keys in first-seen order, so frame field order is stable
// across runs rather than following Go's map iteration.
type seriesOrder struct {
	keys []string
	seen map[string]bool
}

func (o *seriesOrder) add(key, name string, labels data.Labels, names map[string]string, allLabels map[string]data.Labels) {
	if o.seen[key] {
		return
	}
	o.seen[key] = true
	o.keys = append(o.keys, key)
	names[key] = name
	allLabels[key] = labels
}

func newSeriesTable() (*timeSet, *seriesOrder, map[string]string, map[string]data.Labels, map[string]map[time.Time]float64) {
	return &timeSet{seen: map[time.Time]bool{}},
		&seriesOrder{seen: map[string]bool{}},
		map[string]string{},
		map[string]data.Labels{},
		map[string]map[time.Time]float64{}
}

func setValue(values map[string]map[time.Time]float64, key string, t time.Time, v float64) {
	if values[key] == nil {
		values[key] = map[time.Time]float64{}
	}
	values[key][t] = v
}

func nilIfNaN(v float64) *float64 {
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return nil
	}
	return &v
}

func firstField(res *O11yQueryResponse, names ...string) *O11yField {
	for _, name := range names {
		if f := res.field(name); f != nil {
			return f
		}
	}
	return nil
}

func at(values []interface{}, i int) interface{} {
	if i < len(values) {
		return values[i]
	}
	return nil
}
