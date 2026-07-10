import { ProductionO11yApiClient } from '../../src/clients/o11yApi';
import { FetchBodyParams, QueryFilter, PredefinedMetricType } from '../../src/types';

describe('O11yApiClient - buildFetchFilters', () => {
  const createMockClient = () => {
    return new ProductionO11yApiClient('test-tenant', 'http://test-url');
  };

  it('should include app filter in base filters', () => {
    const client = createMockClient();
    const bodyParams: FetchBodyParams = {
      fromTime: 1645030240000,
      toTime: 1645030300000,
      app: 'test-app',
    };

    const filters = (client as any).buildFetchFilters(bodyParams);

    expect(filters).toHaveLength(1);
    expect(filters[0]).toEqual({
      column: 'app',
      operator: '=',
      type: 'string',
      value: 'test-app',
    });
  });

  it('should merge UI filters with base filters', () => {
    const client = createMockClient();
    const uiFilters: QueryFilter[] = [
      {
        column: 'account',
        operator: '=',
        type: 'string',
        value: 'test-account',
      },
    ];

    const bodyParams: FetchBodyParams = {
      fromTime: 1645030240000,
      toTime: 1645030300000,
      app: 'test-app',
      filters: uiFilters,
    };

    const filters = (client as any).buildFetchFilters(bodyParams);

    expect(filters).toHaveLength(2);
    expect(filters[0].column).toBe('app');
    expect(filters[1]).toEqual(uiFilters[0]);
  });

  it('should preserve base filter when UI filter has matching column and operator', () => {
    const client = createMockClient();
    const uiFilters: QueryFilter[] = [
      {
        column: 'app',
        operator: '=',
        type: 'string',
        value: 'ui-app-value', // Different from bodyParams.app
      },
    ];

    const bodyParams: FetchBodyParams = {
      fromTime: 1645030240000,
      toTime: 1645030300000,
      app: 'base-app-value',
      filters: uiFilters,
    };

    const filters = (client as any).buildFetchFilters(bodyParams);

    expect(filters).toHaveLength(1);
    expect(filters[0].value).toBe('base-app-value');
  });

  it('should preserve predefined metric filters when UI filters have matching column and operator', () => {
    const client = createMockClient();
    const uiFilters: QueryFilter[] = [
      {
        column: 'MetricName',
        operator: '=',
        type: 'string',
        value: 'attacker-controlled-metric',
      },
    ];

    const bodyParams: FetchBodyParams = {
      fromTime: 1645030240000,
      toTime: 1645030300000,
      app: 'test-app',
      predefinedMetric: PredefinedMetricType.REQUEST_RATE,
      filters: uiFilters,
    };

    const filters = (client as any).buildFetchFilters(bodyParams);

    expect(filters).toHaveLength(2);
    expect(filters.find((f: QueryFilter) => f.column === 'MetricName')?.value).toBe(
      'runtime_http_requests_total'
    );
  });

  it('should handle multiple UI filters', () => {
    const client = createMockClient();
    const uiFilters: QueryFilter[] = [
      {
        column: 'account',
        operator: '=',
        type: 'string',
        value: 'account1',
      },
      {
        column: 'level',
        operator: '=',
        type: 'string',
        value: 'error',
      },
    ];

    const bodyParams: FetchBodyParams = {
      fromTime: 1645030240000,
      toTime: 1645030300000,
      app: 'test-app',
      filters: uiFilters,
    };

    const filters = (client as any).buildFetchFilters(bodyParams);

    expect(filters.length).toBeGreaterThanOrEqual(3); // app + 2 UI filters
    expect(filters.find((f: QueryFilter) => f.column === 'account')).toBeDefined();
    expect(filters.find((f: QueryFilter) => f.column === 'level')).toBeDefined();
  });

  it('should handle empty UI filters array', () => {
    const client = createMockClient();
    const bodyParams: FetchBodyParams = {
      fromTime: 1645030240000,
      toTime: 1645030300000,
      app: 'test-app',
      filters: [],
    };

    const filters = (client as any).buildFetchFilters(bodyParams);

    expect(filters).toHaveLength(1);
    expect(filters[0].column).toBe('app');
  });

  it('should handle undefined filters', () => {
    const client = createMockClient();
    const bodyParams: FetchBodyParams = {
      fromTime: 1645030240000,
      toTime: 1645030300000,
      app: 'test-app',
    };

    const filters = (client as any).buildFetchFilters(bodyParams);

    expect(filters).toHaveLength(1);
    expect(filters[0].column).toBe('app');
  });

  it('should add MetricName and MetricType filters for LATENCY_STATS_BY_ACCOUNT_AND_HANDLER', () => {
    const client = createMockClient();
    const bodyParams: FetchBodyParams = {
      fromTime: 1645030240000,
      toTime: 1645030300000,
      app: 'test-app',
      predefinedMetric: PredefinedMetricType.LATENCY_STATS_BY_ACCOUNT_AND_HANDLER,
    };

    const filters = (client as any).buildFetchFilters(bodyParams);

    expect(filters).toHaveLength(3); // app + MetricName + MetricType
    expect(filters.find((f: QueryFilter) => f.column === 'app')).toBeDefined();
    expect(filters.find((f: QueryFilter) => f.column === 'MetricName' && f.value === 'runtime_http_requests_duration_milliseconds')).toBeDefined();
    expect(filters.find((f: QueryFilter) => f.column === 'MetricType' && f.value === 'histogram')).toBeDefined();
  });

  it('should add MetricName and MetricType filters for LATENCY_STATS_PER_ACCOUNT', () => {
    const client = createMockClient();
    const bodyParams: FetchBodyParams = {
      fromTime: 1645030240000,
      toTime: 1645030300000,
      app: 'test-app',
      predefinedMetric: PredefinedMetricType.LATENCY_STATS_PER_ACCOUNT,
    };

    const filters = (client as any).buildFetchFilters(bodyParams);

    expect(filters).toHaveLength(3); // app + MetricName + MetricType
    expect(filters.find((f: QueryFilter) => f.column === 'MetricName' && f.value === 'runtime_http_requests_duration_milliseconds')).toBeDefined();
    expect(filters.find((f: QueryFilter) => f.column === 'MetricType' && f.value === 'histogram')).toBeDefined();
  });

  it('should add MetricName and MetricType filters for LATENCY_P50_PER_HANDLER, LATENCY_P90_PER_HANDLER, LATENCY_P99_PER_HANDLER', () => {
    const client = createMockClient();
    for (const predefinedMetric of [
      PredefinedMetricType.LATENCY_P50_PER_HANDLER,
      PredefinedMetricType.LATENCY_P90_PER_HANDLER,
      PredefinedMetricType.LATENCY_P99_PER_HANDLER,
    ]) {
      const bodyParams: FetchBodyParams = {
        fromTime: 1645030240000,
        toTime: 1645030300000,
        app: 'test-app',
        predefinedMetric,
      };
      const filters = (client as any).buildFetchFilters(bodyParams);
      expect(filters).toHaveLength(3);
      expect(filters.find((f: QueryFilter) => f.column === 'MetricName' && f.value === 'runtime_http_requests_duration_milliseconds')).toBeDefined();
      expect(filters.find((f: QueryFilter) => f.column === 'MetricType' && f.value === 'histogram')).toBeDefined();
    }
  });
});

describe('O11yApiClient - buildMetricsColumns', () => {
  const createMockClient = () => {
    return new ProductionO11yApiClient('test-tenant', 'http://test-url');
  };

  const baseColumns = ['TimestampTime', 'account', 'MetricName', 'MetricType', 'app'];

  it('should return error rate columns for ERROR_RATE_BY_HANDLER', () => {
    const client = createMockClient();
    const columns = (client as any).buildMetricsColumns(PredefinedMetricType.ERROR_RATE_BY_HANDLER);

    expect(columns).toEqual([
      'TimestampTime',
      'app',
      "ifNull(Attributes['handler'], 'unknown') as handler",
      'count() AS total_requests',
      "countIf(toUInt16(Attributes['status_code']) >= 400) AS error_count",
      'if(total_requests = 0, 0, (error_count / total_requests) * 100) AS error_rate',
    ]);
  });

  it('should return base columns plus sumMerge(Sum) for REQUEST_RATE', () => {
    const client = createMockClient();
    const columns = (client as any).buildMetricsColumns(PredefinedMetricType.REQUEST_RATE);

    expect(columns).toEqual([...baseColumns, 'sumMerge(Sum) as Sum']);
  });

  it('should return fallback columns when predefinedMetric is undefined', () => {
    const client = createMockClient();
    const columns = (client as any).buildMetricsColumns(undefined);

    expect(columns).toEqual([...baseColumns, 'sumMerge(Sum) as Sum']);
  });

  it('should return latency stats columns for LATENCY_STATS_BY_ACCOUNT_AND_HANDLER', () => {
    const client = createMockClient();
    const columns = (client as any).buildMetricsColumns(PredefinedMetricType.LATENCY_STATS_BY_ACCOUNT_AND_HANDLER);

    expect(columns).toContain('TimestampTime');
    expect(columns).toContain('account');
    expect(columns).toContain("ifNull(Attributes['handler'], 'unknown') as handler");
    expect(columns).toContain('anyMerge(ExplicitBounds) AS ExplicitBounds');
    expect(columns).toContain('sumForEachMerge(BucketCounts) AS BucketCounts');
    expect(columns).toHaveLength(5);
  });

  it('should return latency stats columns without handler for LATENCY_STATS_PER_ACCOUNT', () => {
    const client = createMockClient();
    const columns = (client as any).buildMetricsColumns(PredefinedMetricType.LATENCY_STATS_PER_ACCOUNT);

    expect(columns).toEqual([
      'TimestampTime',
      'account',
      'anyMerge(ExplicitBounds) AS ExplicitBounds',
      'sumForEachMerge(BucketCounts) AS BucketCounts',
    ]);
    expect(columns).not.toContain("ifNull(Attributes['handler'], 'unknown') as handler");
    expect(columns).toHaveLength(4);
  });

  it('should return same latency stats columns as BY_ACCOUNT_AND_HANDLER for LATENCY_P50_PER_HANDLER, P90, P99', () => {
    const client = createMockClient();
    const expected = [
      'TimestampTime',
      'account',
      "ifNull(Attributes['handler'], 'unknown') as handler",
      'anyMerge(ExplicitBounds) AS ExplicitBounds',
      'sumForEachMerge(BucketCounts) AS BucketCounts',
    ];
    for (const predefinedMetric of [
      PredefinedMetricType.LATENCY_P50_PER_HANDLER,
      PredefinedMetricType.LATENCY_P90_PER_HANDLER,
      PredefinedMetricType.LATENCY_P99_PER_HANDLER,
    ]) {
      const columns = (client as any).buildMetricsColumns(predefinedMetric);
      expect(columns).toEqual(expected);
    }
  });
});
