package plugin

import (
	"encoding/json"
	"math"
	"strconv"
	"time"
)

// Conversions from decoded JSON into typed values.
//
// read-api types are shaped by ClickHouse and by JSON encoding, so a column that is
// conceptually a number can arrive as a float64, a json.Number, or a string. Each
// helper returns a zero value or an ok=false rather than failing the whole query: one
// unparseable cell should not blank a panel.

// timeLayouts covers the timestamp forms read-api emits. RFC3339 with and without
// fractional seconds covers observed responses; the rest are defensive.
var timeLayouts = []string{
	time.RFC3339Nano,
	time.RFC3339,
	"2006-01-02T15:04:05.000Z",
	"2006-01-02 15:04:05",
}

// asTime parses a timestamp cell. Numeric values are treated as epoch seconds when
// small enough to be seconds rather than milliseconds — the same heuristic the
// TypeScript datasource applies.
func asTime(value interface{}) (time.Time, bool) {
	switch v := value.(type) {
	case string:
		for _, layout := range timeLayouts {
			if t, err := time.Parse(layout, v); err == nil {
				return t.UTC(), true
			}
		}
	case float64:
		return epochToTime(v), true
	case json.Number:
		if f, err := v.Float64(); err == nil {
			return epochToTime(f), true
		}
	}
	return time.Time{}, false
}

// epochToTime interprets a numeric timestamp. Below 1e12 it cannot be milliseconds for
// any plausible date, so it is seconds.
func epochToTime(v float64) time.Time {
	if v < 1e12 {
		return time.Unix(int64(v), 0).UTC()
	}
	return time.UnixMilli(int64(v)).UTC()
}

// asString renders a cell as a string, with nil becoming "".
func asString(value interface{}) string {
	switch v := value.(type) {
	case nil:
		return ""
	case string:
		return v
	case json.Number:
		return v.String()
	case float64:
		return strconv.FormatFloat(v, 'f', -1, 64)
	case bool:
		return strconv.FormatBool(v)
	default:
		return ""
	}
}

// asFloat renders a numeric cell, returning NaN when the value is missing or
// unparseable. NaN is meaningful downstream: it becomes a null point in a frame.
func asFloat(value interface{}) float64 {
	switch v := value.(type) {
	case float64:
		return v
	case json.Number:
		if f, err := v.Float64(); err == nil {
			return f
		}
	case int64:
		return float64(v)
	case string:
		if f, err := strconv.ParseFloat(v, 64); err == nil {
			return f
		}
	case bool:
		if v {
			return 1
		}
		return 0
	}
	return math.NaN()
}

// asFloats converts an array cell — histogram bounds or bucket counts — into floats.
// Returns nil when the cell is not an array, which callers treat as "skip this row".
func asFloats(value interface{}) []float64 {
	raw, ok := value.([]interface{})
	if !ok {
		return nil
	}
	out := make([]float64, len(raw))
	for i, item := range raw {
		out[i] = asFloat(item)
	}
	return out
}
