import { AppsResponse, O11yQueryResponse, GrafanaField } from '../../../src/types';

// Timestamp column name used by the API (avoid importing from o11yApi to prevent browser dependency issues)
const O11Y_API_TIMESTAMP_COLUMN = 'TimestampTime';

/**
 * Creates a mock AppsResponse with customizable app lists
 */
export function createAppsResponse(options?: {
  logsApps?: string[];
  metricsApps?: string[];
}): AppsResponse {
  return {
    LogsApps: options?.logsApps || ['test-app-1', 'test-app-2', 'test-app-3'],
    MetricsApps: options?.metricsApps || ['test-app-1', 'test-app-2'],
  };
}

/**
 * Creates a mock logs query response with customizable fields and values
 */
export function createLogsResponse(options?: {
  refId?: string;
  recordCount?: number;
  timestamps?: number[];
  messages?: string[];
  accounts?: string[];
  workspaces?: string[];
  levels?: string[];
}): O11yQueryResponse {
  const recordCount = options?.recordCount || 2;
  const now = Date.now();
  const oneHourAgo = now - 3600000;

  const timestamps = options?.timestamps || [
    oneHourAgo,
    now,
  ];

  const messages = options?.messages || [
    'Test log message 1',
    'Test log message 2',
  ];

  const accounts = options?.accounts || ['test-account', 'test-account'];
  const workspaces = options?.workspaces || ['master', 'master'];
  const levels = options?.levels || ['info', 'error'];

  const fields: GrafanaField[] = [
    {
      name: O11Y_API_TIMESTAMP_COLUMN,
      type: 'time',
      values: timestamps.slice(0, recordCount),
    },
    {
      name: 'body',
      type: 'string',
      values: messages.slice(0, recordCount),
    },
    {
      name: 'account',
      type: 'string',
      values: accounts.slice(0, recordCount),
    },
    {
      name: 'workspace',
      type: 'string',
      values: workspaces.slice(0, recordCount),
    },
    {
      name: 'level',
      type: 'string',
      values: levels.slice(0, recordCount),
    },
  ];

  return {
    refId: options?.refId || 'A',
    name: 'logs',
    fields,
  };
}

/**
 * Creates a mock metrics query response with customizable fields and values
 */
export function createMetricsResponse(options?: {
  refId?: string;
  recordCount?: number;
  timestamps?: number[];
  accounts?: string[];
  values?: number[];
  metricName?: string;
  appName?: string;
  statusCodes?: string[];
  predefinedMetric?: 'REQUEST_RATE' | 'ERROR_RATE_BY_HANDLER';
}): O11yQueryResponse {
  const recordCount = options?.recordCount || 2;
  const now = Date.now();
  const oneHourAgo = now - 3600000;

  const timestamps = options?.timestamps || [oneHourAgo, now];
  const accounts = options?.accounts || ['test-account', 'test-account'];
  const values = options?.values || [100, 200];
  const metricName = options?.metricName || 'runtime_http_requests_total';
  const appName = options?.appName || 'test-app';

  const fields: GrafanaField[] = [
    {
      name: O11Y_API_TIMESTAMP_COLUMN,
      type: 'time',
      values: timestamps.slice(0, recordCount),
    },
    {
      name: 'account',
      type: 'string',
      values: accounts.slice(0, recordCount),
    },
    {
      name: 'MetricName',
      type: 'string',
      values: Array(recordCount).fill(metricName),
    },
    {
      name: 'MetricType',
      type: 'string',
      values: Array(recordCount).fill('counter'),
    },
    {
      name: 'app',
      type: 'string',
      values: Array(recordCount).fill(appName),
    },
  ];

  // Add status_code field if ERROR_RATE_BY_HANDLER
  if (options?.predefinedMetric === 'ERROR_RATE_BY_HANDLER' || options?.statusCodes) {
    const statusCodes = options?.statusCodes || ['200', '500'];
    fields.push({
      name: 'status_code',
      type: 'string',
      values: statusCodes.slice(0, recordCount),
    });
  }

  // Add value field (Sum, Value, or Count)
  fields.push({
    name: 'Sum',
    type: 'number',
    values: values.slice(0, recordCount),
  });

  return {
    refId: options?.refId || 'A',
    name: 'metrics',
    fields,
    meta: {
      preferredVisualisationType: 'graph',
    },
  };
}

/**
 * Creates a mock fields response for logs or metrics endpoints
 */
export function createFieldsResponse(options?: {
  fields?: Array<{ name: string; type: string }>;
}): Array<{ name: string; type: string }> {
  return (
    options?.fields || [
      { name: 'account', type: 'string' },
      { name: 'workspace', type: 'string' },
      { name: 'level', type: 'string' },
    ]
  );
}

/**
 * Creates a mock error response
 */
export function createErrorResponse(status: number, message?: string): { error: string } {
  return {
    error: message || `HTTP ${status} Error`,
  };
}

