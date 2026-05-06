import { AppsResponse, O11yQueryResponse } from '../../../src/types';

/**
 * Error configuration for API mocking
 */
export interface ApiErrorConfig {
  endpoint: string;
  status: number;
  message?: string;
}

/**
 * Configuration object for setting up API mocks in e2e tests
 */
export interface ApiMockConfig {
  /** Mock apps list response */
  apps?: AppsResponse;
  /** Mock logs query response */
  logs?: O11yQueryResponse;
  /** Mock metrics query response */
  metrics?: O11yQueryResponse;
  /** Mock logs fields response */
  logsFields?: Array<{ name: string; type: string }>;
  /** Mock metrics fields response */
  metricsFields?: Array<{ name: string; type: string }>;
  /** Error scenarios to simulate */
  errors?: ApiErrorConfig[];
  /** Optional delay in milliseconds to simulate network latency */
  delay?: number;
}

