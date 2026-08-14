package plugin

import (
	"math"
	"testing"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/data"
	"github.com/stretchr/testify/require"
)

// ---------------------------------------------------------------------------
// Smaller building blocks, tested on their own before the frame builders that
// compose them.
// ---------------------------------------------------------------------------

func TestAt(t *testing.T) {
	values := []interface{}{"a", "b"}

	t.Run("given an index within bounds", func(t *testing.T) {
		t.Run("when at is called", func(t *testing.T) {
			got := at(values, 1)

			t.Run("it should return that element", func(t *testing.T) {
				if got != "b" {
					t.Errorf("got %v, want %q", got, "b")
				}
			})
		})
	})

	t.Run("given an index out of bounds", func(t *testing.T) {
		t.Run("when at is called", func(t *testing.T) {
			got := at(values, 5)

			t.Run("it should return nil", func(t *testing.T) {
				if got != nil {
					t.Errorf("got %v, want nil", got)
				}
			})
		})
	})
}

func TestFirstField(t *testing.T) {
	res := &O11yQueryResponse{Fields: []O11yField{{Name: "bounds", Type: "array"}}}

	t.Run("given only the later of two candidate names is present", func(t *testing.T) {
		t.Run("when firstField is called with ExplicitBounds, bounds", func(t *testing.T) {
			got := firstField(res, "ExplicitBounds", "bounds")

			t.Run("it should fall through to the present name", func(t *testing.T) {
				if got == nil || got.Name != "bounds" {
					t.Errorf("got %v, want the \"bounds\" field", got)
				}
			})
		})
	})

	t.Run("given none of the requested names are present", func(t *testing.T) {
		t.Run("when firstField is called", func(t *testing.T) {
			got := firstField(res, "missing")

			t.Run("it should return nil", func(t *testing.T) {
				if got != nil {
					t.Errorf("got %v, want nil", got)
				}
			})
		})
	})
}

func TestNilIfNaN(t *testing.T) {
	t.Run("given NaN", func(t *testing.T) {
		t.Run("when nilIfNaN is called", func(t *testing.T) {
			got := nilIfNaN(math.NaN())

			t.Run("it should return nil", func(t *testing.T) {
				if got != nil {
					t.Errorf("got %v, want nil", *got)
				}
			})
		})
	})

	t.Run("given +Inf", func(t *testing.T) {
		t.Run("when nilIfNaN is called", func(t *testing.T) {
			got := nilIfNaN(math.Inf(1))

			t.Run("it should return nil", func(t *testing.T) {
				if got != nil {
					t.Errorf("got %v, want nil", *got)
				}
			})
		})
	})

	t.Run("given a normal value", func(t *testing.T) {
		t.Run("when nilIfNaN is called", func(t *testing.T) {
			got := nilIfNaN(42.5)

			t.Run("it should return a pointer to that value", func(t *testing.T) {
				if got == nil || *got != 42.5 {
					t.Errorf("got %v, want a pointer to 42.5", got)
				}
			})
		})
	})
}

func TestMsField(t *testing.T) {
	t.Run("given a name and values", func(t *testing.T) {
		v := 12.5

		t.Run("when msField is called", func(t *testing.T) {
			field := msField("p50", []*float64{&v})

			t.Run("it should set the field name", func(t *testing.T) {
				if field.Name != "p50" {
					t.Errorf("Name = %q, want %q", field.Name, "p50")
				}
			})
			t.Run("it should set the unit to ms", func(t *testing.T) {
				if field.Config == nil || field.Config.Unit != "ms" {
					t.Errorf("Config = %v, want Unit \"ms\"", field.Config)
				}
			})
		})
	})
}

func TestWithMeta(t *testing.T) {
	t.Run("given a frame with no meta yet", func(t *testing.T) {
		frame := data.NewFrame("metrics", data.NewField("Time", nil, []time.Time{}))

		t.Run("when withMeta is called", func(t *testing.T) {
			withMeta(frame, "step", 60)

			t.Run("it should create the custom meta map and set the key", func(t *testing.T) {
				custom, ok := frame.Meta.Custom.(map[string]interface{})
				if !ok {
					t.Fatal("Meta.Custom is not a map[string]interface{}")
				}
				if custom["step"] != 60 {
					t.Errorf(`custom["step"] = %v, want 60`, custom["step"])
				}
			})
		})
	})

	t.Run("given a frame that already has another custom key", func(t *testing.T) {
		frame := data.NewFrame("metrics", data.NewField("Time", nil, []time.Time{}))
		withMeta(frame, "existing", "value")

		t.Run("when withMeta sets a second key", func(t *testing.T) {
			withMeta(frame, "step", 60)

			t.Run("it should preserve the existing key alongside the new one", func(t *testing.T) {
				custom := frame.Meta.Custom.(map[string]interface{})
				if custom["existing"] != "value" {
					t.Errorf(`custom["existing"] = %v, want %q`, custom["existing"], "value")
				}
				if custom["step"] != 60 {
					t.Errorf(`custom["step"] = %v, want 60`, custom["step"])
				}
			})
		})
	})
}

func TestTimeSet(t *testing.T) {
	t.Run("given a repeated timestamp and one out of order", func(t *testing.T) {
		set := &timeSet{seen: map[time.Time]bool{}}
		early := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
		later := time.Date(2026, 1, 1, 1, 0, 0, 0, time.UTC)

		t.Run("when they are added and sorted is called", func(t *testing.T) {
			set.add(later)
			set.add(early)
			set.add(later) // duplicate

			got := set.sorted()

			t.Run("it should deduplicate", func(t *testing.T) {
				if len(got) != 2 {
					t.Fatalf("len(got) = %d, want 2", len(got))
				}
			})
			t.Run("it should return them in ascending order", func(t *testing.T) {
				if !got[0].Equal(early) || !got[1].Equal(later) {
					t.Errorf("got %v, want [%v, %v]", got, early, later)
				}
			})
		})
	})
}

func TestSeriesOrder(t *testing.T) {
	t.Run("given the same key added twice with different names", func(t *testing.T) {
		order := &seriesOrder{seen: map[string]bool{}}
		names := map[string]string{}
		labels := map[string]data.Labels{}

		t.Run("when add is called twice for that key", func(t *testing.T) {
			order.add("a", "first", data.Labels{"x": "1"}, names, labels)
			order.add("a", "second", data.Labels{"x": "2"}, names, labels)

			t.Run("it should record the key only once", func(t *testing.T) {
				if len(order.keys) != 1 {
					t.Fatalf("keys = %v, want exactly one entry", order.keys)
				}
			})
			t.Run("it should keep the first name and labels seen", func(t *testing.T) {
				if names["a"] != "first" {
					t.Errorf(`names["a"] = %q, want %q`, names["a"], "first")
				}
				if labels["a"]["x"] != "1" {
					t.Errorf(`labels["a"]["x"] = %q, want %q`, labels["a"]["x"], "1")
				}
			})
		})
	})

	t.Run("given two distinct keys added out of alphabetical order", func(t *testing.T) {
		order := &seriesOrder{seen: map[string]bool{}}
		names := map[string]string{}
		labels := map[string]data.Labels{}

		t.Run("when they are added", func(t *testing.T) {
			order.add("b", "B", nil, names, labels)
			order.add("a", "A", nil, names, labels)

			t.Run("it should preserve first-seen order rather than sorting", func(t *testing.T) {
				want := []string{"b", "a"}
				if len(order.keys) != 2 || order.keys[0] != want[0] || order.keys[1] != want[1] {
					t.Errorf("keys = %v, want %v", order.keys, want)
				}
			})
		})
	})
}

func TestHistogramMerge(t *testing.T) {
	t.Run("given two rows with the same bucket schema", func(t *testing.T) {
		h := &histogram{bounds: []float64{10, 20}, counts: []float64{1, 2}}

		t.Run("when merge is called with matching bounds", func(t *testing.T) {
			h.merge([]float64{10, 20}, []float64{3, 4})

			t.Run("it should sum the counts bucket by bucket", func(t *testing.T) {
				want := []float64{4, 6}
				for i := range want {
					if h.counts[i] != want[i] {
						t.Errorf("counts[%d] = %v, want %v", i, h.counts[i], want[i])
					}
				}
			})
		})
	})

	t.Run("given a row with different bucket bounds", func(t *testing.T) {
		h := &histogram{bounds: []float64{10, 20}, counts: []float64{1, 2}}

		t.Run("when merge is called with mismatched bounds", func(t *testing.T) {
			h.merge([]float64{5, 15}, []float64{100, 200})

			t.Run("it should drop the row and leave the histogram unchanged", func(t *testing.T) {
				want := []float64{1, 2}
				for i := range want {
					if h.counts[i] != want[i] {
						t.Errorf("counts[%d] = %v, want %v", i, h.counts[i], want[i])
					}
				}
			})
		})
	})

	t.Run("given a row with a different bucket count length", func(t *testing.T) {
		h := &histogram{bounds: []float64{10, 20}, counts: []float64{1, 2}}

		t.Run("when merge is called with a shorter counts slice", func(t *testing.T) {
			h.merge([]float64{10, 20}, []float64{100})

			t.Run("it should drop the row and leave the histogram unchanged", func(t *testing.T) {
				want := []float64{1, 2}
				for i := range want {
					if h.counts[i] != want[i] {
						t.Errorf("counts[%d] = %v, want %v", i, h.counts[i], want[i])
					}
				}
			})
		})
	})
}

func TestEmptyFrame(t *testing.T) {
	t.Run("given a refID", func(t *testing.T) {
		t.Run("when emptyFrame is called", func(t *testing.T) {
			frame := emptyFrame("A")

			t.Run("it should set the RefID", func(t *testing.T) {
				if frame.RefID != "A" {
					t.Errorf("RefID = %q, want %q", frame.RefID, "A")
				}
			})
			t.Run("it should have no fields", func(t *testing.T) {
				if len(frame.Fields) != 0 {
					t.Errorf("len(Fields) = %d, want 0", len(frame.Fields))
				}
			})
		})
	})
}

func TestEmptyLatencyStatsFrame(t *testing.T) {
	t.Run("given the by-account-and-handler metric", func(t *testing.T) {
		t.Run("when emptyLatencyStatsFrame is called", func(t *testing.T) {
			frame := emptyLatencyStatsFrame("A", MetricLatencyStatsByAccountAndHandler)

			t.Run("it should include a handler column", func(t *testing.T) {
				if len(frame.Fields) < 2 || frame.Fields[1].Name != "handler" {
					t.Errorf("Fields = %v, want Fields[1] to be \"handler\"", frame.Fields)
				}
			})
		})
	})

	t.Run("given the per-account metric", func(t *testing.T) {
		t.Run("when emptyLatencyStatsFrame is called", func(t *testing.T) {
			frame := emptyLatencyStatsFrame("A", MetricLatencyStatsPerAccount)

			t.Run("it should not include a handler column", func(t *testing.T) {
				for _, f := range frame.Fields {
					if f.Name == "handler" {
						t.Error("frame unexpectedly has a handler column")
					}
				}
			})
			t.Run("it should still include account, p50, p95, and p99", func(t *testing.T) {
				want := []string{"account", "p50", "p95", "p99"}
				if len(frame.Fields) != len(want) {
					t.Fatalf("field count = %d, want %d", len(frame.Fields), len(want))
				}
				for i, name := range want {
					if frame.Fields[i].Name != name {
						t.Errorf("field %d = %q, want %q", i, frame.Fields[i].Name, name)
					}
				}
			})
		})
	})
}

// ---------------------------------------------------------------------------
// The frame builders, tested next: each one composes the smaller helpers
// above into a *data.Frame for one metric shape.
// ---------------------------------------------------------------------------

func TestTimeSeriesFrameHelper(t *testing.T) {
	t1 := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	t2 := time.Date(2026, 1, 1, 0, 1, 0, 0, time.UTC)

	t.Run("given a series with a gap at one timestamp", func(t *testing.T) {
		values := map[string]map[time.Time]float64{"a": {t1: 1.0}}

		t.Run("when timeSeriesFrame is called", func(t *testing.T) {
			frame := timeSeriesFrame("A", []time.Time{t1, t2}, []string{"a"},
				map[string]string{"a": "Account A"}, map[string]data.Labels{"a": {"account": "a"}},
				values, "")

			t.Run("it should leave the gap as a nil pointer, not zero", func(t *testing.T) {
				valueField := frame.Fields[1]

				present, ok := valueField.At(0).(*float64)
				if !ok || present == nil {
					t.Error("At(0) should be a non-nil *float64")
				}

				absent, _ := valueField.At(1).(*float64)
				if absent != nil {
					t.Errorf("At(1) = %v, want a nil pointer for the missing point", *absent)
				}
			})
		})
	})

	t.Run("given a unit", func(t *testing.T) {
		values := map[string]map[time.Time]float64{"a": {t1: 1.0}}

		t.Run(`when timeSeriesFrame is called with unit "percent"`, func(t *testing.T) {
			frame := timeSeriesFrame("A", []time.Time{t1}, []string{"a"},
				map[string]string{"a": "Account A"}, map[string]data.Labels{"a": {}},
				values, "percent")

			t.Run("it should set the unit on the value field", func(t *testing.T) {
				if frame.Fields[1].Config == nil || frame.Fields[1].Config.Unit != "percent" {
					t.Errorf("Config = %v, want Unit %q", frame.Fields[1].Config, "percent")
				}
			})
		})
	})

	t.Run("given no series", func(t *testing.T) {
		t.Run("when timeSeriesFrame is called", func(t *testing.T) {
			frame := timeSeriesFrame("A", []time.Time{t1}, nil, nil, nil, nil, "")

			t.Run("it should still produce a frame with just the Time field", func(t *testing.T) {
				if len(frame.Fields) != 1 {
					t.Errorf("len(Fields) = %d, want 1", len(frame.Fields))
				}
			})
		})
	})
}

func TestRequestRateFrame(t *testing.T) {
	t.Run("given rows for two accounts and no status_code column", func(t *testing.T) {
		res := &O11yQueryResponse{Fields: []O11yField{
			{Name: TimestampColumn, Type: "time", Values: []interface{}{
				"2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z",
			}},
			{Name: "account", Type: "string", Values: []interface{}{"footloose", "acme"}},
			{Name: "Sum", Type: "number", Values: []interface{}{3.0, 5.0}},
		}}

		t.Run("when requestRateFrame is called", func(t *testing.T) {
			frame := requestRateFrame("A", res)

			t.Run("it should produce one series per account", func(t *testing.T) {
				if len(frame.Fields) != 3 { // Time + 2 accounts
					t.Fatalf("len(Fields) = %d, want 3", len(frame.Fields))
				}
			})
		})
	})

	t.Run("given rows split by status_code for the same account", func(t *testing.T) {
		res := &O11yQueryResponse{Fields: []O11yField{
			{Name: TimestampColumn, Type: "time", Values: []interface{}{
				"2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z",
			}},
			{Name: "account", Type: "string", Values: []interface{}{"footloose", "footloose"}},
			{Name: "Sum", Type: "number", Values: []interface{}{3.0, 1.0}},
			{Name: "status_code", Type: "string", Values: []interface{}{"200", "500"}},
		}}

		t.Run("when requestRateFrame is called", func(t *testing.T) {
			frame := requestRateFrame("A", res)

			t.Run("it should split them into separate series", func(t *testing.T) {
				if len(frame.Fields) != 3 { // Time + 200 + 500
					t.Fatalf("len(Fields) = %d, want 3", len(frame.Fields))
				}
			})
			t.Run("it should name each series with its status code", func(t *testing.T) {
				got := []string{frame.Fields[1].Name, frame.Fields[2].Name}
				want := []string{"footloose (200)", "footloose (500)"}
				if got[0] != want[0] || got[1] != want[1] {
					t.Errorf("names = %v, want %v", got, want)
				}
			})
		})
	})

	t.Run("given a row with an unparseable timestamp", func(t *testing.T) {
		res := &O11yQueryResponse{Fields: []O11yField{
			{Name: TimestampColumn, Type: "time", Values: []interface{}{"not a timestamp", "2026-01-01T00:00:00Z"}},
			{Name: "account", Type: "string", Values: []interface{}{"footloose", "footloose"}},
			{Name: "Sum", Type: "number", Values: []interface{}{3.0, 1.0}},
		}}

		t.Run("when requestRateFrame is called", func(t *testing.T) {
			frame := requestRateFrame("A", res)

			t.Run("it should skip that row rather than fail the whole frame", func(t *testing.T) {
				if frame.Fields[0].Len() != 1 {
					t.Errorf("time field length = %d, want 1 (one row skipped)", frame.Fields[0].Len())
				}
			})
		})
	})

	t.Run("given a response missing a required field", func(t *testing.T) {
		res := &O11yQueryResponse{Fields: []O11yField{
			{Name: TimestampColumn, Type: "time", Values: []interface{}{}},
		}}

		t.Run("when requestRateFrame is called", func(t *testing.T) {
			frame := requestRateFrame("A", res)

			t.Run("it should return an empty frame", func(t *testing.T) {
				if len(frame.Fields) != 0 {
					t.Errorf("len(Fields) = %d, want 0", len(frame.Fields))
				}
			})
		})
	})
}

func TestErrorRateByHandlerFrame(t *testing.T) {
	t.Run("given a row with no handler", func(t *testing.T) {
		res := &O11yQueryResponse{Fields: []O11yField{
			{Name: TimestampColumn, Type: "time", Values: []interface{}{"2026-01-01T00:00:00Z"}},
			{Name: "app", Type: "string", Values: []interface{}{"myapp"}},
			{Name: "handler", Type: "string", Values: []interface{}{""}},
			{Name: "error_rate", Type: "number", Values: []interface{}{5.0}},
		}}

		t.Run("when errorRateByHandlerFrame is called", func(t *testing.T) {
			frame := errorRateByHandlerFrame("A", res)

			t.Run("it should fall back to a placeholder series name", func(t *testing.T) {
				if frame.Fields[1].Name != "(no handler)" {
					t.Errorf("Name = %q, want %q", frame.Fields[1].Name, "(no handler)")
				}
			})
		})
	})

	t.Run("given a response missing the error_rate field", func(t *testing.T) {
		res := &O11yQueryResponse{Fields: []O11yField{
			{Name: TimestampColumn, Type: "time", Values: []interface{}{}},
			{Name: "app", Type: "string", Values: []interface{}{}},
			{Name: "handler", Type: "string", Values: []interface{}{}},
		}}

		t.Run("when errorRateByHandlerFrame is called", func(t *testing.T) {
			frame := errorRateByHandlerFrame("A", res)

			t.Run("it should return an empty frame", func(t *testing.T) {
				if len(frame.Fields) != 0 {
					t.Errorf("len(Fields) = %d, want 0", len(frame.Fields))
				}
			})
		})
	})
}

func TestLatencyPercentileFrame(t *testing.T) {
	t.Run("given two rows for the same time and handler sharing a bucket schema", func(t *testing.T) {
		res := &O11yQueryResponse{Fields: []O11yField{
			{Name: TimestampColumn, Type: "time", Values: []interface{}{
				"2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z",
			}},
			{Name: "handler", Type: "string", Values: []interface{}{"GET /x", "GET /x"}},
			{Name: "ExplicitBounds", Type: "array", Values: []interface{}{
				[]interface{}{10.0, 20.0}, []interface{}{10.0, 20.0},
			}},
			{Name: "BucketCounts", Type: "array", Values: []interface{}{
				[]interface{}{1.0, 1.0}, []interface{}{1.0, 1.0},
			}},
		}}

		t.Run("when latencyPercentileFrame is called for p50", func(t *testing.T) {
			frame := latencyPercentileFrame("A", res, MetricLatencyP50PerHandler)

			t.Run("it should merge the two rows into a single point, not two", func(t *testing.T) {
				if frame.Fields[0].Len() != 1 {
					t.Errorf("time field length = %d, want 1", frame.Fields[0].Len())
				}
			})
		})
	})

	t.Run("given a metric with no defined quantile", func(t *testing.T) {
		res := &O11yQueryResponse{Fields: []O11yField{
			{Name: TimestampColumn, Type: "time", Values: []interface{}{"2026-01-01T00:00:00Z"}},
			{Name: "handler", Type: "string", Values: []interface{}{"GET /x"}},
			{Name: "ExplicitBounds", Type: "array", Values: []interface{}{[]interface{}{10.0}}},
			{Name: "BucketCounts", Type: "array", Values: []interface{}{[]interface{}{1.0}}},
		}}

		t.Run("when latencyPercentileFrame is called for MetricRequestRate", func(t *testing.T) {
			frame := latencyPercentileFrame("A", res, MetricRequestRate)

			t.Run("it should return an empty frame", func(t *testing.T) {
				if len(frame.Fields) != 0 {
					t.Errorf("len(Fields) = %d, want 0", len(frame.Fields))
				}
			})
		})
	})

	t.Run("given a row with no handler", func(t *testing.T) {
		res := &O11yQueryResponse{Fields: []O11yField{
			{Name: TimestampColumn, Type: "time", Values: []interface{}{"2026-01-01T00:00:00Z"}},
			{Name: "handler", Type: "string", Values: []interface{}{""}},
			{Name: "ExplicitBounds", Type: "array", Values: []interface{}{[]interface{}{10.0}}},
			{Name: "BucketCounts", Type: "array", Values: []interface{}{[]interface{}{1.0}}},
		}}

		t.Run("when latencyPercentileFrame is called", func(t *testing.T) {
			frame := latencyPercentileFrame("A", res, MetricLatencyP50PerHandler)

			t.Run("it should fall back to a placeholder series name", func(t *testing.T) {
				if frame.Fields[1].Name != "p50 | (no handler)" {
					t.Errorf("Name = %q, want %q", frame.Fields[1].Name, "p50 | (no handler)")
				}
			})
		})
	})
}

func TestAggregateLatencyStats(t *testing.T) {
	t.Run("given two rows for the same account sharing a bucket schema", func(t *testing.T) {
		res := &O11yQueryResponse{Fields: []O11yField{
			{Name: "account", Type: "string", Values: []interface{}{"footloose", "footloose"}},
			{Name: "ExplicitBounds", Type: "array", Values: []interface{}{
				[]interface{}{10.0}, []interface{}{10.0},
			}},
			{Name: "BucketCounts", Type: "array", Values: []interface{}{
				[]interface{}{1.0}, []interface{}{2.0},
			}},
		}}

		t.Run("when aggregateLatencyStats is called for the per-account metric", func(t *testing.T) {
			stats := aggregateLatencyStats(res, MetricLatencyStatsPerAccount)

			t.Run("it should merge both rows into a single account key", func(t *testing.T) {
				if stats == nil || len(stats.keys) != 1 {
					t.Fatalf("stats = %v, want exactly one key", stats)
				}
			})
			t.Run("it should sum their bucket counts", func(t *testing.T) {
				h := stats.hist[stats.keys[0]]
				if h.counts[0] != 3 {
					t.Errorf("counts[0] = %v, want 3", h.counts[0])
				}
			})
		})
	})

	t.Run("given a by-account-and-handler metric with an empty response", func(t *testing.T) {
		res := &O11yQueryResponse{Fields: []O11yField{
			{Name: "account", Type: "string", Values: []interface{}{}},
			{Name: "ExplicitBounds", Type: "array", Values: []interface{}{}},
			{Name: "BucketCounts", Type: "array", Values: []interface{}{}},
		}}

		t.Run("when aggregateLatencyStats is called without a handler field present", func(t *testing.T) {
			stats := aggregateLatencyStats(res, MetricLatencyStatsByAccountAndHandler)

			t.Run("it should return nil", func(t *testing.T) {
				if stats != nil {
					t.Errorf("stats = %v, want nil", stats)
				}
			})
		})
	})

	t.Run("given already-aggregated stats", func(t *testing.T) {
		res := &O11yQueryResponse{Fields: []O11yField{
			{Name: "account", Type: "string", Values: []interface{}{"footloose"}},
			{Name: "ExplicitBounds", Type: "array", Values: []interface{}{[]interface{}{10.0}}},
			{Name: "BucketCounts", Type: "array", Values: []interface{}{[]interface{}{1.0}}},
		}}
		stats := aggregateLatencyStats(res, MetricLatencyStatsPerAccount)

		t.Run("when percentiles is called", func(t *testing.T) {
			labels, p50, p95, p99 := stats.percentiles()

			t.Run("it should return one row of labels and percentiles per key", func(t *testing.T) {
				if len(labels) != 1 || len(p50) != 1 || len(p95) != 1 || len(p99) != 1 {
					t.Errorf("got %d label rows, want 1", len(labels))
				}
			})
		})
	})
}

func TestLatencyStatsTableFrame(t *testing.T) {
	res := &O11yQueryResponse{Fields: []O11yField{
		{Name: "account", Type: "string", Values: []interface{}{"footloose"}},
		{Name: "ExplicitBounds", Type: "array", Values: []interface{}{[]interface{}{10.0}}},
		{Name: "BucketCounts", Type: "array", Values: []interface{}{[]interface{}{1.0}}},
	}}

	t.Run("given aggregatable rows", func(t *testing.T) {
		t.Run("when latencyStatsTableFrame is called", func(t *testing.T) {
			frame := latencyStatsTableFrame("A", res, MetricLatencyStatsPerAccount)

			t.Run("it should prefer a table visualization", func(t *testing.T) {
				if frame.Meta == nil || frame.Meta.PreferredVisualization != data.VisTypeTable {
					t.Errorf("Meta = %v, want PreferredVisualization %v", frame.Meta, data.VisTypeTable)
				}
			})
		})
	})
}

func TestLatencyStatsNumericFrame(t *testing.T) {
	t.Run("given aggregatable rows for the per-account metric", func(t *testing.T) {
		res := &O11yQueryResponse{Fields: []O11yField{
			{Name: TimestampColumn, Type: "time", Values: []interface{}{"2026-01-01T00:00:00Z"}},
			{Name: "account", Type: "string", Values: []interface{}{"footloose"}},
			{Name: "ExplicitBounds", Type: "array", Values: []interface{}{[]interface{}{10.0}}},
			{Name: "BucketCounts", Type: "array", Values: []interface{}{[]interface{}{1.0}}},
		}}

		t.Run("when latencyStatsNumericFrame is called", func(t *testing.T) {
			frame := latencyStatsNumericFrame("A", res, MetricLatencyStatsPerAccount)

			t.Run("it should produce a wide time series with p50, p95, and p99", func(t *testing.T) {
				if len(frame.Fields) != 4 { // Time + p50 + p95 + p99
					t.Fatalf("len(Fields) = %d, want 4", len(frame.Fields))
				}
			})
		})
	})

	t.Run("given a response missing a required field", func(t *testing.T) {
		res := &O11yQueryResponse{Fields: []O11yField{
			{Name: TimestampColumn, Type: "time", Values: []interface{}{}},
		}}

		t.Run("when latencyStatsNumericFrame is called", func(t *testing.T) {
			frame := latencyStatsNumericFrame("A", res, MetricLatencyStatsPerAccount)

			t.Run("it should return an empty frame", func(t *testing.T) {
				if len(frame.Fields) != 0 {
					t.Errorf("len(Fields) = %d, want 0", len(frame.Fields))
				}
			})
		})
	})
}

// ---------------------------------------------------------------------------
// The bigger, top-level behaviors, built from everything above.
// ---------------------------------------------------------------------------

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
