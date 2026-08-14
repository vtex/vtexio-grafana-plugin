import parity from '../fixtures/histogram-parity.json';
import { computeHistogramQuantiles } from '../../src/utils/histogramQuantiles';

// The other half of the percentile parity contract. pkg/plugin/histogram_test.go
// asserts the Go port against this same file.
//
// read-api offers no quantile aggregation — the metrics table stores histograms as
// sumForEach bucket counts with no quantiles aggregate state to merge — so percentiles
// are interpolated by the caller. Dashboards use this TypeScript implementation and
// alert evaluations use the Go one, so they have to produce identical numbers or a
// threshold set by eye on a panel would mean something else to the alert.

describe('histogram quantile parity (TypeScript side)', () => {
  it.each(parity.cases.map((c) => [c.name, c] as const))('%s', (_name, testCase) => {
    const got = computeHistogramQuantiles(testCase.bounds, testCase.counts, parity.quantiles);

    expect(got).toHaveLength(testCase.expected.length);
    testCase.expected.forEach((want, i) => {
      if (want === null) {
        expect(Number.isNaN(got[i])).toBe(true);
        return;
      }
      expect(got[i]).toBeCloseTo(want, 9);
    });
  });
});
