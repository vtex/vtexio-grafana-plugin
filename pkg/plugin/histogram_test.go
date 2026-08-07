package plugin

import (
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
)

// tests/unit/histogramParity.test.ts asserts the TypeScript implementation against this
// same file. Percentiles are interpolated caller-side because read-api has no quantile
// aggregation, so the dashboard number and the alert number come from two different
// implementations — these fixtures are what keep them the same number.
const parityFixtures = "../../tests/fixtures/histogram-parity.json"

type parityFile struct {
	Quantiles []float64 `json:"quantiles"`
	Cases     []struct {
		Name     string     `json:"name"`
		Bounds   []float64  `json:"bounds"`
		Counts   []float64  `json:"counts"`
		Expected []*float64 `json:"expected"`
	} `json:"cases"`
}

func TestComputeHistogramQuantilesMatchesSharedFixtures(t *testing.T) {
	raw, err := os.ReadFile(filepath.Clean(parityFixtures))
	require.NoError(t, err)

	var parity parityFile
	require.NoError(t, json.Unmarshal(raw, &parity))
	require.NotEmpty(t, parity.Cases)

	for _, tc := range parity.Cases {
		t.Run(tc.Name, func(t *testing.T) {
			got := ComputeHistogramQuantiles(tc.Bounds, tc.Counts, parity.Quantiles)
			require.Len(t, got, len(tc.Expected))

			for i, want := range tc.Expected {
				if want == nil {
					require.True(t, math.IsNaN(got[i]),
						"quantile %v should have no value, got %v", parity.Quantiles[i], got[i])
					continue
				}
				require.InDelta(t, *want, got[i], 1e-9,
					"quantile %v", parity.Quantiles[i])
			}
		})
	}
}

func TestComputeHistogramQuantilesEdges(t *testing.T) {
	bounds := []float64{10, 20, 30}
	counts := []float64{1, 1, 1}

	t.Run("quantile 0 returns the implicit lower bound", func(t *testing.T) {
		require.Equal(t, 0.0, ComputeHistogramQuantiles(bounds, counts, []float64{0})[0])
	})

	t.Run("quantile 1 returns the last bound", func(t *testing.T) {
		require.Equal(t, 30.0, ComputeHistogramQuantiles(bounds, counts, []float64{1})[0])
	})

	t.Run("out of range quantiles have no value", func(t *testing.T) {
		got := ComputeHistogramQuantiles(bounds, counts, []float64{-0.1, 1.1})
		require.True(t, math.IsNaN(got[0]))
		require.True(t, math.IsNaN(got[1]))
	})
}

func TestBoundsEqual(t *testing.T) {
	require.True(t, BoundsEqual([]float64{1, 2, 3}, []float64{1, 2, 3}))
	require.False(t, BoundsEqual([]float64{1, 2}, []float64{1, 2, 3}))
	require.False(t, BoundsEqual([]float64{1, 2, 3}, []float64{1, 2, 4}))

	// NaN equals NaN here, matching the frontend, so rows with an unparseable bound
	// still merge rather than being silently dropped.
	require.True(t, BoundsEqual([]float64{1, math.NaN()}, []float64{1, math.NaN()}))
}

func TestTrimToBounds(t *testing.T) {
	bounds := []float64{10, 20, 30}

	t.Run("drops the trailing +Inf bucket", func(t *testing.T) {
		require.Equal(t, []float64{1, 2, 3}, trimToBounds(bounds, []float64{1, 2, 3, 4}))
	})

	t.Run("leaves matching lengths alone", func(t *testing.T) {
		require.Equal(t, []float64{1, 2, 3}, trimToBounds(bounds, []float64{1, 2, 3}))
	})
}
