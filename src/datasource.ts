import {
  CoreApp,
  DataFrame,
  DataQueryRequest,
  DataQueryResponse,
  DataSourceApi,
  DataSourceInstanceSettings,
  DataSourceWithSupplementaryQueriesSupport,
  createDataFrame,
  FieldType,
  DataFrameType,
  QueryFixAction,
  Field,
  SupplementaryQueryType,
  SupplementaryQueryOptions,
  LogsVolumeType,
} from '@grafana/data';
import { isFetchError } from '@grafana/runtime';


import {
  AppQuery,
  VTEXIODataSourceOptions,
  DEFAULT_QUERY,
  QueryType,
  PredefinedMetricType,
  O11yQueryResponse,
  AppsResponse,
} from './types';
import defaults from 'lodash/defaults';
import { O11yApi, ProductionO11yApiClient, O11Y_API_TIMESTAMP_COLUMN, API_REQUEST_TIMEOUT_MS } from 'clients/o11yApi';
import { boundsEqual, computeHistogramQuantiles } from './utils/histogramQuantiles';

/** Page size used for latency percentile-by-handler chart queries so multiple time buckets are returned (continuous chart). */
const LATENCY_CHART_PAGE_SIZE = 5000;
/** Minimum page size for latency chart queries so the chart has enough points; user pageSize below this is raised. */
const LATENCY_CHART_MIN_PAGE_SIZE = 500;

export class DataSource
  extends DataSourceApi<AppQuery, VTEXIODataSourceOptions>
  implements DataSourceWithSupplementaryQueriesSupport<AppQuery> {
  instanceSettings: DataSourceInstanceSettings<VTEXIODataSourceOptions>;
  http: O11yApi;

  constructor(instanceSettings: DataSourceInstanceSettings<VTEXIODataSourceOptions>) {
    super(instanceSettings);
    this.instanceSettings = instanceSettings;
    this.http = new ProductionO11yApiClient(instanceSettings.jsonData.tenant!, this.instanceSettings.url);
  }

  getDefaultQuery(_: CoreApp): Partial<AppQuery> {
    return DEFAULT_QUERY;
  }

  getSupportedSupplementaryQueryTypes(): SupplementaryQueryType[] {
    return [SupplementaryQueryType.LogsVolume];
  }

  getSupplementaryQuery(options: SupplementaryQueryOptions, query: AppQuery): AppQuery | undefined {
    if (options.type !== SupplementaryQueryType.LogsVolume) {
      return undefined;
    }
    if (query.queryType !== QueryType.logs) {
      return undefined;
    }
    return {
      ...query,
      refId: `logs-volume-${query.refId}`,
      queryType: QueryType.logsVolume,
    };
  }

  getSupplementaryRequest(
    type: SupplementaryQueryType,
    request: DataQueryRequest<AppQuery>,
    options?: SupplementaryQueryOptions
  ): DataQueryRequest<AppQuery> | undefined {
    if (!this.getSupportedSupplementaryQueryTypes().includes(type)) {
      return undefined;
    }

    const supplementaryOptions: SupplementaryQueryOptions = options ?? { type };
    const targets = request.targets
      .map((query) => this.getSupplementaryQuery(supplementaryOptions, query))
      .filter((query): query is AppQuery => !!query);

    if (!targets.length) {
      return undefined;
    }

    return { ...request, targets };
  }

  /**
   * This method is called when the user clicks on a field value in the log details view,
   * and log details they work only in the Explore view.
   * Handles ADD_FILTER (filter by value) and ADD_FILTER_OUT (exclude value) actions
   * ref: https://grafana.com/developers/plugin-tools/tutorials/build-a-logs-data-source-plugin#filter-fields-using-log-details
   */
  modifyQuery(query: AppQuery, action: QueryFixAction): AppQuery {
    const filters = query.filters || [];

    switch (action.type) {
      case 'ADD_FILTER':
        if (action.options?.key && action.options?.value) {
          // Check if filter already exists for this column (based on column name only)
          const existingFilterIndex = filters.findIndex(
            (f) => f.column === action.options?.key
          );

          const newFilter = {
            column: action.options.key,
            operator: '=',
            type: 'string', // Default to string, could be enhanced to detect type
            value: action.options.value,
          };

          if (existingFilterIndex >= 0) {
            // Replace existing filter for this column (regardless of operator)
            filters[existingFilterIndex] = newFilter;
          } else {
            // Add new filter
            filters.push(newFilter);
          }
        }
        break;

      case 'ADD_FILTER_OUT':
        if (action.options?.key && action.options?.value) {
          // Check if filter already exists for this column (based on column name only)
          const existingFilterIndex = filters.findIndex(
            (f) => f.column === action.options?.key
          );

          const newFilter = {
            column: action.options.key,
            operator: '!=',
            type: 'string', // Default to string, could be enhanced to detect type
            value: action.options.value,
          };

          if (existingFilterIndex >= 0) {
            // Replace existing filter for this column (regardless of operator)
            filters[existingFilterIndex] = newFilter;
          } else {
            // Add new filter-out
            filters.push(newFilter);
          }
        }
        break;
    }

    return { ...query, filters };
  }

  /**
   * Fetches app names from the o11y API for both logs and metrics
   */
  async getApps(fromTime?: number, toTime?: number): Promise<AppsResponse> {
    return await this.http.ListApps({ fromTime, toTime });
  }

  async query(options: DataQueryRequest<AppQuery>): Promise<DataQueryResponse> {
    const { range } = options;
    const from = range!.from.valueOf();
    const to = range!.to.valueOf();

    const errors: Array<{ refId: string; message: string }> = [];
    const dataArrays = await Promise.all(
      options.targets.map(async (target, index) => {
        try {
          // Merge target with defaults, but preserve filters array if it exists
          const query = defaults(target, DEFAULT_QUERY);
          
          // Ensure filters array is preserved from target (may contain dashboard filters)
          // If target has filters, use them; otherwise use empty array from defaults
          if (target.filters && Array.isArray(target.filters) && target.filters.length > 0) {
            query.filters = target.filters;
          } else if (!query.filters) {
            query.filters = [];
          }

          return await this.fetchDataFromAPI(query, from, to);
        } catch (error) {
          console.error('[VTEX Datasource] Error processing target:', {
            index,
            refId: target.refId,
            error: (error as Error).message,
            stack: (error as Error).stack,
          });
          
          // Extract error message
          const errorMessage = this.extractErrorMessage(error);
          
          // Add error to errors array
          errors.push({
            refId: target.refId,
            message: errorMessage,
          });
          
          // Return empty DataFrame for this query
          return createDataFrame({
            refId: target.refId,
            name: target.queryType || DEFAULT_QUERY.queryType || QueryType.logs,
            fields: [],
          });
        }
      })
    );

    // Flatten: volume queries return DataFrame[], others return DataFrame
    const data: DataFrame[] = dataArrays.flat();

    return { data, errors: errors.length > 0 ? errors : undefined };
  }

  /**
   * Returns page size for the API request. For latency percentile-by-handler chart metrics,
   * uses at least LATENCY_CHART_MIN_PAGE_SIZE so multiple time buckets are returned, but
   * respects user pageSize (and caps at LATENCY_CHART_PAGE_SIZE) so dashboards can tune performance.
   */
  private getPageSizeForMetricsQuery(query: AppQuery): number {
    if (query.queryType === QueryType.metrics) {
      const chartMetric =
        query.predefinedMetric === PredefinedMetricType.LATENCY_P50_PER_HANDLER ||
        query.predefinedMetric === PredefinedMetricType.LATENCY_P90_PER_HANDLER ||
        query.predefinedMetric === PredefinedMetricType.LATENCY_P99_PER_HANDLER;
      if (chartMetric) {
        const userPageSize = query.pageSize ?? 100;
        return Math.min(
          LATENCY_CHART_PAGE_SIZE,
          Math.max(userPageSize, LATENCY_CHART_MIN_PAGE_SIZE)
        );
      }
    }
    return query.pageSize || 100;
  }

  /**
   * Fetches data from the actual API.
   * Returns a single DataFrame for logs/metrics, or an array of DataFrames for logsVolume.
   */
  private async fetchDataFromAPI(query: AppQuery, fromTime: number, toTime: number): Promise<DataFrame | DataFrame[]> {
    // Validate required fields
    if (!query.appName) {
      // FIXME: Remove debug logging before moving out of beta
      // eslint-disable-next-line no-console
      console.log('[VTEX Datasource] App name is required but not provided');
      return createDataFrame({
        refId: query.refId,
        name: query.queryType,
        fields: [],
      });
    }

    // For metrics, also validate predefined metric is selected
    if (query.queryType === QueryType.metrics && !query.predefinedMetric) {
      // FIXME: Remove debug logging before moving out of beta
      // eslint-disable-next-line no-console
      console.log('[VTEX Datasource] Predefined metric is required for metrics queries');
      return createDataFrame({
        refId: query.refId,
        name: query.queryType,
        fields: [],
      });
    }

    const bodyParams = {
      fromTime,
      toTime,
      pageSize: this.getPageSizeForMetricsQuery(query),
      app: query.appName,
      predefinedMetric: query.predefinedMetric,
      metricType: query.metricType,
      filters: query.filters || [],
    };

    // Debug logging to help troubleshoot filter issues
    // FIXME: Remove debug logging before moving out of beta
    // eslint-disable-next-line no-console
    console.log('[VTEX Datasource] Building API request:', {
      refId: query.refId,
      filters: bodyParams.filters,
      filterCount: bodyParams.filters.length,
    });

    try {
      if (query.queryType === QueryType.logsVolume) {
        const volumeResponse = await this.http.FetchLogsVolume(bodyParams);
        return this.createLogsVolumeDataFrames(query.refId, volumeResponse, fromTime, toTime, query);
      } else if (query.queryType === QueryType.logs) {
        const logsResponse = await this.http.FetchLogs(bodyParams);
        return this.createLogsDataFrame(query.refId, logsResponse);
      } else {
        const metricsResponse = await this.http.FetchMetrics(bodyParams);
        return this.createGraphDataFrame(query.refId, metricsResponse, query, fromTime);
      }
    } catch (err) {
      console.error(`[VTEX Datasource] Unable to fetch data from O11yAPI: ${err}`);
      // Re-throw the error so it can be caught in the query method and included in errors array
      throw err;
    }
  }

  private createGraphDataFrame(
    refId: string,
    metricsResponse: O11yQueryResponse,
    query?: AppQuery,
    fromTime?: number
  ): DataFrame {
    if (query?.predefinedMetric === PredefinedMetricType.ERROR_RATE_BY_HANDLER) {
      return this.createErrorRateByHandlerDataFrame(refId, metricsResponse, fromTime);
    }
    if (query?.predefinedMetric === PredefinedMetricType.LATENCY_STATS_BY_ACCOUNT_AND_HANDLER) {
      return this.createLatencyStatsTableDataFrame(refId, metricsResponse);
    }
    if (query?.predefinedMetric === PredefinedMetricType.LATENCY_STATS_PER_ACCOUNT) {
      return this.createLatencyStatsPerAccountTableDataFrame(refId, metricsResponse);
    }
    if (query?.predefinedMetric === PredefinedMetricType.LATENCY_P50_PER_HANDLER) {
      return this.createLatencyPercentileByHandlerGraphDataFrame(refId, metricsResponse, 'p50', 0.5);
    }
    if (query?.predefinedMetric === PredefinedMetricType.LATENCY_P90_PER_HANDLER) {
      return this.createLatencyPercentileByHandlerGraphDataFrame(refId, metricsResponse, 'p90', 0.9);
    }
    if (query?.predefinedMetric === PredefinedMetricType.LATENCY_P99_PER_HANDLER) {
      return this.createLatencyPercentileByHandlerGraphDataFrame(refId, metricsResponse, 'p99', 0.99);
    }
    return this.createTimeSeriesDataFrame(refId, metricsResponse);
  }

  /**
   * Creates a time series DataFrame for error rate by handler: one line per (app, handler)
   * with error_rate along the time axis (using TimestampTime from the API response).
   */
  private createErrorRateByHandlerDataFrame(
    refId: string,
    metricsResponse: O11yQueryResponse,
    _fromTime?: number
  ): DataFrame {
    const timeField = metricsResponse.fields.find((f) => f.name === O11Y_API_TIMESTAMP_COLUMN);
    const appField = metricsResponse.fields.find((f) => f.name === 'app');
    const handlerField = metricsResponse.fields.find((f) => f.name === 'handler');
    const errorRateField = metricsResponse.fields.find((f) => f.name === 'error_rate');

    if (!timeField || !appField || !handlerField || !errorRateField) {
      console.error('[VTEX Datasource] Missing required fields for error rate by handler', {
        hasTime: !!timeField,
        hasApp: !!appField,
        hasHandler: !!handlerField,
        hasErrorRate: !!errorRateField,
      });
      return createDataFrame({
        refId,
        name: QueryType.metrics,
        fields: [],
      });
    }

    const timeMap = new Map<number, Map<string, number>>();
    const allSeries = new Map<string, { app: string; handler: string }>();

    for (let i = 0; i < timeField.values.length; i++) {
      const time = typeof timeField.values[i] === 'string'
        ? new Date(timeField.values[i]).getTime()
          : timeField.values[i];
      const app = appField.values[i] ?? '';
      const handler = handlerField.values[i] ?? '';
      const errorRate = errorRateField.values[i];
      const seriesKey = `${app}\0${handler}`;

      if (!allSeries.has(seriesKey)) {
        allSeries.set(seriesKey, { app, handler });
      }
      if (!timeMap.has(time)) {
        timeMap.set(time, new Map());
      }
      timeMap.get(time)!.set(seriesKey, errorRate);
    }

    const sortedTimes = Array.from(timeMap.keys()).sort((a, b) => a - b);

    const fields: Array<{ name: string; type: FieldType; values: unknown[]; labels?: Record<string, string>; config?: { displayNameFromDS: string; unit?: string } }> = [
      { name: 'Time', type: FieldType.time, values: sortedTimes },
    ];

    allSeries.forEach((seriesInfo, seriesKey) => {
      const displayName = seriesInfo.handler && seriesInfo.handler.trim() !== '' ? seriesInfo.handler : '(no handler)';
      const values = sortedTimes.map((t) => timeMap.get(t)?.get(seriesKey) ?? null);
      fields.push({
        name: displayName,
        type: FieldType.number,
        values,
        labels: { app: seriesInfo.app, handler: seriesInfo.handler },
        config: { displayNameFromDS: displayName, unit: 'percent' },
      });
    });

    return createDataFrame({
      refId,
      name: QueryType.metrics,
      fields,
      meta: {
        preferredVisualisationType: 'graph',
        ...metricsResponse.meta,
      },
    });
  }

  /**
   * Creates a time series DataFrame for latency percentile by handler: one line per handler,
   * with percentile value (ms) along the time axis. Aggregates histogram data by (TimestampTime, handler).
   */
  private createLatencyPercentileByHandlerGraphDataFrame(
    refId: string,
    metricsResponse: O11yQueryResponse,
    label: 'p50' | 'p90' | 'p99',
    quantile: number
  ): DataFrame {
    const timeField = metricsResponse.fields.find((f) => f.name === O11Y_API_TIMESTAMP_COLUMN);
    const handlerField = metricsResponse.fields.find((f) => f.name === 'handler');
    const boundsField = metricsResponse.fields.find(
      (f) => f.name === 'ExplicitBounds' || f.name === 'bounds'
    );
    const countsField = metricsResponse.fields.find(
      (f) => f.name === 'BucketCounts' || f.name === 'counts'
    );

    if (!timeField || !handlerField || !boundsField || !countsField) {
      console.error('[VTEX Datasource] Missing required fields for latency percentile by handler', {
        hasTime: !!timeField,
        hasHandler: !!handlerField,
        hasBounds: !!boundsField,
        hasCounts: !!countsField,
      });
      return createDataFrame({
        refId,
        name: QueryType.metrics,
        fields: [],
      });
    }

    const len = (timeField.values as unknown[]).length;
    const rows: Array<{ time: number; handler: string; bounds: number[]; counts: number[] }> = [];
    for (let i = 0; i < len; i++) {
      const rawTime = timeField.values[i];
      const time =
        typeof rawTime === 'string'
          ? new Date(rawTime).getTime()
          : typeof rawTime === 'number' && rawTime < 1e12
            ? rawTime * 1000
            : (rawTime as number);
      const handler = String(handlerField.values[i] ?? '');
      const bounds = boundsField.values[i] as number[];
      const counts = countsField.values[i] as number[];
      if (Array.isArray(bounds) && Array.isArray(counts)) {
        rows.push({ time, handler, bounds, counts });
      }
    }

    // Aggregate by (time, handler): merge bucket counts (same bounds schema)
    const aggregated = new Map<
      string,
      { time: number; handler: string; bounds: number[]; counts: number[] }
    >();
    for (const row of rows) {
      const key = `${row.time}\0${row.handler}`;
      if (!aggregated.has(key)) {
        aggregated.set(key, {
          time: row.time,
          handler: row.handler,
          bounds: Array.isArray(row.bounds) ? [...row.bounds] : [],
          counts: Array.isArray(row.counts) ? [...row.counts] : [],
        });
      } else {
        const agg = aggregated.get(key)!;
        const boundsMatch = boundsEqual(row.bounds, agg.bounds);
        if (Array.isArray(row.counts) && row.counts.length === agg.counts.length && boundsMatch) {
          for (let j = 0; j < row.counts.length; j++) {
            agg.counts[j] = (agg.counts[j] ?? 0) + (row.counts[j] ?? 0);
          }
        } else if (Array.isArray(row.counts) && row.counts.length === agg.counts.length && !boundsMatch) {
          console.warn('[VTEX Datasource] Skipping histogram row: ExplicitBounds differ for same (time, handler); counts not summed.', {
            handler: row.handler,
            time: row.time,
          });
        }
      }
    }

    // Build time -> (handler -> percentile value)
    const timeMap = new Map<number, Map<string, number>>();
    const allHandlers = new Map<string, string>();
    aggregated.forEach((agg) => {
      const countsForQuantiles =
        agg.counts.length === agg.bounds.length + 1
          ? agg.counts.slice(0, agg.bounds.length)
          : agg.counts;
      const values = computeHistogramQuantiles(agg.bounds, countsForQuantiles, [quantile]);
      const value = values[0];
      if (!timeMap.has(agg.time)) {
        timeMap.set(agg.time, new Map());
      }
      timeMap.get(agg.time)!.set(agg.handler, value);
      if (!allHandlers.has(agg.handler)) {
        allHandlers.set(agg.handler, agg.handler);
      }
    });

    const sortedTimes = Array.from(timeMap.keys()).sort((a, b) => a - b);
    const fields: Array<{
      name: string;
      type: FieldType;
      values: unknown[];
      labels?: Record<string, string>;
      config?: { displayNameFromDS: string; unit?: string };
    }> = [{ name: 'Time', type: FieldType.time, values: sortedTimes }];

    allHandlers.forEach((handlerName) => {
      const displayName =
        handlerName && handlerName.trim() !== ''
          ? `${label} | ${handlerName}`
          : `${label} | (no handler)`;
      const values = sortedTimes.map((t) => {
        const v = timeMap.get(t)?.get(handlerName);
        return v !== undefined && !Number.isNaN(v) ? v : null;
      });
      fields.push({
        name: displayName,
        type: FieldType.number,
        values,
        labels: { handler: handlerName },
        config: { displayNameFromDS: displayName, unit: 'ms' },
      });
    });

    return createDataFrame({
      refId,
      name: QueryType.metrics,
      fields,
      meta: {
        preferredVisualisationType: 'graph',
        ...metricsResponse.meta,
      },
    });
  }

  /**
   * Creates a table DataFrame for latency stats per account and handler.
   * Supports three response shapes: (1) direct percentile columns (p50, p95, p99),
   * (2) histogram bucket data (bounds + counts) aggregated and converted to percentiles in the plugin,
   * (3) single field "data"/"Data"/"rows" with values = array of row objects.
   */
  private createLatencyStatsTableDataFrame(refId: string, metricsResponse: O11yQueryResponse): DataFrame {
    const accountField = metricsResponse.fields.find((f) => f.name === 'account');
    const handlerField = metricsResponse.fields.find((f) => f.name === 'handler');
    const p50Field = metricsResponse.fields.find((f) => f.name === 'p50');
    const p95Field = metricsResponse.fields.find((f) => f.name === 'p95');
    const p99Field = metricsResponse.fields.find((f) => f.name === 'p99');

    // Path 1: API returned pre-aggregated percentiles
    if (accountField && handlerField && p50Field && p95Field && p99Field) {
      const accountValues = accountField.values as string[];
      const handlerValues = handlerField.values as string[];

      return createDataFrame({
        refId,
        name: QueryType.metrics,
        fields: [
          { name: 'account', type: FieldType.string, values: accountValues },
          { name: 'handler', type: FieldType.string, values: handlerValues },
          {
            name: 'p50',
            type: FieldType.number,
            values: p50Field.values,
            config: { unit: 'ms' },
          },
          {
            name: 'p95',
            type: FieldType.number,
            values: p95Field.values,
            config: { unit: 'ms' },
          },
          {
            name: 'p99',
            type: FieldType.number,
            values: p99Field.values,
            config: { unit: 'ms' },
          },
        ],
        meta: {
          preferredVisualisationType: 'table',
          ...metricsResponse.meta,
        },
      });
    }

    // Path 2: API returned histogram bucket data (e.g. ExplicitBounds, BucketCounts per row)
    const boundsField = metricsResponse.fields.find(
      (f) => f.name === 'ExplicitBounds' || f.name === 'bounds'
    );
    const countsField = metricsResponse.fields.find(
      (f) => f.name === 'BucketCounts' || f.name === 'counts'
    );

    if (accountField && handlerField && boundsField && countsField) {
      const rows = (accountField.values as string[]).map((_, i) => ({
        account: accountField.values[i],
        handler: handlerField.values[i],
        bounds: boundsField.values[i] as number[],
        counts: countsField.values[i] as number[],
      }));

      // Aggregate by (account, handler): merge bounds and sum counts (assume same bound schema)
      const aggregated = new Map<string, { account: string; handler: string; bounds: number[]; counts: number[] }>();
      for (const row of rows) {
        const key = `${row.account}\0${row.handler}`;
        if (!aggregated.has(key)) {
          aggregated.set(key, {
            account: String(row.account),
            handler: String(row.handler),
            bounds: Array.isArray(row.bounds) ? [...row.bounds] : [],
            counts: Array.isArray(row.counts) ? [...row.counts] : [],
          });
        } else {
          const agg = aggregated.get(key)!;
          const boundsMatch = boundsEqual(row.bounds, agg.bounds);
          if (Array.isArray(row.counts) && row.counts.length === agg.counts.length && boundsMatch) {
            for (let j = 0; j < row.counts.length; j++) {
              agg.counts[j] = (agg.counts[j] ?? 0) + (row.counts[j] ?? 0);
            }
          } else if (Array.isArray(row.counts) && row.counts.length === agg.counts.length && !boundsMatch) {
            console.warn('[VTEX Datasource] Skipping histogram row: ExplicitBounds differ for same (account, handler); counts not summed.', {
              account: row.account,
              handler: row.handler,
            });
          }
        }
      }

      const quantiles = [0.5, 0.95, 0.99];
      const accounts: string[] = [];
      const handlers: string[] = [];
      const p50Values: number[] = [];
      const p95Values: number[] = [];
      const p99Values: number[] = [];

      aggregated.forEach((agg) => {
        // API may return BucketCounts with length bounds.length + 1 (+Inf bucket); util expects same length
        const countsForQuantiles =
          agg.counts.length === agg.bounds.length + 1
            ? agg.counts.slice(0, agg.bounds.length)
            : agg.counts;
        const values = computeHistogramQuantiles(agg.bounds, countsForQuantiles, quantiles);
        accounts.push(agg.account);
        handlers.push(agg.handler);
        p50Values.push(values[0]);
        p95Values.push(values[1]);
        p99Values.push(values[2]);
      });

      return createDataFrame({
        refId,
        name: QueryType.metrics,
        fields: [
          { name: 'account', type: FieldType.string, values: accounts },
          { name: 'handler', type: FieldType.string, values: handlers },
          { name: 'p50', type: FieldType.number, values: p50Values, config: { unit: 'ms' } },
          { name: 'p95', type: FieldType.number, values: p95Values, config: { unit: 'ms' } },
          { name: 'p99', type: FieldType.number, values: p99Values, config: { unit: 'ms' } },
        ],
        meta: {
          preferredVisualisationType: 'table',
          ...metricsResponse.meta,
        },
      });
    }

    // Path 3: API returned a single field "data"/"Data"/"rows" with values = array of row objects
    const dataField = metricsResponse.fields.find(
      (f) =>
        (f.name === 'data' || f.name === 'Data' || f.name === 'rows') &&
        Array.isArray(f.values) &&
        f.values.length > 0 &&
        typeof f.values[0] === 'object' &&
        f.values[0] !== null &&
        !Array.isArray(f.values[0])
    );

    if (dataField && dataField.values.length > 0) {
      const rows = dataField.values as Array<Record<string, unknown>>;
      const accounts: string[] = [];
      const handlers: string[] = [];
      const p50Values: number[] = [];
      const p95Values: number[] = [];
      const p99Values: number[] = [];

      const getStr = (row: Record<string, unknown>, ...keys: string[]): string => {
        for (const k of keys) {
          if (Object.prototype.hasOwnProperty.call(row, k)) {
            const v = row[k];
            if (v != null) { return String(v); }
          }
        }
        const lower = keys[0].toLowerCase();
        for (const [key, val] of Object.entries(row)) {
          if (key.toLowerCase() === lower && val != null) { return String(val); }
        }
        return '';
      };

      const getNum = (row: Record<string, unknown>, ...keys: string[]): number => {
        for (const k of keys) {
          if (Object.prototype.hasOwnProperty.call(row, k)) {
            const v = row[k];
            if (typeof v === 'number' && !Number.isNaN(v)) { return v; }
            if (v != null) {
              const n = Number(v);
              if (!Number.isNaN(n)) { return n; }
            }
          }
        }
        const lower = keys[0].toLowerCase();
        for (const [key, val] of Object.entries(row)) {
          if (key.toLowerCase() === lower && val != null) {
            const n = Number(val);
            if (!Number.isNaN(n)) { return n; }
          }
        }
        return Number.NaN;
      };

      for (const row of rows) {
        const account = getStr(row, 'account', 'Account', 'account_name');
        const handler = getStr(row, 'handler', 'Handler', 'handler_name');
        accounts.push(account);
        handlers.push(handler);
        p50Values.push(getNum(row, 'p50', 'P50', 'p50_ms'));
        p95Values.push(getNum(row, 'p95', 'P95', 'p95_ms'));
        p99Values.push(getNum(row, 'p99', 'P99', 'p99_ms'));
      }

      return createDataFrame({
        refId,
        name: QueryType.metrics,
        fields: [
          { name: 'account', type: FieldType.string, values: accounts },
          { name: 'handler', type: FieldType.string, values: handlers },
          { name: 'p50', type: FieldType.number, values: p50Values, config: { unit: 'ms' } },
          { name: 'p95', type: FieldType.number, values: p95Values, config: { unit: 'ms' } },
          { name: 'p99', type: FieldType.number, values: p99Values, config: { unit: 'ms' } },
        ],
        meta: {
          preferredVisualisationType: 'table',
          ...metricsResponse.meta,
        },
      });
    }

    // No recognized shape: return empty table with correct columns
    return createDataFrame({
      refId,
      name: QueryType.metrics,
      fields: [
        { name: 'account', type: FieldType.string, values: [] },
        { name: 'handler', type: FieldType.string, values: [] },
        { name: 'p50', type: FieldType.number, values: [], config: { unit: 'ms' } },
        { name: 'p95', type: FieldType.number, values: [], config: { unit: 'ms' } },
        { name: 'p99', type: FieldType.number, values: [], config: { unit: 'ms' } },
      ],
      meta: {
        preferredVisualisationType: 'table',
        ...metricsResponse.meta,
      },
    });
  }

  /**
   * Creates a table DataFrame for latency stats per account only (no handler).
   * Supports: (1) direct percentile columns (account, p50, p95, p99),
   * (2) histogram bucket data (account, ExplicitBounds, BucketCounts) aggregated by account and converted to percentiles in the plugin.
   */
  private createLatencyStatsPerAccountTableDataFrame(refId: string, metricsResponse: O11yQueryResponse): DataFrame {
    const accountField = metricsResponse.fields.find((f) => f.name === 'account');
    const p50Field = metricsResponse.fields.find((f) => f.name === 'p50');
    const p95Field = metricsResponse.fields.find((f) => f.name === 'p95');
    const p99Field = metricsResponse.fields.find((f) => f.name === 'p99');

    // Path 1: API returned pre-aggregated percentiles (account, p50, p95, p99)
    if (accountField && p50Field && p95Field && p99Field) {
      return createDataFrame({
        refId,
        name: QueryType.metrics,
        fields: [
          { name: 'account', type: FieldType.string, values: accountField.values },
          { name: 'p50', type: FieldType.number, values: p50Field.values, config: { unit: 'ms' } },
          { name: 'p95', type: FieldType.number, values: p95Field.values, config: { unit: 'ms' } },
          { name: 'p99', type: FieldType.number, values: p99Field.values, config: { unit: 'ms' } },
        ],
        meta: {
          preferredVisualisationType: 'table',
          ...metricsResponse.meta,
        },
      });
    }

    // Path 2: API returned histogram bucket data (account, ExplicitBounds, BucketCounts per row)
    const boundsField = metricsResponse.fields.find(
      (f) => f.name === 'ExplicitBounds' || f.name === 'bounds'
    );
    const countsField = metricsResponse.fields.find(
      (f) => f.name === 'BucketCounts' || f.name === 'counts'
    );

    if (accountField && boundsField && countsField) {
      const rows = (accountField.values as string[]).map((_, i) => ({
        account: accountField.values[i],
        bounds: boundsField.values[i] as number[],
        counts: countsField.values[i] as number[],
      }));

      // Aggregate by account: merge bounds and sum counts (assume same bound schema)
      const aggregated = new Map<string, { account: string; bounds: number[]; counts: number[] }>();
      for (const row of rows) {
        const key = String(row.account);
        if (!aggregated.has(key)) {
          aggregated.set(key, {
            account: String(row.account),
            bounds: Array.isArray(row.bounds) ? [...row.bounds] : [],
            counts: Array.isArray(row.counts) ? [...row.counts] : [],
          });
        } else {
          const agg = aggregated.get(key)!;
          const boundsMatch = boundsEqual(row.bounds, agg.bounds);
          if (Array.isArray(row.counts) && row.counts.length === agg.counts.length && boundsMatch) {
            for (let j = 0; j < row.counts.length; j++) {
              agg.counts[j] = (agg.counts[j] ?? 0) + (row.counts[j] ?? 0);
            }
          } else if (Array.isArray(row.counts) && row.counts.length === agg.counts.length && !boundsMatch) {
            console.warn('[VTEX Datasource] Skipping histogram row: ExplicitBounds differ for same account; counts not summed.', {
              account: row.account,
            });
          }
        }
      }

      const quantiles = [0.5, 0.95, 0.99];
      const accounts: string[] = [];
      const p50Values: number[] = [];
      const p95Values: number[] = [];
      const p99Values: number[] = [];

      aggregated.forEach((agg) => {
        const countsForQuantiles =
          agg.counts.length === agg.bounds.length + 1
            ? agg.counts.slice(0, agg.bounds.length)
            : agg.counts;
        const values = computeHistogramQuantiles(agg.bounds, countsForQuantiles, quantiles);
        accounts.push(agg.account);
        p50Values.push(values[0]);
        p95Values.push(values[1]);
        p99Values.push(values[2]);
      });

      return createDataFrame({
        refId,
        name: QueryType.metrics,
        fields: [
          { name: 'account', type: FieldType.string, values: accounts },
          { name: 'p50', type: FieldType.number, values: p50Values, config: { unit: 'ms' } },
          { name: 'p95', type: FieldType.number, values: p95Values, config: { unit: 'ms' } },
          { name: 'p99', type: FieldType.number, values: p99Values, config: { unit: 'ms' } },
        ],
        meta: {
          preferredVisualisationType: 'table',
          ...metricsResponse.meta,
        },
      });
    }

    // No recognized shape: return empty table with correct columns
    return createDataFrame({
      refId,
      name: QueryType.metrics,
      fields: [
        { name: 'account', type: FieldType.string, values: [] },
        { name: 'p50', type: FieldType.number, values: [], config: { unit: 'ms' } },
        { name: 'p95', type: FieldType.number, values: [], config: { unit: 'ms' } },
        { name: 'p99', type: FieldType.number, values: [], config: { unit: 'ms' } },
      ],
      meta: {
        preferredVisualisationType: 'table',
        ...metricsResponse.meta,
      },
    });
  }

  /**
   * Creates a time series DataFrame with proper labels for each series
   * Groups data by account and creates separate value fields for each account
   */
  private createTimeSeriesDataFrame(refId: string, metricsResponse: O11yQueryResponse): DataFrame {
    // Find the fields we need
    const timeField = metricsResponse.fields.find((f) => f.name === O11Y_API_TIMESTAMP_COLUMN);
    const accountField = metricsResponse.fields.find((f) => f.name === 'account');
    const metricNameField = metricsResponse.fields.find((f) => f.name === 'MetricName');
    const appField = metricsResponse.fields.find((f) => f.name === 'app');
    const statusCodeField = metricsResponse.fields.find((f) => f.name === 'status_code');
    
    // Find the value field (could be Sum, Value, or Count depending on metric type)
    const valueField = metricsResponse.fields.find(
      (f) => f.name === 'Sum' || f.name === 'Value' || f.name === 'Count'
    );

    if (!timeField || !accountField || !valueField) {
      console.error('[VTEX Datasource] Missing required fields for time series', {
        hasTime: !!timeField,
        hasAccount: !!accountField,
        hasValue: !!valueField,
      });
      return createDataFrame({
        refId,
        name: QueryType.metrics,
        fields: [],
      });
    }

    // Group data by timestamp first, then by series key (account or account+status)
    const timeMap = new Map<number, Map<string, number>>();
    const allSeries = new Map<string, { account: string; statusCode?: string }>();
    let metricName = '';
    let appName = '';

    for (let i = 0; i < timeField.values.length; i++) {
      const account = accountField.values[i];
      const statusCode = statusCodeField ? statusCodeField.values[i] : undefined;
      const time = typeof timeField.values[i] === 'string' 
        ? new Date(timeField.values[i]).getTime() 
        : timeField.values[i];
      const value = valueField.values[i];

      // Create a unique series key based on whether we have status code
      const seriesKey = statusCode ? `${account}-${statusCode}` : account;
      
      if (!allSeries.has(seriesKey)) {
        allSeries.set(seriesKey, { account, statusCode });
      }
      
      if (metricNameField && !metricName) {
        metricName = metricNameField.values[i];
      }
      if (appField && !appName) {
        appName = appField.values[i];
      }

      if (!timeMap.has(time)) {
        timeMap.set(time, new Map());
      }
      
      timeMap.get(time)!.set(seriesKey, value);
    }

    // Sort timestamps
    const sortedTimes = Array.from(timeMap.keys()).sort((a, b) => a - b);
    
    // Create fields: one time field and one value field per series
    const fields: any[] = [
      {
        name: 'Time',
        type: FieldType.time,
        values: sortedTimes,
      }
    ];

    // Add a value field for each series (account or account+status)
    allSeries.forEach((seriesInfo, seriesKey) => {
      const values = sortedTimes.map((time) => {
        const seriesData = timeMap.get(time);
        return seriesData?.get(seriesKey) ?? null;
      });

      // Create display name and labels based on whether we have status code
      const displayName = seriesInfo.statusCode 
        ? `${seriesInfo.account} (${seriesInfo.statusCode})`
        : seriesInfo.account;

      const labels: Record<string, string> = {
        account: seriesInfo.account,
        metric: metricName,
        app: appName,
      };

      if (seriesInfo.statusCode) {
        labels.status_code = seriesInfo.statusCode;
      }

      fields.push({
        name: displayName,
        type: FieldType.number,
        values: values,
        labels,
        config: {
          displayNameFromDS: displayName,
        },
      });
    });

    return createDataFrame({
      refId,
      name: QueryType.metrics,
      fields,
      meta: {
        preferredVisualisationType: 'graph',
        ...metricsResponse.meta,
      },
    });
  }

  /**
   * Calculates the bucket size in milliseconds for the logs volume histogram.
   * Aims for ~60-120 thin bars to produce a sparse histogram similar to
   * Victoria Logs' Explore view.
   */
  private calcVolumeBucketMs(fromTime: number, toTime: number): number {
    const rangeMs = toTime - fromTime;
    const SECOND = 1000;
    const MINUTE = 60 * SECOND;
    const HOUR = 60 * MINUTE;
    const DAY = 24 * HOUR;

    if (rangeMs <= 15 * MINUTE) {
      return 10 * SECOND;
    } else if (rangeMs <= HOUR) {
      return 30 * SECOND;
    } else if (rangeMs <= 6 * HOUR) {
      return 5 * MINUTE;
    } else if (rangeMs <= DAY) {
      return 15 * MINUTE;
    } else if (rangeMs <= 7 * DAY) {
      return HOUR;
    } else {
      return DAY;
    }
  }

  /**
   * Creates an array of time-series DataFrames for the Logs Volume histogram.
   * Receives raw TimestampTime + level rows from the API and buckets them client-side.
   * Returns one DataFrame per log level, each with Time + count value fields.
   * Grafana uses these to render the stacked bar chart above log lines in Explore.
   */
  private createLogsVolumeDataFrames(
    refId: string,
    apiResponse: O11yQueryResponse,
    fromTime: number,
    toTime: number,
    sourceQuery: AppQuery
  ): DataFrame[] {
    const timeField = apiResponse.fields.find((f) => f.name === O11Y_API_TIMESTAMP_COLUMN);
    const levelField = apiResponse.fields.find((f) => f.name === 'level');

    if (!timeField) {
      console.error('[VTEX Datasource] Missing TimestampTime field for logs volume');
      return [];
    }

    const bucketMs = this.calcVolumeBucketMs(fromTime, toTime);

    // Build bucket index: level -> bucketStart -> count
    const levelBuckets = new Map<string, Map<number, number>>();

    for (let i = 0; i < timeField.values.length; i++) {
      const level: string = levelField ? String(levelField.values[i] ?? 'unknown') : 'unknown';
      const timeRaw = timeField.values[i];
      const timeMs = typeof timeRaw === 'string' ? new Date(timeRaw).getTime() : (timeRaw as number);
      const bucket = Math.floor(timeMs / bucketMs) * bucketMs;

      if (!levelBuckets.has(level)) {
        levelBuckets.set(level, new Map());
      }
      const bucketMap = levelBuckets.get(level)!;
      bucketMap.set(bucket, (bucketMap.get(bucket) ?? 0) + 1);
    }

    // Build the full set of evenly-spaced buckets that covers the entire query range.
    // This ensures Grafana renders thin bars with visible gaps (matching Victoria Logs style)
    // instead of a few wide solid blocks.
    const sortedBuckets: number[] = [];
    const rangeStart = Math.floor(fromTime / bucketMs) * bucketMs;
    for (let t = rangeStart; t <= toTime; t += bucketMs) {
      sortedBuckets.push(t);
    }

    // If there's no data at all, surface a single "unknown" level with all-zero buckets
    // so the histogram still renders as an empty chart.
    if (levelBuckets.size === 0) {
      levelBuckets.set('unknown', new Map());
    }

    const customMeta: Record<string, unknown> = {
      logsVolumeType: LogsVolumeType.FullRange,
      absoluteRange: { from: fromTime, to: toTime },
      datasourceName: this.instanceSettings.name,
      sourceQuery,
    };

    return Array.from(levelBuckets.entries()).map(([level, bucketMap]) => {
      const times = sortedBuckets;
      const counts = sortedBuckets.map((t) => bucketMap.get(t) ?? 0);

      return createDataFrame({
        refId,
        name: level,
        fields: [
          {
            name: 'Time',
            type: FieldType.time,
            values: times,
          },
          {
            name: 'Value',
            type: FieldType.number,
            values: counts,
            labels: { level },
            config: { displayNameFromDS: level },
          },
        ],
        meta: {
          type: DataFrameType.TimeSeriesMany,
          preferredVisualisationType: 'graph',
          custom: customMeta,
        },
      });
    });
  }

  /**
   * Creates a logs DataFrame with the minimal required structure and individual attribute fields
   */
  private createLogsDataFrame(refId: string, apiResponse: O11yQueryResponse): DataFrame {
    const timeField =
      apiResponse.fields.find((f) => f.name === O11Y_API_TIMESTAMP_COLUMN) ||
      apiResponse.fields.find((f) => f.name === 'Timestamp');
    const messageField = apiResponse.fields.find((f) => f.name === 'data' || f.name === 'message' || f.name === 'body');

    if (!timeField) {
      console.error(`[VTEX Datasource] No time field found in logs data`);
      throw new Error('No time field found in logs data');
    }

    // Convert time values to milliseconds
    const timeValues = timeField.values.map((value: any) => {
      if (typeof value === 'string') {
        return new Date(value).getTime();
      }
      return value;
    });

    const rowCount = timeValues.length;

    // Get message values
    const messageValues = messageField
      ? messageField.values
      : new Array(rowCount).fill('No message available');

    // Collect all labels into a single labels field
    const labelsArray: Array<Record<string, any>> = [];

    // Initialize labels array with empty objects for each row
    for (let i = 0; i < rowCount; i++) {
      labelsArray.push({});
    }

    // Identify fields that should be excluded from individual field creation
    const excludedFieldNames = [
      O11Y_API_TIMESTAMP_COLUMN,
      'Timestamp',
      'data',
      'message',
      'body',
    ];

    // Build array of individual attribute fields
    const attributeFields: Array<{ name: string; type: FieldType; values: any[]; config?: { filterable?: boolean } }> = [];
    const processedFieldNames = new Set<string>(); // Track processed field names to avoid duplicates

    // Populate labels and create individual fields from all fields except timestamp and message
    for (const field of apiResponse.fields) {
      // Skip excluded fields and already processed fields to avoid duplicates
      if (!excludedFieldNames.includes(field.name) && !processedFieldNames.has(field.name)) {
        processedFieldNames.add(field.name);
        // Determine field type based on values
        let fieldType = FieldType.string;
        const sampleValues = field.values.filter((v: any) => v != null && v !== '');
        
        if (sampleValues.length > 0) {
          const allNumbers = sampleValues.every((v: any) => typeof v === 'number' || (!isNaN(Number(v)) && v !== ''));
          const allBooleans = sampleValues.every((v: any) => typeof v === 'boolean' || v === 'true' || v === 'false');
          
          if (allBooleans) {
            fieldType = FieldType.boolean;
          } else if (allNumbers) {
            fieldType = FieldType.number;
          }
        }

        // Create values array, filling missing values with null
        const fieldValues = new Array(rowCount);
        field.values.forEach((value: any, index: number) => {
          if (index < rowCount) {
            // Convert boolean strings to actual booleans
            if (fieldType === FieldType.boolean && typeof value === 'string') {
              fieldValues[index] = value === 'true';
            } else if (fieldType === FieldType.number && typeof value === 'string' && value !== '') {
              fieldValues[index] = Number(value);
            } else {
              fieldValues[index] = value ?? null;
            }
          }
        });
        
        // Fill remaining slots with null
        for (let i = field.values.length; i < rowCount; i++) {
          fieldValues[i] = null;
        }

        // Add to labels array
        field.values.forEach((value: any, index: number) => {
          if (index < labelsArray.length) {
            labelsArray[index][field.name] = value;
          }
        });

        // Add individual field for filtering
        // Only allow filtering on specific fields: account, workspace, and level
        const filterableFields = ['account', 'workspace', 'level'];
        const isFilterable = filterableFields.includes(field.name);
        
        attributeFields.push({
          name: field.name,
          type: fieldType,
          values: fieldValues,
          config: isFilterable ? {
            filterable: true,
          } : undefined,
        });
      }
    }

    // Build fields array: timestamp, body, individual attribute fields, labels
    const fields: Array<Partial<Field>> = [
      {
        name: 'timestamp',
        type: FieldType.time,
        values: timeValues,
      },
      {
        name: 'body',
        type: FieldType.string,
        values: messageValues,
      },
      ...attributeFields,
      {
        name: 'labels',
        type: FieldType.other,
        values: labelsArray,
      },
    ];

    // Create the DataFrame using createDataFrame with the expected format
    const dataFrame = createDataFrame({
      fields,
      meta: {
        type: DataFrameType.LogLines,
        preferredVisualisationType: 'logs',
      },
    });

    // Ensure filterable config is preserved only on specific fields: account, workspace, and level
    // This enables Grafana to show filter icons (+ and -) in log details view for these fields only
    const filterableFields = ['account', 'workspace', 'level'];
    dataFrame.fields.forEach((field) => {
      // Only set filterable on account, workspace, and level fields
      if (filterableFields.includes(field.name)) {
        if (!field.config) {
          field.config = {};
        }
        field.config.filterable = true;
      }
    });

    return dataFrame;
  }

  /**
   * Extracts a user-friendly error message from an error object
   */
  private extractErrorMessage(error: any): string {
    // Check if it's a Grafana fetch error
    if (isFetchError(error)) {
      const statusInfo = error.status ? `HTTP ${error.status}` : '';
      let message = error.statusText || 'Unknown error';
      
      // Check for timeout errors
      if (error.status === 0 || error.statusText?.toLowerCase().includes('timeout') || 
          error.message?.toLowerCase().includes('timeout') ||
          error.cancelled) {
        const timeoutSeconds = API_REQUEST_TIMEOUT_MS / 1000;
        return `Request timeout: The request took longer than ${timeoutSeconds} seconds to complete`;
      }
      
      // Try to extract error message from response data
      if (error.data) {
        try {
          // Handle different response formats
          if (typeof error.data === 'string') {
            // Try to parse as JSON
            try {
              const parsed = JSON.parse(error.data);
              if (parsed.error) {
                message = parsed.error;
              }
            } catch {
              // If not JSON, use the string as-is
              message = error.data;
            }
          } else if (typeof error.data === 'object') {
            // Check for common error fields
            if (error.data.error) {
              message = typeof error.data.error === 'string' 
                ? error.data.error 
                : JSON.stringify(error.data.error);
            } else if (error.data.message) {
              message = error.data.message;
            }
          }
        } catch (parseErr) {
          // If parsing fails, use statusText
          console.error('[VTEX Datasource] Error parsing error response:', parseErr);
        }
      }
      
      return statusInfo ? `${statusInfo}: ${message}` : message;
    }
    
    // Handle standard Error objects (including timeout errors)
    if (error instanceof Error) {
      const errorMessage = error.message.toLowerCase();
      if (errorMessage.includes('timeout') || errorMessage.includes('timed out')) {
        const timeoutSeconds = API_REQUEST_TIMEOUT_MS / 1000;
        return `Request timeout: The request took longer than ${timeoutSeconds} seconds to complete`;
      }
      return error.message;
    }
    
    // Fallback for unknown error types
    return String(error) || 'Unknown error occurred';
  }

  /**
   * Checks whether we can connect to the API.
   */
  async testDatasource() {
    // Check if tenant is configured
    if (!this.http.IsApiConfigured()) {
      return {
        status: 'error',
        message: 'App Key and App Token are required. Please configure their values first.',
      };
    }

    try {
      // Test connectivity by attempting to fetch log fields (should be a lightweight operation)
      await this.http.FetchLogsFields();

      return {
        status: 'success',
        message: `Successfully connected to VTEX Observability Platform.`,
      };
    } catch (err: any) {
      return {
        status: 'error',
        message: `Failed to connect to VTEX Observability Platform: ${err.statusText}`,
      };
    }
  }
}
