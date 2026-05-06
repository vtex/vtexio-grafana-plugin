import { DataSourceJsonData } from '@grafana/data';
import { DataQuery } from '@grafana/schema';

export enum QueryType {
  logs = 'logs',
  metrics = 'metrics',
  logsVolume = 'logsVolume',
}

export enum MetricType {
  gauge = 'gauge',
  sum = 'sum',
  counter = 'counter',
  histogram = 'histogram',
}

export enum PredefinedMetricType {
  REQUEST_RATE = 'REQUEST_RATE',
  ERROR_RATE_BY_HANDLER = 'ERROR_RATE_BY_HANDLER',
  LATENCY_STATS_BY_ACCOUNT_AND_HANDLER = 'LATENCY_STATS_BY_ACCOUNT_AND_HANDLER',
  LATENCY_STATS_PER_ACCOUNT = 'LATENCY_STATS_PER_ACCOUNT',
  LATENCY_P50_PER_HANDLER = 'LATENCY_P50_PER_HANDLER',
  LATENCY_P90_PER_HANDLER = 'LATENCY_P90_PER_HANDLER',
  LATENCY_P99_PER_HANDLER = 'LATENCY_P99_PER_HANDLER',
}

export interface AppQuery extends DataQuery {
  queryType: QueryType;
  filters: QueryFilter[];
  orders: Order[];
  pageSize: number;
  predefinedMetric?: PredefinedMetricType;
  appName?: string;
  metricType?: MetricType;
}

export const DEFAULT_QUERY: Partial<AppQuery> = {
  queryType: QueryType.logs,
  filters: [],
  orders: [
    {
      column: 'TimestampTime',
      dir: 'desc',
    },
  ],
  pageSize: 100,
  metricType: MetricType.sum, // Default to sum for backward compatibility
};

export interface Order {
  column: string;
  dir: 'asc' | 'desc';
}

/**
 * API Request payload for querying both logs and metrics
 */
export interface O11yQueryRequest {
  page: number;
  pageSize: number;
  filters: QueryFilter[];
  orders: Order[];
  columns?: string[];
  group_by?: { columns: string[] };
}

/**
 * Column definition from API response
 */
export interface O11yColumn {
  name: string;
  type: string;
  database_type: string;
}

/**
 * Grafana field structure (matches what the API now returns)
 */
export interface GrafanaField {
  name: string;
  type: string; // 'time', 'number', 'string', 'other'
  values: any[];
  labels?: Record<string, any>;
}

/**
 * API Response structure for query endpoints (now returns Grafana DataFrame format)
 */
export interface O11yQueryResponse {
  refId: string;
  name: string;
  fields: GrafanaField[];
  meta?: Record<string, any>;
}

/**
 * Fields API Response structure
 */
export interface O11yFieldsResponse {
  success?: boolean;
  fields?: Array<{
    name: string;
    type: string;
    description?: string;
  }>;
  error?: string;
}

// Legacy interface for backward compatibility
export interface DataSourceResponse {
  data?: any;
  status?: number;
  statusText?: string;
}

/**
 * These are options configured for each DataSource instance
 */
export interface VTEXIODataSourceOptions extends DataSourceJsonData {
  appKey: string;
  tenant?: string;
}

/**
 * Apps API Response structure
 */
export interface AppsResponse {
  LogsApps: string[];
  MetricsApps: string[];
}

export interface Endpoints {
  APPS: string
  LOGS_FIELDS: string
  LOGS_QUERY: string
  METRICS_FIELDS: string
  METRICS_QUERY: string
};

/**
 * Value that is used in the backend, but never sent over HTTP to the frontend
 */
export interface VTEXIOSecureJsonData {
  appToken: string;
}

export interface QueryFilter {
  column: string;
  operator: string;
  type: string;
  value: string;
}

export interface FetchBodyParams {
  pageSize?: number;
  fromTime: number;
  toTime: number;
  app: string;
  predefinedMetric?: PredefinedMetricType;
  metricType?: MetricType;
  filters?: QueryFilter[];
}

export interface ListUrlParams {
  fromTime?: number;
  toTime?: number;
}

export interface ListEndpointParams {
  app?: string;
}

export interface FieldsResponse {
  Fields: {
    name: string;
    type: string;
  };
}
