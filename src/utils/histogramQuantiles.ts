/**
 * Returns true if two bounds arrays have the same length and equal values at each index.
 * Used to ensure histogram rows are only merged when they share the same bucket schema.
 */
export function boundsEqual(a: number[] | unknown, b: number[] | unknown): boolean {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    const bothNaN = typeof x === 'number' && typeof y === 'number' && Number.isNaN(x) && Number.isNaN(y);
    if (!bothNaN && x !== y) {
      return false;
    }
  }
  return true;
}

/**
 * Computes approximate quantiles from histogram bucket bounds and counts.
 * Uses linear interpolation within the bucket where the cumulative count crosses the quantile.
 * (Prometheus-style histogram quantile.)
 *
 * @param bounds - Upper bound of each bucket (length N). Assumed sorted ascending.
 * @param counts - Count in each bucket (length N).
 * @param quantiles - Quantiles to compute, in [0, 1] (e.g. 0.5, 0.9, 0.95, 0.99).
 * @returns Computed quantile values in same order as quantiles; NaN if no data, invalid, or q outside (0, 1).
 *          q <= 0 returns the histogram's implicit lower bound (0). q >= 1 returns the last bound.
 */
export function computeHistogramQuantiles(
  bounds: number[],
  counts: number[],
  quantiles: number[]
): number[] {
  const total = counts.reduce((s, c) => s + (typeof c === 'number' && !Number.isNaN(c) ? c : 0), 0);
  if (total <= 0 || bounds.length === 0 || bounds.length !== counts.length) {
    return quantiles.map(() => Number.NaN);
  }

  const lastBound = bounds[bounds.length - 1] ?? Number.NaN;
  const result: number[] = [];
  for (const q of quantiles) {
    if (typeof q !== 'number' || Number.isNaN(q) || q < 0 || q > 1) {
      result.push(Number.NaN);
      continue;
    }
    if (q <= 0) {
      result.push(0);
      continue;
    }
    if (q >= 1) {
      result.push(lastBound);
      continue;
    }
    const rank = q * total;
    let cumulative = 0;
    let i = 0;
    for (; i < counts.length; i++) {
      const c = typeof counts[i] === 'number' && !Number.isNaN(counts[i]) ? counts[i] : 0;
      cumulative += c;
      if (cumulative >= rank) {
        break;
      }
    }
    if (i >= bounds.length) {
      result.push(bounds[bounds.length - 1] ?? Number.NaN);
      continue;
    }
    const countInBucket = typeof counts[i] === 'number' && !Number.isNaN(counts[i]) ? counts[i] : 0;
    const prevCumulative = cumulative - countInBucket;
    const lowerBound = i > 0 ? (bounds[i - 1] ?? 0) : 0;
    const upperBound = bounds[i] ?? lowerBound;
    if (countInBucket <= 0) {
      result.push(upperBound);
      continue;
    }
    const fractionInBucket = (rank - prevCumulative) / countInBucket;
    const value = lowerBound + fractionInBucket * (upperBound - lowerBound);
    result.push(value);
  }
  return result;
}
