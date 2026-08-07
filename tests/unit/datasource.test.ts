import { DataSource } from '../../src/datasource';
import { DataSourceInstanceSettings, FieldType, DataFrameType, QueryFixAction, SupplementaryQueryType, DataQueryRequest } from '@grafana/data';
import { AppQuery, QueryType, QueryFilter, O11yQueryResponse, PredefinedMetricType } from '../../src/types';
import { O11Y_API_TIMESTAMP_COLUMN } from '../../src/clients/o11yApi';

describe('DataSource - createLogsDataFrame', () => {
  const createMockDataSource = () => {
    const instanceSettings = {
      jsonData: { tenant: 'test-tenant', appKey: 'test-key' },
      url: 'http://test-url',
    } as DataSourceInstanceSettings<any>;

    return new DataSource(instanceSettings);
  };

  const createMockApiResponse = (fields: Array<{ name: string; type: string; values: any[] }>): O11yQueryResponse => {
    return {
      refId: 'A',
      name: 'logs',
      fields,
    };
  };

  it('should create log data frame with required fields (timestamp, body, labels)', () => {
    const datasource = createMockDataSource();
    const apiResponse = createMockApiResponse([
      {
        name: O11Y_API_TIMESTAMP_COLUMN,
        type: 'time',
        values: [1645030244810, 1645030247027],
      },
      {
        name: 'body',
        type: 'string',
        values: ['message one', 'message two'],
      },
    ]);

    const dataFrame = (datasource as any).createLogsDataFrame('A', apiResponse);

    expect(dataFrame.fields).toHaveLength(3); // timestamp, body, labels
    expect(dataFrame.fields[0].name).toBe('timestamp');
    expect(dataFrame.fields[0].type).toBe(FieldType.time);
    expect(dataFrame.fields[1].name).toBe('body');
    expect(dataFrame.fields[1].type).toBe(FieldType.string);
    expect(dataFrame.fields[2].name).toBe('labels');
    expect(dataFrame.fields[2].type).toBe(FieldType.other);
    expect(dataFrame.meta?.type).toBe(DataFrameType.LogLines);
    expect(dataFrame.meta?.preferredVisualisationType).toBe('logs');
  });

  it('should create individual fields for each attribute', () => {
    const datasource = createMockDataSource();
    const apiResponse = createMockApiResponse([
      {
        name: O11Y_API_TIMESTAMP_COLUMN,
        type: 'time',
        values: [1645030244810, 1645030247027],
      },
      {
        name: 'body',
        type: 'string',
        values: ['message one', 'message two'],
      },
      {
        name: 'account',
        type: 'string',
        values: ['account1', 'account2'],
      },
      {
        name: 'level',
        type: 'string',
        values: ['info', 'error'],
      },
    ]);

    const dataFrame = (datasource as any).createLogsDataFrame('A', apiResponse);

    // Should have: timestamp, body, account, level, labels
    expect(dataFrame.fields.length).toBeGreaterThanOrEqual(5);
    expect(dataFrame.fields.find((f: any) => f.name === 'account')).toBeDefined();
    expect(dataFrame.fields.find((f: any) => f.name === 'level')).toBeDefined();
    expect(dataFrame.fields.find((f: any) => f.name === 'labels')).toBeDefined();
  });

  it('should determine field type as number when all values are numbers', () => {
    const datasource = createMockDataSource();
    const apiResponse = createMockApiResponse([
      {
        name: O11Y_API_TIMESTAMP_COLUMN,
        type: 'time',
        values: [1645030244810],
      },
      {
        name: 'body',
        type: 'string',
        values: ['message'],
      },
      {
        name: 'statusCode',
        type: 'number',
        values: [200],
      },
    ]);

    const dataFrame = (datasource as any).createLogsDataFrame('A', apiResponse);
    const statusCodeField = dataFrame.fields.find((f: any) => f.name === 'statusCode');

    expect(statusCodeField).toBeDefined();
    expect(statusCodeField.type).toBe(FieldType.number);
  });

  it('should determine field type as boolean when all values are booleans', () => {
    const datasource = createMockDataSource();
    const apiResponse = createMockApiResponse([
      {
        name: O11Y_API_TIMESTAMP_COLUMN,
        type: 'time',
        values: [1645030244810],
      },
      {
        name: 'body',
        type: 'string',
        values: ['message'],
      },
      {
        name: 'isError',
        type: 'boolean',
        values: [true],
      },
    ]);

    const dataFrame = (datasource as any).createLogsDataFrame('A', apiResponse);
    const isErrorField = dataFrame.fields.find((f: any) => f.name === 'isError');

    expect(isErrorField).toBeDefined();
    expect(isErrorField.type).toBe(FieldType.boolean);
  });

  it('should handle missing attribute values with null', () => {
    const datasource = createMockDataSource();
    const apiResponse = createMockApiResponse([
      {
        name: O11Y_API_TIMESTAMP_COLUMN,
        type: 'time',
        values: [1645030244810, 1645030247027],
      },
      {
        name: 'body',
        type: 'string',
        values: ['message one', 'message two'],
      },
      {
        name: 'account',
        type: 'string',
        values: ['account1'], // Only one value for two rows
      },
    ]);

    const dataFrame = (datasource as any).createLogsDataFrame('A', apiResponse);
    const accountField = dataFrame.fields.find((f: any) => f.name === 'account');

    expect(accountField).toBeDefined();
    expect(accountField.values.length).toBe(2);
    expect(accountField.values[0]).toBe('account1');
    expect(accountField.values[1]).toBeNull();
  });

  it('should maintain labels field for backward compatibility', () => {
    const datasource = createMockDataSource();
    const apiResponse = createMockApiResponse([
      {
        name: O11Y_API_TIMESTAMP_COLUMN,
        type: 'time',
        values: [1645030244810],
      },
      {
        name: 'body',
        type: 'string',
        values: ['message'],
      },
      {
        name: 'account',
        type: 'string',
        values: ['account1'],
      },
    ]);

    const dataFrame = (datasource as any).createLogsDataFrame('A', apiResponse);
    const labelsField = dataFrame.fields.find((f: any) => f.name === 'labels');

    expect(labelsField).toBeDefined();
    expect(labelsField.type).toBe(FieldType.other);
    expect(labelsField.values[0]).toEqual({ account: 'account1' });
  });
});

describe('DataSource - filter handling', () => {
  const createMockDataSource = () => {
    const instanceSettings = {
      jsonData: { tenant: 'test-tenant', appKey: 'test-key' },
      url: 'http://test-url',
    } as DataSourceInstanceSettings<any>;

    return new DataSource(instanceSettings);
  };

  it('should pass filters from query.filters to FetchBodyParams', async () => {
    const datasource = createMockDataSource();
    const mockFetchLogs = jest.fn().mockResolvedValue({
      refId: 'A',
      name: 'logs',
      fields: [
        {
          name: O11Y_API_TIMESTAMP_COLUMN,
          type: 'time',
          values: [1645030244810],
        },
        {
          name: 'body',
          type: 'string',
          values: ['message'],
        },
      ],
    });

    (datasource as any).http = {
      FetchLogs: mockFetchLogs,
    };

    const query: AppQuery = {
      refId: 'A',
      queryType: QueryType.logs,
      appName: 'test-app',
      filters: [
        {
          column: 'account',
          operator: '=',
          type: 'string',
          value: 'test-account',
        },
      ],
      orders: [],
      pageSize: 100,
    };

    await (datasource as any).fetchDataFromAPI(query, 1645030240000, 1645030300000);

    expect(mockFetchLogs).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: [
          {
            column: 'account',
            operator: '=',
            type: 'string',
            value: 'test-account',
          },
        ],
      })
    );
  });
});

describe('DataSource - getPageSizeForMetricsQuery', () => {
  const createMockDataSource = () => {
    const instanceSettings = {
      jsonData: { tenant: 'test-tenant', appKey: 'test-key' },
      url: 'http://test-url',
    } as DataSourceInstanceSettings<any>;
    return new DataSource(instanceSettings);
  };

  const baseQuery: Partial<AppQuery> = {
    refId: 'A',
    appName: 'test-app',
    filters: [],
    orders: [],
  };

  it('returns query.pageSize for logs queries', () => {
    const ds = createMockDataSource();
    expect((ds as any).getPageSizeForMetricsQuery({ ...baseQuery, queryType: QueryType.logs, pageSize: 50 })).toBe(50);
    expect((ds as any).getPageSizeForMetricsQuery({ ...baseQuery, queryType: QueryType.logs })).toBe(100);
  });

  it('returns query.pageSize for non-latency-chart metrics', () => {
    const ds = createMockDataSource();
    const q = { ...baseQuery, queryType: QueryType.metrics, predefinedMetric: PredefinedMetricType.REQUEST_RATE, pageSize: 200 };
    expect((ds as any).getPageSizeForMetricsQuery(q)).toBe(200);
  });

  it('for latency chart metrics uses at least 500 and at most 5000, respecting user pageSize in between', () => {
    const ds = createMockDataSource();
    const latencyQuery = (pageSize?: number) => ({
      ...baseQuery,
      queryType: QueryType.metrics,
      predefinedMetric: PredefinedMetricType.LATENCY_P50_PER_HANDLER,
      pageSize,
    });
    // Below minimum: raised to 500
    expect((ds as any).getPageSizeForMetricsQuery(latencyQuery(100))).toBe(500);
    expect((ds as any).getPageSizeForMetricsQuery(latencyQuery(undefined))).toBe(500); // undefined → 100, then max(100,500)=500
    // In range: user value
    expect((ds as any).getPageSizeForMetricsQuery(latencyQuery(500))).toBe(500);
    expect((ds as any).getPageSizeForMetricsQuery(latencyQuery(1000))).toBe(1000);
    expect((ds as any).getPageSizeForMetricsQuery(latencyQuery(3000))).toBe(3000);
    // Above cap: capped at 5000
    expect((ds as any).getPageSizeForMetricsQuery(latencyQuery(5000))).toBe(5000);
    expect((ds as any).getPageSizeForMetricsQuery(latencyQuery(10000))).toBe(5000);
  });

  it('applies same min/max for P90 and P99 latency chart metrics', () => {
    const ds = createMockDataSource();
    const q90 = { ...baseQuery, queryType: QueryType.metrics, predefinedMetric: PredefinedMetricType.LATENCY_P90_PER_HANDLER, pageSize: 200 };
    const q99 = { ...baseQuery, queryType: QueryType.metrics, predefinedMetric: PredefinedMetricType.LATENCY_P99_PER_HANDLER, pageSize: 2000 };
    expect((ds as any).getPageSizeForMetricsQuery(q90)).toBe(500);
    expect((ds as any).getPageSizeForMetricsQuery(q99)).toBe(2000);
  });
});

describe('DataSource - modifyQuery', () => {
  const createMockDataSource = () => {
    const instanceSettings = {
      jsonData: { tenant: 'test-tenant', appKey: 'test-key' },
      url: 'http://test-url',
    } as DataSourceInstanceSettings<any>;

    return new DataSource(instanceSettings);
  };

  it('should add filter when ADD_FILTER action is used', () => {
    const datasource = createMockDataSource();
    const query: AppQuery = {
      refId: 'A',
      queryType: QueryType.logs,
      appName: 'test-app',
      filters: [],
      orders: [],
      pageSize: 100,
    };

    const action: QueryFixAction = {
      type: 'ADD_FILTER',
      options: {
        key: 'account',
        value: 'test-account',
      },
    };

    const modifiedQuery = datasource.modifyQuery(query, action);

    expect(modifiedQuery.filters).toHaveLength(1);
    expect(modifiedQuery.filters[0]).toEqual({
      column: 'account',
      operator: '=',
      type: 'string',
      value: 'test-account',
    });
  });

  it('should add filter_out when ADD_FILTER_OUT action is used', () => {
    const datasource = createMockDataSource();
    const query: AppQuery = {
      refId: 'A',
      queryType: QueryType.logs,
      appName: 'test-app',
      filters: [],
      orders: [],
      pageSize: 100,
    };

    const action: QueryFixAction = {
      type: 'ADD_FILTER_OUT',
      options: {
        key: 'account',
        value: 'test-account',
      },
    };

    const modifiedQuery = datasource.modifyQuery(query, action);

    expect(modifiedQuery.filters).toHaveLength(1);
    expect(modifiedQuery.filters[0]).toEqual({
      column: 'account',
      operator: '!=',
      type: 'string',
      value: 'test-account',
    });
  });

  it('should replace existing filter when same column and operator', () => {
    const datasource = createMockDataSource();
    const query: AppQuery = {
      refId: 'A',
      queryType: QueryType.logs,
      appName: 'test-app',
      filters: [
        {
          column: 'account',
          operator: '=',
          type: 'string',
          value: 'old-account',
        },
      ],
      orders: [],
      pageSize: 100,
    };

    const action: QueryFixAction = {
      type: 'ADD_FILTER',
      options: {
        key: 'account',
        value: 'new-account',
      },
    };

    const modifiedQuery = datasource.modifyQuery(query, action);

    expect(modifiedQuery.filters).toHaveLength(1);
    expect(modifiedQuery.filters[0].value).toBe('new-account');
  });

  it('should add multiple filters for different columns', () => {
    const datasource = createMockDataSource();
    const query: AppQuery = {
      refId: 'A',
      queryType: QueryType.logs,
      appName: 'test-app',
      filters: [],
      orders: [],
      pageSize: 100,
    };

    const action1: QueryFixAction = {
      type: 'ADD_FILTER',
      options: {
        key: 'account',
        value: 'account1',
      },
    };

    const action2: QueryFixAction = {
      type: 'ADD_FILTER',
      options: {
        key: 'level',
        value: 'error',
      },
    };

    let modifiedQuery = datasource.modifyQuery(query, action1);
    modifiedQuery = datasource.modifyQuery(modifiedQuery, action2);

    expect(modifiedQuery.filters).toHaveLength(2);
    expect(modifiedQuery.filters.find((f) => f.column === 'account')).toBeDefined();
    expect(modifiedQuery.filters.find((f) => f.column === 'level')).toBeDefined();
  });

  it('should handle ADD_FILTER and ADD_FILTER_OUT for same column', () => {
    const datasource = createMockDataSource();
    const query: AppQuery = {
      refId: 'A',
      queryType: QueryType.logs,
      appName: 'test-app',
      filters: [],
      orders: [],
      pageSize: 100,
    };

    const filterAction: QueryFixAction = {
      type: 'ADD_FILTER',
      options: {
        key: 'account',
        value: 'account1',
      },
    };

    const filterOutAction: QueryFixAction = {
      type: 'ADD_FILTER_OUT',
      options: {
        key: 'account',
        value: 'account2',
      },
    };

    let modifiedQuery = datasource.modifyQuery(query, filterAction);
    modifiedQuery = datasource.modifyQuery(modifiedQuery, filterOutAction);

    // When filtering by column name only, the second filter replaces the first
    expect(modifiedQuery.filters).toHaveLength(1);
    expect(modifiedQuery.filters[0].operator).toBe('!=');
    expect(modifiedQuery.filters[0].value).toBe('account2');
  });
});

describe('DataSource - calcVolumeBucketMs', () => {
  const createMockDataSource = () => {
    const instanceSettings = {
      jsonData: { tenant: 'test-tenant', appKey: 'test-key' },
      url: 'http://test-url',
    } as DataSourceInstanceSettings<any>;

    return new DataSource(instanceSettings);
  };

  const SECOND = 1000;
  const MINUTE = 60 * SECOND;
  const HOUR = 60 * MINUTE;
  const DAY = 24 * HOUR;

  const calcBucket = (fromTime: number, toTime: number) =>
    (createMockDataSource() as any).calcVolumeBucketMs(fromTime, toTime);

  it('returns 10s for ranges up to 15 minutes', () => {
    expect(calcBucket(0, 15 * MINUTE)).toBe(10 * SECOND);
    expect(calcBucket(0, 5 * MINUTE)).toBe(10 * SECOND);
  });

  it('returns 30s for ranges between 15 minutes and 1 hour', () => {
    expect(calcBucket(0, 15 * MINUTE + 1)).toBe(30 * SECOND);
    expect(calcBucket(0, HOUR)).toBe(30 * SECOND);
  });

  it('returns 5 minutes for ranges between 1 hour and 6 hours', () => {
    expect(calcBucket(0, HOUR + 1)).toBe(5 * MINUTE);
    expect(calcBucket(0, 6 * HOUR)).toBe(5 * MINUTE);
  });

  it('returns 15 minutes for ranges between 6 hours and 1 day', () => {
    expect(calcBucket(0, 6 * HOUR + 1)).toBe(15 * MINUTE);
    expect(calcBucket(0, DAY)).toBe(15 * MINUTE);
  });

  it('returns 1 hour for ranges between 1 day and 7 days', () => {
    expect(calcBucket(0, DAY + 1)).toBe(HOUR);
    expect(calcBucket(0, 7 * DAY)).toBe(HOUR);
  });

  it('returns 1 day for ranges beyond 7 days', () => {
    expect(calcBucket(0, 7 * DAY + 1)).toBe(DAY);
    expect(calcBucket(0, 30 * DAY)).toBe(DAY);
  });

  it('uses the delta between fromTime and toTime, not absolute values', () => {
    const offset = 1_000_000_000;
    expect(calcBucket(offset, offset + 15 * MINUTE)).toBe(10 * SECOND);
    expect(calcBucket(offset, offset + HOUR + 1)).toBe(5 * MINUTE);
  });

  it('returns 10s for zero-length and inverted ranges', () => {
    expect(calcBucket(1000, 1000)).toBe(10 * SECOND);
    expect(calcBucket(2000, 1000)).toBe(10 * SECOND);
  });
});

describe('DataSource - createLogsVolumeDataFrames', () => {
  const createMockDataSource = () => {
    const instanceSettings = {
      jsonData: { tenant: 'test-tenant', appKey: 'test-key' },
      url: 'http://test-url',
      name: 'VTEX O11y',
    } as DataSourceInstanceSettings<any>;

    return new DataSource(instanceSettings);
  };

  const createMockApiResponse = (fields: Array<{ name: string; type: string; values: any[] }>): O11yQueryResponse => ({
    refId: 'A',
    name: 'logs',
    fields,
  });

  const baseQuery: AppQuery = {
    refId: 'A',
    queryType: QueryType.logs,
    appName: 'vtex.test-app@1.0.0',
    filters: [],
    orders: [],
    pageSize: 100,
  };

  const SECOND = 1000;
  const MINUTE = 60 * SECOND;

  it('returns empty array when TimestampTime field is missing', () => {
    const datasource = createMockDataSource();
    const response = createMockApiResponse([{ name: 'level', type: 'string', values: ['info'] }]);

    const result = (datasource as any).createLogsVolumeDataFrames('A', response, 0, MINUTE, baseQuery);

    expect(result).toEqual([]);
  });

  it('returns a single all-zero "unknown" series when there are no log rows', () => {
    const datasource = createMockDataSource();
    const from = 0;
    const to = 15 * MINUTE;
    const response = createMockApiResponse([
      { name: O11Y_API_TIMESTAMP_COLUMN, type: 'time', values: [] },
    ]);

    const result = (datasource as any).createLogsVolumeDataFrames('A', response, from, to, baseQuery);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('unknown');
    const valueField = result[0].fields.find((f: any) => f.name === 'Value');
    expect(valueField).toBeDefined();
    expect(valueField.values.every((v: number) => v === 0)).toBe(true);
    expect(valueField.values.length).toBeGreaterThan(0);
  });

  it('creates one DataFrame per distinct level', () => {
    const datasource = createMockDataSource();
    const t = 5 * MINUTE;
    const response = createMockApiResponse([
      { name: O11Y_API_TIMESTAMP_COLUMN, type: 'time', values: [t, t, t] },
      { name: 'level', type: 'string', values: ['info', 'error', 'info'] },
    ]);

    const result = (datasource as any).createLogsVolumeDataFrames('A', response, 0, 15 * MINUTE, baseQuery);

    expect(result).toHaveLength(2);
    const levels = result.map((df: any) => df.name);
    expect(levels).toContain('info');
    expect(levels).toContain('error');
  });

  it('counts rows into the correct time buckets', () => {
    const datasource = createMockDataSource();
    const BUCKET = 10 * SECOND;
    const from = 0;
    const to = 15 * MINUTE;
    // Two events in bucket 0 (t=0s and t=5s → both floor to bucket 0), one in bucket 1 (t=10s)
    const response = createMockApiResponse([
      { name: O11Y_API_TIMESTAMP_COLUMN, type: 'time', values: [0, 5 * SECOND, BUCKET] },
      { name: 'level', type: 'string', values: ['info', 'info', 'info'] },
    ]);

    const result = (datasource as any).createLogsVolumeDataFrames('A', response, from, to, baseQuery);

    expect(result).toHaveLength(1);
    const timeField = result[0].fields.find((f: any) => f.name === 'Time');
    const valueField = result[0].fields.find((f: any) => f.name === 'Value');

    // Time field starts at floor(from / bucketMs) * bucketMs and is evenly spaced
    expect(timeField.values[0]).toBe(0);
    expect(timeField.values[1]).toBe(BUCKET);
    expect(timeField.values[1] - timeField.values[0]).toBe(BUCKET);

    // Bucket 0 → 2 rows, bucket 1 → 1 row
    expect(valueField.values[0]).toBe(2);
    expect(valueField.values[1]).toBe(1);

    // Time and Value arrays have equal length
    expect(timeField.values.length).toBe(valueField.values.length);
    // 15min range / 10s buckets = 90 buckets + 1 (inclusive end)
    expect(timeField.values.length).toBe(91);
  });

  it('zero-fills buckets with no events', () => {
    const datasource = createMockDataSource();
    const from = 0;
    const to = 15 * MINUTE;
    // Single event only at bucket 0
    const response = createMockApiResponse([
      { name: O11Y_API_TIMESTAMP_COLUMN, type: 'time', values: [0] },
      { name: 'level', type: 'string', values: ['warn'] },
    ]);

    const result = (datasource as any).createLogsVolumeDataFrames('A', response, from, to, baseQuery);

    const valueField = result[0].fields.find((f: any) => f.name === 'Value');
    // All buckets except the first should be zero
    expect(valueField.values[0]).toBe(1);
    expect(valueField.values.slice(1).every((v: number) => v === 0)).toBe(true);
  });

  it('defaults to "unknown" level when level field is absent', () => {
    const datasource = createMockDataSource();
    const from = 0;
    const to = 15 * MINUTE;
    const response = createMockApiResponse([
      { name: O11Y_API_TIMESTAMP_COLUMN, type: 'time', values: [0] },
    ]);

    const result = (datasource as any).createLogsVolumeDataFrames('A', response, from, to, baseQuery);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('unknown');
  });

  it('sets correct DataFrame meta, refId, labels, displayNameFromDS, and datasourceName', () => {
    const datasource = createMockDataSource();
    const from = 0;
    const to = 15 * MINUTE;
    const response = createMockApiResponse([
      { name: O11Y_API_TIMESTAMP_COLUMN, type: 'time', values: [0] },
      { name: 'level', type: 'string', values: ['info'] },
    ]);

    const result = (datasource as any).createLogsVolumeDataFrames('A', response, from, to, baseQuery);
    const df = result[0];

    expect(df.refId).toBe('A');
    expect(df.meta?.type).toBe(DataFrameType.TimeSeriesMany);
    expect(df.meta?.preferredVisualisationType).toBe('graph');
    expect((df.meta?.custom as any)?.logsVolumeType).toBeDefined();
    expect((df.meta?.custom as any)?.absoluteRange).toEqual({ from, to });
    expect((df.meta?.custom as any)?.datasourceName).toBe('VTEX O11y');
    expect((df.meta?.custom as any)?.sourceQuery).toEqual(baseQuery);

    const valueField = df.fields.find((f: any) => f.name === 'Value');
    expect(valueField.labels).toEqual({ level: 'info' });
    expect(valueField.config?.displayNameFromDS).toBe('info');
  });

  it('parses ISO string timestamps correctly', () => {
    const datasource = createMockDataSource();
    const isoTs = '2024-01-01T00:00:00.000Z';
    const tsMs = new Date(isoTs).getTime();
    const from = tsMs - MINUTE;
    const to = tsMs + 15 * MINUTE;
    const response = createMockApiResponse([
      { name: O11Y_API_TIMESTAMP_COLUMN, type: 'time', values: [isoTs] },
      { name: 'level', type: 'string', values: ['debug'] },
    ]);

    const result = (datasource as any).createLogsVolumeDataFrames('A', response, from, to, baseQuery);

    expect(result).toHaveLength(1);
    const valueField = result[0].fields.find((f: any) => f.name === 'Value');
    const totalCount = valueField.values.reduce((sum: number, v: number) => sum + v, 0);
    expect(totalCount).toBe(1);
  });

  it('distributes counts independently across levels when they land in different buckets', () => {
    const datasource = createMockDataSource();
    const BUCKET = 10 * SECOND;
    const from = 0;
    const to = 15 * MINUTE;
    const response = createMockApiResponse([
      { name: O11Y_API_TIMESTAMP_COLUMN, type: 'time', values: [0, 0, BUCKET * 5, BUCKET * 5, BUCKET * 5] },
      { name: 'level', type: 'string', values: ['info', 'info', 'error', 'error', 'error'] },
    ]);

    const result = (datasource as any).createLogsVolumeDataFrames('A', response, from, to, baseQuery);

    expect(result).toHaveLength(2);
    const infoDf = result.find((df: any) => df.name === 'info');
    const errorDf = result.find((df: any) => df.name === 'error');
    const infoValues = infoDf.fields.find((f: any) => f.name === 'Value');
    const errorValues = errorDf.fields.find((f: any) => f.name === 'Value');

    // info: 2 events in bucket 0, zero elsewhere
    expect(infoValues.values[0]).toBe(2);
    expect(infoValues.values[5]).toBe(0);
    // error: zero in bucket 0, 3 events in bucket 5
    expect(errorValues.values[0]).toBe(0);
    expect(errorValues.values[5]).toBe(3);

    // Both share the same bucket timeline
    const infoTimes = infoDf.fields.find((f: any) => f.name === 'Time');
    const errorTimes = errorDf.fields.find((f: any) => f.name === 'Time');
    expect(infoTimes.values).toEqual(errorTimes.values);
  });

  it('maps null and undefined level values to "unknown"', () => {
    const datasource = createMockDataSource();
    const from = 0;
    const to = 15 * MINUTE;
    const response = createMockApiResponse([
      { name: O11Y_API_TIMESTAMP_COLUMN, type: 'time', values: [0, SECOND, 2 * SECOND] },
      { name: 'level', type: 'string', values: [null, undefined, 'info'] },
    ]);

    const result = (datasource as any).createLogsVolumeDataFrames('A', response, from, to, baseQuery);

    const levels = result.map((df: any) => df.name);
    expect(levels).toContain('unknown');
    expect(levels).toContain('info');

    const unknownDf = result.find((df: any) => df.name === 'unknown');
    const unknownValues = unknownDf.fields.find((f: any) => f.name === 'Value');
    const totalUnknown = unknownValues.values.reduce((sum: number, v: number) => sum + v, 0);
    expect(totalUnknown).toBe(2);
  });
});

describe('DataSource - supplementary query wiring', () => {
  const createMockDataSource = () => {
    const instanceSettings = {
      jsonData: { tenant: 'test-tenant', appKey: 'test-key' },
      url: 'http://test-url',
    } as DataSourceInstanceSettings<any>;

    return new DataSource(instanceSettings);
  };

  const logsQuery: AppQuery = {
    refId: 'A',
    queryType: QueryType.logs,
    appName: 'vtex.test-app@1.0.0',
    filters: [],
    orders: [],
    pageSize: 100,
  };

  const metricsQuery: AppQuery = {
    ...logsQuery,
    refId: 'B',
    queryType: QueryType.metrics,
  };

  it('reports LogsVolume as the only supported supplementary query type', () => {
    const datasource = createMockDataSource();
    const types = datasource.getSupportedSupplementaryQueryTypes();
    expect(types).toEqual([SupplementaryQueryType.LogsVolume]);
  });

  it('returns a logsVolume query for a logs source query', () => {
    const datasource = createMockDataSource();
    const result = datasource.getSupplementaryQuery({ type: SupplementaryQueryType.LogsVolume }, logsQuery);

    expect(result).toBeDefined();
    expect(result!.queryType).toBe(QueryType.logsVolume);
    expect(result!.refId).toBe('logs-volume-A');
    expect(result!.appName).toBe(logsQuery.appName);
  });

  it('returns undefined for a metrics source query', () => {
    const datasource = createMockDataSource();
    const result = datasource.getSupplementaryQuery({ type: SupplementaryQueryType.LogsVolume }, metricsQuery);
    expect(result).toBeUndefined();
  });

  it('returns undefined for an unsupported supplementary type', () => {
    const datasource = createMockDataSource();
    const result = datasource.getSupplementaryQuery({ type: SupplementaryQueryType.LogsSample }, logsQuery);
    expect(result).toBeUndefined();
  });

  it('getSupplementaryRequest filters targets to only logs queries', () => {
    const datasource = createMockDataSource();
    const request = {
      targets: [logsQuery, metricsQuery],
    } as DataQueryRequest<AppQuery>;

    const result = datasource.getSupplementaryRequest(SupplementaryQueryType.LogsVolume, request);

    expect(result).toBeDefined();
    expect(result!.targets).toHaveLength(1);
    expect(result!.targets[0].queryType).toBe(QueryType.logsVolume);
    expect(result!.targets[0].refId).toBe('logs-volume-A');
  });

  it('getSupplementaryRequest returns undefined when no targets qualify', () => {
    const datasource = createMockDataSource();
    const request = {
      targets: [metricsQuery],
    } as DataQueryRequest<AppQuery>;

    const result = datasource.getSupplementaryRequest(SupplementaryQueryType.LogsVolume, request);
    expect(result).toBeUndefined();
  });

  it('getSupplementaryRequest returns undefined for unsupported type', () => {
    const datasource = createMockDataSource();
    const request = {
      targets: [logsQuery],
    } as DataQueryRequest<AppQuery>;

    const result = datasource.getSupplementaryRequest(SupplementaryQueryType.LogsSample, request);
    expect(result).toBeUndefined();
  });
});

describe('DataSource - createErrorRateByHandlerDataFrame', () => {
  const createMockDataSource = () => {
    const instanceSettings = {
      jsonData: { tenant: 'test-tenant', appKey: 'test-key' },
      url: 'http://test-url',
    } as DataSourceInstanceSettings<any>;

    return new DataSource(instanceSettings);
  };

  const createErrorRateResponse = (opts: {
    time: number[];
    app: string[];
    handler: string[];
    error_rate: number[];
  }): O11yQueryResponse => ({
    refId: 'A',
    name: 'metrics',
    fields: [
      { name: O11Y_API_TIMESTAMP_COLUMN, type: 'time', values: opts.time },
      { name: 'app', type: 'string', values: opts.app },
      { name: 'handler', type: 'string', values: opts.handler },
      { name: 'error_rate', type: 'number', values: opts.error_rate },
    ],
  });

  it('should return empty fields DataFrame when required fields are missing', () => {
    const datasource = createMockDataSource();
    const response = createErrorRateResponse({
      time: [1000],
      app: ['myapp'],
      handler: ['/health'],
      error_rate: [0],
    });
    response.fields = response.fields.filter((f) => f.name !== 'error_rate');

    const dataFrame = (datasource as any).createErrorRateByHandlerDataFrame('A', response);

    expect(dataFrame.refId).toBe('A');
    expect(dataFrame.name).toBe(QueryType.metrics);
    expect(dataFrame.fields).toHaveLength(0);
  });

  it('should group time series by handler and app with correct values', () => {
    const datasource = createMockDataSource();
    const t1 = 1000;
    const t2 = 2000;
    const response = createErrorRateResponse({
      time: [t1, t1, t2, t2],
      app: ['app1', 'app2', 'app1', 'app2'],
      handler: ['h1', 'h2', 'h1', 'h2'],
      error_rate: [10, 20, 15, 25],
    });

    const dataFrame = (datasource as any).createErrorRateByHandlerDataFrame('A', response);

    expect(dataFrame.fields.length).toBe(3); // Time + 2 series
    expect(dataFrame.fields[0].name).toBe('Time');
    expect(dataFrame.fields[0].type).toBe(FieldType.time);
    expect(dataFrame.fields[0].values).toEqual([t1, t2]);

    const valueFields = dataFrame.fields.slice(1);
    expect(valueFields).toHaveLength(2);
    const h1Field = valueFields.find((f: any) => f.labels?.handler === 'h1' && f.labels?.app === 'app1');
    const h2Field = valueFields.find((f: any) => f.labels?.handler === 'h2' && f.labels?.app === 'app2');
    expect(h1Field).toBeDefined();
    expect(h2Field).toBeDefined();
    expect(h1Field.values).toEqual([10, 15]);
    expect(h2Field.values).toEqual([20, 25]);
  });

  it('should preserve error rate values at correct timestamps and use null for missing (time, series)', () => {
    const datasource = createMockDataSource();
    const t1 = 1000;
    const t2 = 2000;
    const t3 = 3000;
    // app1/h1 has values at t1, t3 only; app2/h2 at t2 only
    const response = createErrorRateResponse({
      time: [t1, t3, t2],
      app: ['app1', 'app1', 'app2'],
      handler: ['h1', 'h1', 'h2'],
      error_rate: [5, 25, 50],
    });

    const dataFrame = (datasource as any).createErrorRateByHandlerDataFrame('A', response);

    const sortedTimes = [t1, t2, t3];
    expect(dataFrame.fields[0].values).toEqual(sortedTimes);
    const valueFields = dataFrame.fields.slice(1);
    const h1Field = valueFields.find((f: any) => f.labels?.handler === 'h1');
    const h2Field = valueFields.find((f: any) => f.labels?.handler === 'h2');
    expect(h1Field.values).toEqual([5, null, 25]);
    expect(h2Field.values).toEqual([null, 50, null]);
  });

  it('should use display name "(no handler)" for empty or whitespace handler', () => {
    const datasource = createMockDataSource();
    const response = createErrorRateResponse({
      time: [1000],
      app: ['myapp'],
      handler: [''],
      error_rate: [0],
    });

    const dataFrame = (datasource as any).createErrorRateByHandlerDataFrame('A', response);

    const valueField = dataFrame.fields[1];
    expect(valueField.name).toBe('(no handler)');
    expect(valueField.config?.displayNameFromDS).toBe('(no handler)');
    expect(valueField.labels).toEqual({ app: 'myapp', handler: '' });
  });

  it('should set meta.preferredVisualisationType to graph', () => {
    const datasource = createMockDataSource();
    const response = createErrorRateResponse({
      time: [1000],
      app: ['myapp'],
      handler: ['/api'],
      error_rate: [10],
    });

    const dataFrame = (datasource as any).createErrorRateByHandlerDataFrame('A', response);

    expect(dataFrame.meta?.preferredVisualisationType).toBe('graph');
  });
});

describe('DataSource - createLatencyStatsTableDataFrame', () => {
  const createMockDataSource = () => {
    const instanceSettings = {
      jsonData: { tenant: 'test-tenant', appKey: 'test-key' },
      url: 'http://test-url',
    } as DataSourceInstanceSettings<any>;

    return new DataSource(instanceSettings);
  };

  it('should build table from API response with percentile columns', () => {
    const datasource = createMockDataSource();
    const response: O11yQueryResponse = {
      refId: 'A',
      name: 'metrics',
      fields: [
        { name: 'account', type: 'string', values: ['acc1', 'acc2'] },
        { name: 'handler', type: 'string', values: ['/h1', '/h2'] },
        { name: 'p50', type: 'number', values: [10, 20] },
        { name: 'p95', type: 'number', values: [80, 90] },
        { name: 'p99', type: 'number', values: [100, 110] },
      ],
    };

    const dataFrame = (datasource as any).createLatencyStatsTableDataFrame('A', response);

    expect(dataFrame.meta?.preferredVisualisationType).toBe('table');
    expect(dataFrame.fields).toHaveLength(5);
    expect(dataFrame.fields.map((f: any) => f.name)).toEqual(['account', 'handler', 'p50', 'p95', 'p99']);
    expect(dataFrame.fields[0].values).toEqual(['acc1', 'acc2']);
    expect(dataFrame.fields[1].values).toEqual(['/h1', '/h2']);
    expect(dataFrame.fields[2].values).toEqual([10, 20]);
    expect(dataFrame.fields[2].config?.unit).toBe('ms');
  });

  it('should return empty table with correct columns when response has no percentile or bucket fields', () => {
    const datasource = createMockDataSource();
    const response: O11yQueryResponse = {
      refId: 'A',
      name: 'metrics',
      fields: [
        { name: 'account', type: 'string', values: [] },
        { name: 'handler', type: 'string', values: [] },
      ],
    };

    const dataFrame = (datasource as any).createLatencyStatsTableDataFrame('A', response);

    expect(dataFrame.meta?.preferredVisualisationType).toBe('table');
    expect(dataFrame.fields.map((f: any) => f.name)).toEqual(['account', 'handler', 'p50', 'p95', 'p99']);
    expect(dataFrame.fields.every((f: any) => f.values.length === 0)).toBe(true);
  });

  it('should build table from API response with single "data" field (array of row objects)', () => {
    const datasource = createMockDataSource();
    const response: O11yQueryResponse = {
      refId: 'A',
      name: 'metrics',
      fields: [
        {
          name: 'data',
          type: 'other',
          values: [
            { account: 'acc1', handler: '/h1', p50: 10, p95: 80, p99: 100 },
            { account: 'acc2', handler: '/h2', p50: 20, p95: 90, p99: 110 },
          ],
        },
      ],
    };

    const dataFrame = (datasource as any).createLatencyStatsTableDataFrame('A', response);

    expect(dataFrame.meta?.preferredVisualisationType).toBe('table');
    expect(dataFrame.fields).toHaveLength(5);
    expect(dataFrame.fields.map((f: any) => f.name)).toEqual(['account', 'handler', 'p50', 'p95', 'p99']);
    expect(dataFrame.fields[0].values).toEqual(['acc1', 'acc2']);
    expect(dataFrame.fields[1].values).toEqual(['/h1', '/h2']);
    expect(dataFrame.fields[2].values).toEqual([10, 20]);
    expect(dataFrame.fields[3].values).toEqual([80, 90]);
    expect(dataFrame.fields[4].values).toEqual([100, 110]);
    expect(dataFrame.fields[2].config?.unit).toBe('ms');
  });

  it('should accept PascalCase and alternative keys in data field row objects', () => {
    const datasource = createMockDataSource();
    const response: O11yQueryResponse = {
      refId: 'A',
      name: 'metrics',
      fields: [
        {
          name: 'Data',
          type: 'other',
          values: [
            { Account: 'a1', Handler: '/api', P50: 1, P95: 3, P99: 4 },
          ],
        },
      ],
    };

    const dataFrame = (datasource as any).createLatencyStatsTableDataFrame('A', response);

    expect(dataFrame.fields[0].values).toEqual(['a1']);
    expect(dataFrame.fields[1].values).toEqual(['/api']);
    expect(dataFrame.fields[2].values).toEqual([1]);
    expect(dataFrame.fields[3].values).toEqual([3]);
    expect(dataFrame.fields[4].values).toEqual([4]);
  });

  it('should handle +Inf bucket (BucketCounts.length === ExplicitBounds.length + 1) and return non-NaN percentiles', () => {
    const datasource = createMockDataSource();
    const bounds = [5, 10, 25, 50];
    const countsWithInf = [2, 3, 5, 4, 1];
    const response: O11yQueryResponse = {
      refId: 'A',
      name: 'metrics',
      fields: [
        { name: 'account', type: 'string', values: ['acc1'] },
        { name: 'handler', type: 'string', values: ['/h1'] },
        { name: 'ExplicitBounds', type: 'other', values: [bounds] },
        { name: 'BucketCounts', type: 'other', values: [countsWithInf] },
      ],
    };

    const dataFrame = (datasource as any).createLatencyStatsTableDataFrame('A', response);

    expect(dataFrame.meta?.preferredVisualisationType).toBe('table');
    expect(dataFrame.fields.map((f: any) => f.name)).toEqual(['account', 'handler', 'p50', 'p95', 'p99']);
    const p50Val = dataFrame.fields[2].values[0] as number;
    const p99Val = dataFrame.fields[4].values[0] as number;
    expect(Number.isNaN(p50Val)).toBe(false);
    expect(Number.isNaN(p99Val)).toBe(false);
    expect(p50Val).toBeGreaterThanOrEqual(0);
    expect(p99Val).toBeLessThanOrEqual(50);
  });
});

describe('DataSource - createGraphDataFrame dispatch', () => {
  const createMockDataSource = () => {
    const instanceSettings = {
      jsonData: { tenant: 'test-tenant', appKey: 'test-key' },
      url: 'http://test-url',
    } as DataSourceInstanceSettings<any>;

    return new DataSource(instanceSettings);
  };

  it('should dispatch to createLatencyStatsTableDataFrame when predefinedMetric is LATENCY_STATS_BY_ACCOUNT_AND_HANDLER and no time dimension', () => {
    const datasource = createMockDataSource();
    const response: O11yQueryResponse = {
      refId: 'A',
      name: 'metrics',
      fields: [
        { name: 'account', type: 'string', values: ['acc1'] },
        { name: 'handler', type: 'string', values: ['/h1'] },
        { name: 'p50', type: 'number', values: [5] },
        { name: 'p95', type: 'number', values: [15] },
        { name: 'p99', type: 'number', values: [20] },
      ],
    };
    const query: AppQuery = {
      refId: 'A',
      queryType: QueryType.metrics,
      predefinedMetric: PredefinedMetricType.LATENCY_STATS_BY_ACCOUNT_AND_HANDLER,
      appName: 'test-app',
      filters: [],
      orders: [],
      pageSize: 100,
    };

    const dataFrame = (datasource as any).createGraphDataFrame('A', response, query);

    expect(dataFrame.meta?.preferredVisualisationType).toBe('table');
    expect(dataFrame.fields.map((f: any) => f.name)).toContain('account');
    expect(dataFrame.fields.map((f: any) => f.name)).toContain('handler');
    expect(dataFrame.fields.map((f: any) => f.name)).toContain('p50');
  });

  it('should dispatch to table when LATENCY_STATS_BY_ACCOUNT_AND_HANDLER response has time dimension and bucket fields', () => {
    const datasource = createMockDataSource();
    const response: O11yQueryResponse = {
      refId: 'A',
      name: 'metrics',
      fields: [
        { name: 'TimestampTime', type: 'other', values: ['2026-03-02T16:51:00Z', '2026-03-02T16:52:00Z'] },
        { name: 'account', type: 'other', values: ['acc1', 'acc1'] },
        { name: 'handler', type: 'other', values: ['/h1', '/h1'] },
        {
          name: 'ExplicitBounds',
          type: 'other',
          values: [[0, 5, 10], [0, 5, 10]],
        },
        {
          name: 'BucketCounts',
          type: 'other',
          values: [[1, 2, 3, 0], [0, 4, 2, 0]],
        },
      ],
    };
    const query: AppQuery = {
      refId: 'A',
      queryType: QueryType.metrics,
      predefinedMetric: PredefinedMetricType.LATENCY_STATS_BY_ACCOUNT_AND_HANDLER,
      appName: 'test-app',
      filters: [],
      orders: [],
      pageSize: 100,
    };

    const dataFrame = (datasource as any).createGraphDataFrame('A', response, query);

    expect(dataFrame.meta?.preferredVisualisationType).toBe('table');
    expect(dataFrame.fields.map((f: any) => f.name)).toEqual(['account', 'handler', 'p50', 'p95', 'p99']);
    expect(dataFrame.fields[0].values).toEqual(['acc1']);
    expect(dataFrame.fields[1].values).toEqual(['/h1']);
    expect(dataFrame.fields[2].config?.unit).toBe('ms');
  });

  it('should dispatch to createLatencyStatsPerAccountTableDataFrame when predefinedMetric is LATENCY_STATS_PER_ACCOUNT', () => {
    const datasource = createMockDataSource();
    const response: O11yQueryResponse = {
      refId: 'A',
      name: 'metrics',
      fields: [
        { name: 'account', type: 'string', values: ['acc1', 'acc2'] },
        { name: 'p50', type: 'number', values: [5, 10] },
        { name: 'p95', type: 'number', values: [15, 25] },
        { name: 'p99', type: 'number', values: [20, 30] },
      ],
    };
    const query: AppQuery = {
      refId: 'A',
      queryType: QueryType.metrics,
      predefinedMetric: PredefinedMetricType.LATENCY_STATS_PER_ACCOUNT,
      appName: 'test-app',
      filters: [],
      orders: [],
      pageSize: 100,
    };

    const dataFrame = (datasource as any).createGraphDataFrame('A', response, query);

    expect(dataFrame.meta?.preferredVisualisationType).toBe('table');
    expect(dataFrame.fields.map((f: any) => f.name)).toEqual(['account', 'p50', 'p95', 'p99']);
    expect(dataFrame.fields).not.toContainEqual(expect.objectContaining({ name: 'handler' }));
    expect(dataFrame.fields[0].values).toEqual(['acc1', 'acc2']);
    expect(dataFrame.fields[1].values).toEqual([5, 10]);
    expect(dataFrame.fields[1].config?.unit).toBe('ms');
  });

  it('should build table from histogram response for LATENCY_STATS_PER_ACCOUNT', () => {
    const datasource = createMockDataSource();
    const response: O11yQueryResponse = {
      refId: 'A',
      name: 'metrics',
      fields: [
        { name: 'TimestampTime', type: 'other', values: ['2026-03-02T16:51:00Z', '2026-03-02T16:52:00Z'] },
        { name: 'account', type: 'other', values: ['acc1', 'acc1'] },
        {
          name: 'ExplicitBounds',
          type: 'other',
          values: [[0, 5, 10], [0, 5, 10]],
        },
        {
          name: 'BucketCounts',
          type: 'other',
          values: [[1, 2, 3, 0], [0, 4, 2, 0]],
        },
      ],
    };
    const query: AppQuery = {
      refId: 'A',
      queryType: QueryType.metrics,
      predefinedMetric: PredefinedMetricType.LATENCY_STATS_PER_ACCOUNT,
      appName: 'test-app',
      filters: [],
      orders: [],
      pageSize: 100,
    };

    const dataFrame = (datasource as any).createGraphDataFrame('A', response, query);

    expect(dataFrame.meta?.preferredVisualisationType).toBe('table');
    expect(dataFrame.fields.map((f: any) => f.name)).toEqual(['account', 'p50', 'p95', 'p99']);
    expect(dataFrame.fields[0].values).toEqual(['acc1']);
    expect(dataFrame.fields[1].config?.unit).toBe('ms');
    const p50Val = dataFrame.fields[1].values[0] as number;
    const p99Val = dataFrame.fields[3].values[0] as number;
    expect(Number.isNaN(p50Val)).toBe(false);
    expect(Number.isNaN(p99Val)).toBe(false);
  });

  it('should dispatch to latency percentile graph when predefinedMetric is LATENCY_P50_PER_HANDLER and response has histogram fields', () => {
    const datasource = createMockDataSource();
    const t1 = new Date('2026-03-02T16:51:00Z').getTime();
    const t2 = new Date('2026-03-02T16:52:00Z').getTime();
    const response: O11yQueryResponse = {
      refId: 'A',
      name: 'metrics',
      fields: [
        { name: 'TimestampTime', type: 'other', values: ['2026-03-02T16:51:00Z', '2026-03-02T16:52:00Z'] },
        { name: 'account', type: 'other', values: ['acc1', 'acc1'] },
        { name: 'handler', type: 'other', values: ['/api/foo', '/api/foo'] },
        {
          name: 'ExplicitBounds',
          type: 'other',
          values: [[0, 5, 10], [0, 5, 10]],
        },
        {
          name: 'BucketCounts',
          type: 'other',
          values: [[1, 2, 3, 0], [0, 4, 2, 0]],
        },
      ],
    };
    const query: AppQuery = {
      refId: 'A',
      queryType: QueryType.metrics,
      predefinedMetric: PredefinedMetricType.LATENCY_P50_PER_HANDLER,
      appName: 'test-app',
      filters: [],
      orders: [],
      pageSize: 100,
    };

    const dataFrame = (datasource as any).createGraphDataFrame('A', response, query);

    expect(dataFrame.meta?.preferredVisualisationType).toBe('graph');
    expect(dataFrame.fields[0].name).toBe('Time');
    expect(dataFrame.fields[0].type).toBe('time');
    expect(dataFrame.fields.length).toBeGreaterThanOrEqual(2); // Time + at least one handler series
    const seriesField = dataFrame.fields[1];
    expect(seriesField.config?.displayNameFromDS).toBe('p50 | /api/foo');
    expect(seriesField.config?.unit).toBe('ms');
    expect(seriesField.values.length).toBe(2); // two time points
    const val = seriesField.values[0] as number;
    expect(Number.isNaN(val)).toBe(false);
  });

  it('should build latency graph with p90 label when predefinedMetric is LATENCY_P90_PER_HANDLER', () => {
    const datasource = createMockDataSource();
    const response: O11yQueryResponse = {
      refId: 'A',
      name: 'metrics',
      fields: [
        { name: 'TimestampTime', type: 'other', values: ['2026-03-02T16:51:00Z'] },
        { name: 'account', type: 'other', values: ['acc1'] },
        { name: 'handler', type: 'other', values: ['/handler1'] },
        { name: 'ExplicitBounds', type: 'other', values: [[0, 10, 50]] },
        { name: 'BucketCounts', type: 'other', values: [[2, 3, 1, 0]] },
      ],
    };
    const query: AppQuery = {
      refId: 'A',
      queryType: QueryType.metrics,
      predefinedMetric: PredefinedMetricType.LATENCY_P90_PER_HANDLER,
      appName: 'test-app',
      filters: [],
      orders: [],
      pageSize: 100,
    };

    const dataFrame = (datasource as any).createGraphDataFrame('A', response, query);

    expect(dataFrame.meta?.preferredVisualisationType).toBe('graph');
    expect(dataFrame.fields[1].config?.displayNameFromDS).toBe('p90 | /handler1');
    expect(dataFrame.fields[1].config?.unit).toBe('ms');
  });

  it('should build latency graph with p99 label when predefinedMetric is LATENCY_P99_PER_HANDLER', () => {
    const datasource = createMockDataSource();
    const response: O11yQueryResponse = {
      refId: 'A',
      name: 'metrics',
      fields: [
        { name: 'TimestampTime', type: 'other', values: ['2026-03-02T16:51:00Z'] },
        { name: 'account', type: 'other', values: ['acc1'] },
        { name: 'handler', type: 'other', values: ['/other'] },
        { name: 'ExplicitBounds', type: 'other', values: [[0, 5, 10]] },
        { name: 'BucketCounts', type: 'other', values: [[1, 2, 1, 0]] },
      ],
    };
    const query: AppQuery = {
      refId: 'A',
      queryType: QueryType.metrics,
      predefinedMetric: PredefinedMetricType.LATENCY_P99_PER_HANDLER,
      appName: 'test-app',
      filters: [],
      orders: [],
      pageSize: 100,
    };

    const dataFrame = (datasource as any).createGraphDataFrame('A', response, query);

    expect(dataFrame.meta?.preferredVisualisationType).toBe('graph');
    expect(dataFrame.fields[1].config?.displayNameFromDS).toBe('p99 | /other');
  });
});
