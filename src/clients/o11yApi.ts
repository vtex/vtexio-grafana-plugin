import { getBackendSrv, isFetchError } from '@grafana/runtime';
import format from 'string-format';
import { lastValueFrom } from 'rxjs';
import {
  AppsResponse,
  DataSourceResponse,
  Endpoints,
  FetchBodyParams,
  FieldsResponse,
  ListEndpointParams,
  ListUrlParams,
  O11yQueryRequest,
  O11yQueryResponse,
  PredefinedMetricType,
  QueryFilter,
} from 'types';

export const O11Y_API_TIMESTAMP_COLUMN = 'TimestampTime';

// API request timeout in milliseconds (30 seconds)
export const API_REQUEST_TIMEOUT_MS = 30000;

interface O11yApi {
  IsApiConfigured(): boolean;
  ListApps(urlParams: ListUrlParams): Promise<AppsResponse>;

  FetchLogsFields(): Promise<FieldsResponse>;
  FetchMetricsFields(): Promise<FieldsResponse>;

  FetchLogs(bodyParams: FetchBodyParams): Promise<O11yQueryResponse>;
  FetchMetrics(bodyParams: FetchBodyParams): Promise<O11yQueryResponse>;
  FetchLogsVolume(bodyParams: FetchBodyParams): Promise<O11yQueryResponse>;
}

abstract class O11yApiClient implements O11yApi {
  proxyUrl: string | null;
  tenant: string;
  useTenantInUrl: boolean;
  _proxyPaths: Endpoints

  constructor(prefix: string, proxyUrl: string | null, tenant: string, useTenantInUrl: boolean) {
    this.proxyUrl = proxyUrl;
    this.tenant = tenant;
    this.useTenantInUrl = useTenantInUrl;
    this._proxyPaths = {
      APPS: `${prefix}/apps`,
      LOGS_FIELDS: `${prefix}/logs/fields`,
      LOGS_QUERY: `${prefix}/logs/query`,
      METRICS_FIELDS: `${prefix}/metrics/fields`,
      METRICS_QUERY: `${prefix}/metrics/query`,
    };
  }

  IsApiConfigured() {
    return this.tenant !== '' && this.tenant.trim().length > 0;
  }

  formatUrl(url: string, data?: object) {
    return format(url, { tenant: this.useTenantInUrl ? '' : `${this.tenant}/`, ...data });
  }

  buildUnixTimestampQueryParams({ fromTime, toTime }: ListUrlParams): string {
    const from = fromTime || Date.now() - 60 * 60 * 1000; // 1 hour ago
    const to = toTime || Date.now();

    // Convert to Unix timestamp (seconds)
    const fromUnix = Math.floor(from / 1000);
    const toUnix = Math.floor(to / 1000);

    return `fromTime=${fromUnix}&toTime=${toUnix}`;
  }

  buildTimestampFilters(bodyParams: FetchBodyParams): QueryFilter[] {
    const { fromTime, toTime } = bodyParams;
    return [
      {
        column: O11Y_API_TIMESTAMP_COLUMN,
        operator: '>=',
        type: 'timestamp',
        value: new Date(fromTime).toISOString(),
      },
      {
        column: O11Y_API_TIMESTAMP_COLUMN,
        operator: '<=',
        type: 'timestamp',
        value: new Date(toTime).toISOString(),
      },
    ];
  }

  buildFetchFilters(bodyParams: FetchBodyParams): QueryFilter[] {
    const { app, predefinedMetric, filters: uiFilters = [] } = bodyParams;

    const baseFilters: QueryFilter[] = [
      {
        column: 'app',
        operator: '=',
        type: 'string',
        value: app,
      },
    ];

    // For all predefined request counting metrics, use runtime_http_requests_total
    if (predefinedMetric === PredefinedMetricType.REQUEST_RATE || predefinedMetric === PredefinedMetricType.ERROR_RATE_BY_HANDLER) {
      baseFilters.push({
        column: 'MetricName',
        operator: '=',
        type: 'string',
        value: 'runtime_http_requests_total',
      });
    }

    // For latency stats (histogram), use duration histogram metric
    if (
      predefinedMetric === PredefinedMetricType.LATENCY_STATS_BY_ACCOUNT_AND_HANDLER ||
      predefinedMetric === PredefinedMetricType.LATENCY_STATS_PER_ACCOUNT ||
      predefinedMetric === PredefinedMetricType.LATENCY_P50_PER_HANDLER ||
      predefinedMetric === PredefinedMetricType.LATENCY_P90_PER_HANDLER ||
      predefinedMetric === PredefinedMetricType.LATENCY_P99_PER_HANDLER
    ) {
      baseFilters.push(
        {
          column: 'MetricName',
          operator: '=',
          type: 'string',
          value: 'runtime_http_requests_duration_milliseconds',
        },
        {
          column: 'MetricType',
          operator: '=',
          type: 'string',
          value: 'histogram',
        }
      );
    }

    // Merge UI filters with base filters, preserving base filters when there's a conflict.
    // A conflict is when both have the same column and operator. Base filters constrain
    // the selected app and predefined metric shape, so panel filters must not override them.
    const mergedFilters: QueryFilter[] = [...baseFilters];
    const filterKeys = new Set(baseFilters.map((f) => `${f.column}:${f.operator}`));

    for (const uiFilter of uiFilters) {
      const key = `${uiFilter.column}:${uiFilter.operator}`;
      if (!filterKeys.has(key)) {
        // Add UI filter if no conflict
        mergedFilters.push(uiFilter);
        filterKeys.add(key);
      }
    }

    return mergedFilters;
  }

  buildMetricsColumns(predefinedMetric?: PredefinedMetricType): string[] {
    const baseColumns = ['TimestampTime', 'account', 'MetricName', 'MetricType', 'app'];

    // For request counting metrics, always use sum aggregation
    if (predefinedMetric === PredefinedMetricType.REQUEST_RATE) {
      return [...baseColumns, 'sumMerge(Sum) as Sum'];
    }
    if (predefinedMetric === PredefinedMetricType.ERROR_RATE_BY_HANDLER) {
      // Error rate by handler and app over time: same time handling as REQUEST_RATE (TimestampTime as-is)
      //Doesn't use account to count the error rate, only app and handler
      return [
        'TimestampTime',
        'app',
        "ifNull(Attributes['handler'], 'unknown') as handler",
        'count() AS total_requests',
        "countIf(toUInt16(Attributes['status_code']) >= 400) AS error_count",
        'if(total_requests = 0, 0, (error_count / total_requests) * 100) AS error_rate',
      ];
    }

    // Latency stats per account and handler: account, handler, and histogram bucket columns (API returns ExplicitBounds, BucketCounts)
    if (predefinedMetric === PredefinedMetricType.LATENCY_STATS_BY_ACCOUNT_AND_HANDLER) {
      return [
        'TimestampTime',
        'account',
        "ifNull(Attributes['handler'], 'unknown') as handler",
        'anyMerge(ExplicitBounds) AS ExplicitBounds',
        'sumForEachMerge(BucketCounts) AS BucketCounts',
      ];
    }

    // Latency stats per account only: account and histogram bucket columns (no handler)
    if (predefinedMetric === PredefinedMetricType.LATENCY_STATS_PER_ACCOUNT) {
      return [
        'TimestampTime',
        'account',
        'anyMerge(ExplicitBounds) AS ExplicitBounds',
        'sumForEachMerge(BucketCounts) AS BucketCounts',
      ];
    }

    // Latency P50/P90/P99 per handler (chart): same columns as latency stats by account and handler
    if (
      predefinedMetric === PredefinedMetricType.LATENCY_P50_PER_HANDLER ||
      predefinedMetric === PredefinedMetricType.LATENCY_P90_PER_HANDLER ||
      predefinedMetric === PredefinedMetricType.LATENCY_P99_PER_HANDLER
    ) {
      return [
        'TimestampTime',
        'account',
        "ifNull(Attributes['handler'], 'unknown') as handler",
        'anyMerge(ExplicitBounds) AS ExplicitBounds',
        'sumForEachMerge(BucketCounts) AS BucketCounts',
      ];
    }

    // Default fallback (should not be reached with predefined metrics)
    return [...baseColumns, 'sumMerge(Sum) as Sum'];
  }

  async ListUsingGet({ proxyPath, urlParams, endpointParams, serverPath }: { proxyPath: string; urlParams?: ListUrlParams; endpointParams?: ListEndpointParams; serverPath?: string; }) {
    const uri = this.formatUrl(proxyPath, endpointParams);

    const queryParams = urlParams ? this.buildUnixTimestampQueryParams(urlParams) : undefined;

    const response = await this.request(uri, {
      method: 'GET',
      serverPath,
      params: queryParams,
    });

    return response.data;
  }

  async ListApps(urlParams: ListUrlParams): Promise<AppsResponse> {
    const apps = await this.ListUsingGet({ proxyPath: this._proxyPaths.APPS, urlParams });
    return apps as AppsResponse;
  }

  async FetchLogsFields(): Promise<FieldsResponse> {
    const fields = await this.ListUsingGet({ proxyPath: this._proxyPaths.LOGS_FIELDS });
    return fields as FieldsResponse;
  }

  async FetchMetricsFields(): Promise<FieldsResponse> {
    const fields = await this.ListUsingGet({ proxyPath: this._proxyPaths.METRICS_FIELDS });
    return fields as FieldsResponse;
  }

  async fetchUsingPost(endpoint: string, bodyParams: FetchBodyParams, columns?: string[]) {
    const url = this.formatUrl(endpoint);
    const timeFilters = this.buildTimestampFilters(bodyParams);
    const fetchFilters = this.buildFetchFilters(bodyParams);

    const isErrorRateByHandler =
      bodyParams.predefinedMetric === PredefinedMetricType.ERROR_RATE_BY_HANDLER;
    const isLatencyStats =
      bodyParams.predefinedMetric === PredefinedMetricType.LATENCY_STATS_BY_ACCOUNT_AND_HANDLER;
    const isLatencyStatsPerAccount =
      bodyParams.predefinedMetric === PredefinedMetricType.LATENCY_STATS_PER_ACCOUNT;
    const isLatencyPercentileByHandler =
      bodyParams.predefinedMetric === PredefinedMetricType.LATENCY_P50_PER_HANDLER ||
      bodyParams.predefinedMetric === PredefinedMetricType.LATENCY_P90_PER_HANDLER ||
      bodyParams.predefinedMetric === PredefinedMetricType.LATENCY_P99_PER_HANDLER;

    const requestPayload: O11yQueryRequest = {
      page: 1,
      pageSize: bodyParams.pageSize || 100,
      filters: [...timeFilters, ...fetchFilters],
      orders:
        isErrorRateByHandler || isLatencyPercentileByHandler
          ? [{ column: O11Y_API_TIMESTAMP_COLUMN, dir: 'asc' }]
          : [{ column: O11Y_API_TIMESTAMP_COLUMN, dir: 'desc' }],
    };

    if (isErrorRateByHandler) {
      requestPayload.group_by = { columns: [O11Y_API_TIMESTAMP_COLUMN, 'app', 'handler'] };
    }
    if (isLatencyStats || isLatencyPercentileByHandler) {
      requestPayload.group_by = { columns: [O11Y_API_TIMESTAMP_COLUMN, 'account', 'handler'] };
    }
    if (isLatencyStatsPerAccount) {
      requestPayload.group_by = { columns: [O11Y_API_TIMESTAMP_COLUMN, 'account'] };
    }

    // Only add columns if provided (for metrics queries)
    if (columns) {
      requestPayload.columns = columns;
    }

    // FIXME: Remove verbose logging before moving out of beta
    // eslint-disable-next-line no-console
    console.log('🔧 [O11yApi] Built request payload:', {
      endpoint,
      payload: requestPayload,
      hasColumns: !!columns
    });

    const response = await this.request(url, {
      method: 'POST',
      data: requestPayload,
    });

    // Parse the response according to the new Grafana DataFrame API structure
    const apiResponse = response.data as O11yQueryResponse;
    
    // FIXME: Remove verbose logging before moving out of beta
    // eslint-disable-next-line no-console
    console.log('✨ [O11yApi] Parsed API response:', {
      endpoint,
      fieldCount: apiResponse.fields?.length || 0,
      fields: apiResponse.fields?.map(f => ({ name: f.name, type: f.type, valueCount: f.values?.length || 0 })),
      refId: apiResponse.refId
    });
    
    return apiResponse;
  }

  async FetchLogs(bodyParams: FetchBodyParams) {
    // FIXME: Remove verbose logging before moving out of beta
    // eslint-disable-next-line no-console
    console.log('📋 [O11yApi] FetchLogs called with params:', {
      app: bodyParams.app,
      pageSize: bodyParams.pageSize,
      timeRange: {
        from: new Date(bodyParams.fromTime).toISOString(),
        to: new Date(bodyParams.toTime).toISOString(),
      }
    });
    return await this.fetchUsingPost(this._proxyPaths.LOGS_QUERY, bodyParams);
  }

  async FetchMetrics(bodyParams: FetchBodyParams) {
    const columns = this.buildMetricsColumns(bodyParams.predefinedMetric);
    // FIXME: Remove verbose logging before moving out of beta
    // eslint-disable-next-line no-console
    console.log('📈 [O11yApi] FetchMetrics called with params:', {
      app: bodyParams.app,
      predefinedMetric: bodyParams.predefinedMetric,
      pageSize: bodyParams.pageSize,
      timeRange: {
        from: new Date(bodyParams.fromTime).toISOString(),
        to: new Date(bodyParams.toTime).toISOString(),
      },
      columns: columns
    });
    return await this.fetchUsingPost(this._proxyPaths.METRICS_QUERY, bodyParams, columns);
  }

  async FetchLogsVolume(bodyParams: FetchBodyParams) {
    const url = this.formatUrl(this._proxyPaths.LOGS_QUERY);
    const timeFilters = this.buildTimestampFilters(bodyParams);
    const fetchFilters = this.buildFetchFilters(bodyParams);

    // Fetch raw TimestampTime + level rows; client-side bucketing is applied in createLogsVolumeDataFrames.
    // The logs API column allowlist rejects ClickHouse expressions like toStartOfInterval().
    // TODO: A single page of 10k rows may undercount/skew the histogram for busy apps
    // or wide time ranges (older buckets may not be fetched). Consider pagination or a
    // server-side aggregation endpoint if the API ever supports it.
    const requestPayload: O11yQueryRequest = {
      page: 1,
      pageSize: 10000,
      filters: [...timeFilters, ...fetchFilters],
      orders: [{ column: O11Y_API_TIMESTAMP_COLUMN, dir: 'desc' }],
      columns: [O11Y_API_TIMESTAMP_COLUMN, 'level'],
    };

    // FIXME: Remove verbose logging before moving out of beta
    // eslint-disable-next-line no-console
    console.log('📊 [O11yApi] FetchLogsVolume called with params:', {
      app: bodyParams.app,
      timeRange: {
        from: new Date(bodyParams.fromTime).toISOString(),
        to: new Date(bodyParams.toTime).toISOString(),
      },
    });

    const response = await this.request(url, {
      method: 'POST',
      data: requestPayload,
    });

    return response.data as O11yQueryResponse;
  }

  handleApiError(err: any) {
    console.error(`[VTEX Datasource] Request failed:`, err);

    let errorMessage = `Request failed`;

    if (isFetchError(err)) {
      const statusInfo = err.status ? ` (HTTP ${err.status})` : '';
      errorMessage += `${statusInfo}: ${err.statusText || 'Unknown error'}`;

      if (err.data) {
        try {
          const responseBody = typeof err.data === 'string' ? err.data : JSON.stringify(err.data);
          errorMessage += `. Response: ${responseBody}`;
        } catch (jsonErr) {
          errorMessage += `. Response body could not be parsed.`;
        }
      }
    } else if (err instanceof Error) {
      errorMessage += `: ${err.message}`;
    }

    throw new Error(errorMessage);
  }

  /**
   * Sends an HTTP request to the configured proxy endpoint using Grafana's backend service.
   *
   * @param proxyPath - The path to append to the proxy URL (e.g., 'apps', 'logs/query', etc.).
   *   Should match exactly a `path` property under `plugin.json>routes[]>path`
   * @param options - Optional request options:
   *   - method: HTTP method ('GET' or 'POST'). Defaults to 'GET'.
   *   - params: URL query parameters as a string (appended as "?params").
   *   - data: Request payload/body for POST requests.
   *   - endpointEnding: Optional string to add to the end of the endpoint path. This ending will
   *     be appended to the url under `plugin.json>routes[]>url` and is useful to forward extra
   *     endpoint information that cannot be obtained from the `jsonData/secureJsonData` configuration
   *     alone. In a nutshell, Grafana Data Source Proxy will take a request to
   *     `this.proxyUrl` + `plugin.json>routes[]>path` + `endpointEnding` + `params`
   *     and forward it to
   *     `plugin.json>routes[]>url` + `endpointEnding` + `params`
   *   - headers: Additional request headers as key-value pairs.
   * @returns The HTTP response as a DataSourceResponse object.
   * @throws If the network request fails or times out (after 30 seconds), it logs enhanced error details and re-throws the error.
   */
  async request(
    proxyPath: string,
    options: {
      method?: 'GET' | 'POST';
      params?: string;
      data?: any;
      serverPath?: string
      headers?: Record<string, string>;
    } = {}
  ) {
    const { method = 'GET', params, data, headers = {}, serverPath } = options;
    const fullUrl = `${this.proxyUrl}/${proxyPath}${serverPath ? `/${serverPath}` : ''}${params?.length ? `?${params}` : ''}`;

    // FIXME: Remove verbose logging before moving out of beta
    // Verbose request logging
    /* eslint-disable no-console */
    console.group(`🚀 [VTEX API Request] ${method} ${fullUrl}`);
    console.log('📍 Proxy Path:', proxyPath);
    console.log('🔧 Method:', method);
    console.log('🌐 Full URL:', fullUrl);
    if (params) {
      console.log('🔍 Query Params:', params);
    }
    if (serverPath) {
      console.log('📂 Server Path:', serverPath);
    }
    if (data) {
      console.log('📦 Request Body:', JSON.stringify(data, null, 2));
    }
    console.log('📋 Headers:', {
      'Content-Type': 'application/json',
      ...headers,
    });
    console.log('⏰ Timestamp:', new Date().toISOString());
    console.groupEnd();
    /* eslint-enable no-console */

    const startTime = performance.now();

    try {
      const response = getBackendSrv().fetch<DataSourceResponse>({
        url: fullUrl,
        method,
        data: method === 'POST' ? data : undefined,
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
      });

      const result = await lastValueFrom(response);
      const endTime = performance.now();
      const duration = (endTime - startTime).toFixed(2);

      // FIXME: Remove verbose logging before moving out of beta
      // Verbose response logging
      /* eslint-disable no-console */
      console.group(`✅ [VTEX API Response] ${method} ${fullUrl}`);
      console.log('⏱️ Duration:', `${duration}ms`);
      console.log('📊 Status:', result.status);
      console.log('📄 Status Text:', result.statusText);
      if (result.data) {
        const dataStr = JSON.stringify(result.data);
        console.log('📦 Response Size:', `${dataStr.length} characters`);
        console.log('📦 Response Data:', result.data);
      }
      console.groupEnd();
      /* eslint-enable no-console */

      return result;
    } catch (err: any) {
      const endTime = performance.now();
      const duration = (endTime - startTime).toFixed(2);

      // FIXME: Remove verbose logging before moving out of beta
      /* eslint-disable no-console */
      console.group(`❌ [VTEX API Error] ${method} ${fullUrl}`);
      console.log('⏱️ Duration:', `${duration}ms`);
      console.error('🚨 Error:', err);

      // Enhanced error logging
      if (err.status) {
        console.error('📊 HTTP Status:', err.status);
      }
      if (err.statusText) {
        console.error('📄 Status Text:', err.statusText);
      }
      if (err.data) {
        console.error('📦 Response Data:', err.data);
      }
      console.groupEnd();
      /* eslint-enable no-console */

      // Re-throw the error to be handled by the calling function
      throw err;
    }
  }
}

class LocalO11yApiClient extends O11yApiClient {
  constructor(tenant: string, proxyUrl: string | null = null, authToken: string | null = null) {
    super('local', proxyUrl, tenant, authToken !== null);
  }
}

class ProductionO11yApiClient extends O11yApiClient {
  constructor(tenant: string, proxyUrl: string | null = null, authToken: string | null = null) {
    super('remote', proxyUrl, tenant, authToken !== null);
  }
}

export { O11yApi, LocalO11yApiClient, ProductionO11yApiClient };
