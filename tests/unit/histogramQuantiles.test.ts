import { boundsEqual, computeHistogramQuantiles } from '../../src/utils/histogramQuantiles';

describe('boundsEqual', () => {
  it('returns true for same length and equal values', () => {
    const a = [0, 5, 10, 50];
    const b = [0, 5, 10, 50];
    expect(boundsEqual(a, b)).toBe(true);
  });

  it('returns false when lengths differ', () => {
    expect(boundsEqual([0, 5, 10], [0, 5])).toBe(false);
    expect(boundsEqual([0, 5], [0, 5, 10])).toBe(false);
  });

  it('returns false when same length but values differ', () => {
    expect(boundsEqual([0, 5, 10], [0, 5, 20])).toBe(false);
    expect(boundsEqual([0, 5, 10], [0, 10, 10])).toBe(false);
  });

  it('returns true when both are NaN at same index', () => {
    const a = [0, Number.NaN, 10];
    const b = [0, Number.NaN, 10];
    expect(boundsEqual(a, b)).toBe(true);
  });

  it('returns false for non-arrays', () => {
    expect(boundsEqual(null, [1, 2])).toBe(false);
    expect(boundsEqual([1, 2], undefined)).toBe(false);
    expect(boundsEqual([1], '')).toBe(false);
  });
});

describe('computeHistogramQuantiles', () => {
  it('should return NaN for each quantile when total count is zero', () => {
    const bounds = [5, 10, 25, 50];
    const counts = [0, 0, 0, 0];
    const result = computeHistogramQuantiles(bounds, counts, [0.5, 0.9, 0.95, 0.99]);
    expect(result).toHaveLength(4);
    result.forEach((v) => expect(Number.isNaN(v)).toBe(true));
  });

  it('should return NaN for each quantile when bounds and counts length mismatch', () => {
    const bounds = [5, 10];
    const counts = [1, 2, 3];
    const result = computeHistogramQuantiles(bounds, counts, [0.5]);
    expect(result).toEqual([Number.NaN]);
  });

  it('should compute median (p50) in first bucket when all counts in first bucket', () => {
    const bounds = [10, 20, 50];
    const counts = [100, 0, 0];
    const result = computeHistogramQuantiles(bounds, counts, [0.5]);
    expect(result).toHaveLength(1);
    expect(result[0]).toBeGreaterThanOrEqual(0);
    expect(result[0]).toBeLessThanOrEqual(10);
  });

  it('should compute p50, p90, p95, p99 for uniform distribution', () => {
    const bounds = [10, 20, 30, 40, 50];
    const counts = [10, 10, 10, 10, 10];
    const result = computeHistogramQuantiles(bounds, counts, [0.5, 0.9, 0.95, 0.99]);
    expect(result).toHaveLength(4);
    expect(result[0]).toBeGreaterThanOrEqual(20);
    expect(result[0]).toBeLessThanOrEqual(30);
    expect(result[1]).toBeGreaterThanOrEqual(35);
    expect(result[1]).toBeLessThanOrEqual(45);
    expect(result[2]).toBeGreaterThanOrEqual(38);
    expect(result[2]).toBeLessThanOrEqual(50);
    expect(result[3]).toBeGreaterThanOrEqual(45);
    expect(result[3]).toBeLessThanOrEqual(50);
  });

  it('should return last bound when quantile rank is at or past total count', () => {
    const bounds = [5, 10, 15];
    const counts = [2, 3, 5];
    const result = computeHistogramQuantiles(bounds, counts, [1]);
    expect(result[0]).toBe(15);
  });

  it('should return 0 (implicit lower bound) for q=0', () => {
    const bounds = [5, 10, 25, 50];
    const counts = [10, 20, 30, 40];
    const result = computeHistogramQuantiles(bounds, counts, [0]);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(0);
  });

  it('should return last bound for q=1', () => {
    const bounds = [5, 10, 15];
    const counts = [2, 3, 5];
    const result = computeHistogramQuantiles(bounds, counts, [1]);
    expect(result[0]).toBe(15);
  });

  it('should return NaN for quantiles outside (0, 1)', () => {
    const bounds = [5, 10, 15];
    const counts = [2, 3, 5];
    expect(computeHistogramQuantiles(bounds, counts, [-0.1])[0]).toBeNaN();
    expect(computeHistogramQuantiles(bounds, counts, [1.5])[0]).toBeNaN();
    expect(computeHistogramQuantiles(bounds, counts, [Number.NaN])[0]).toBeNaN();
  });

  it('should return 0 for q=0 even when first bucket has zero count', () => {
    const bounds = [10, 20, 50];
    const counts = [0, 50, 50];
    const result = computeHistogramQuantiles(bounds, counts, [0]);
    expect(result[0]).toBe(0);
  });
});
