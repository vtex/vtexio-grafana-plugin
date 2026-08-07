package plugin

import "math"

// This file is a port of src/utils/histogramQuantiles.ts. read-api offers no quantile
// aggregation — the metrics table stores histograms as sumForEach bucket counts and an
// any() bounds array, with no quantiles aggregate state to merge — so percentiles are
// interpolated here, exactly as the frontend does.
//
// The port must stay behaviourally identical to the TypeScript, or a panel and the
// alert built on it would disagree. TestHistogramQuantilesMatchFrontendFixtures asserts
// that against shared fixtures.

// BoundsEqual reports whether two bounds arrays have the same length and equal values
// at each index, treating NaN as equal to NaN. Histogram rows are only merged when they
// share a bucket schema.
func BoundsEqual(a, b []float64) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if math.IsNaN(a[i]) && math.IsNaN(b[i]) {
			continue
		}
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// ComputeHistogramQuantiles computes approximate quantiles from histogram bucket bounds
// and counts, using linear interpolation within the bucket where the cumulative count
// crosses the quantile (Prometheus-style).
//
// bounds holds the upper bound of each bucket, assumed sorted ascending; counts holds
// the count in each bucket. Results are returned in the order requested, and are NaN
// when there is no data, when the inputs are inconsistent, or when a quantile is
// outside [0, 1]. A quantile of 0 returns the histogram's implicit lower bound of 0; a
// quantile of 1 returns the last bound.
func ComputeHistogramQuantiles(bounds, counts []float64, quantiles []float64) []float64 {
	result := make([]float64, 0, len(quantiles))

	total := totalCount(counts)
	if total <= 0 || len(bounds) == 0 || len(bounds) != len(counts) {
		for range quantiles {
			result = append(result, math.NaN())
		}
		return result
	}

	for _, q := range quantiles {
		result = append(result, quantileFromBuckets(bounds, counts, total, q))
	}
	return result
}

// totalCount sums bucket counts, treating NaN as zero.
func totalCount(counts []float64) float64 {
	total := 0.0
	for _, c := range counts {
		if !math.IsNaN(c) {
			total += c
		}
	}
	return total
}

// quantileFromBuckets interpolates one quantile. Split out from
// ComputeHistogramQuantiles to keep that function under the cognitive-complexity
// limit; the arithmetic and every edge case are unchanged, and the shared parity
// fixtures prove the split did not alter a single output.
//
// total must be > 0 and bounds/counts must be the same non-zero length — the caller
// checks both.
func quantileFromBuckets(bounds, counts []float64, total, q float64) float64 {
	if math.IsNaN(q) || q < 0 || q > 1 {
		return math.NaN()
	}
	if q <= 0 {
		return 0
	}
	if q >= 1 {
		return bounds[len(bounds)-1]
	}

	rank := q * total

	// Walk buckets until the cumulative count crosses the rank.
	cumulative := 0.0
	i := 0
	for ; i < len(counts); i++ {
		c := counts[i]
		if math.IsNaN(c) {
			c = 0
		}
		cumulative += c
		if cumulative >= rank {
			break
		}
	}

	if i >= len(bounds) {
		return bounds[len(bounds)-1]
	}

	countInBucket := counts[i]
	if math.IsNaN(countInBucket) {
		countInBucket = 0
	}

	lowerBound := 0.0
	if i > 0 {
		lowerBound = bounds[i-1]
	}
	upperBound := bounds[i]

	// An empty crossing bucket has nothing to interpolate across.
	if countInBucket <= 0 {
		return upperBound
	}

	fractionInBucket := (rank - (cumulative - countInBucket)) / countInBucket
	return lowerBound + fractionInBucket*(upperBound-lowerBound)
}

// trimToBounds drops the trailing +Inf bucket when read-api returns BucketCounts one
// element longer than ExplicitBounds, matching the frontend's slice.
func trimToBounds(bounds, counts []float64) []float64 {
	if len(counts) == len(bounds)+1 {
		return counts[:len(bounds)]
	}
	return counts
}
