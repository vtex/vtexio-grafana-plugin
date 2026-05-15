import { Page } from '@playwright/test';
import { ApiMockConfig } from './types';
import {
  createAppsResponse,
  createLogsResponse,
  createMetricsResponse,
  createFieldsResponse,
  createErrorResponse,
} from './mockData';

/**
 * Sets up API route interception for Grafana datasource proxy requests.
 * Intercepts requests matching Grafana proxy patterns and returns mock responses
 * based on the provided configuration.
 *
 * @param page - Playwright Page instance
 * @param config - Configuration object for mock responses
 */
export async function setupApiMocks(page: Page, config: ApiMockConfig = {}): Promise<void> {
  const delay = config.delay || 0;

  // Helper to add delay if configured
  const addDelay = async () => {
    if (delay > 0) {
      await page.waitForTimeout(delay);
    }
  };

  // Helper to check if endpoint should return an error
  const shouldError = (endpoint: string): { shouldError: boolean; error?: { status: number; message?: string } } => {
    if (!config.errors || config.errors.length === 0) {
      return { shouldError: false };
    }
    const error = config.errors.find((e) => endpoint.includes(e.endpoint));
    if (error) {
      return { shouldError: true, error: { status: error.status, message: error.message } };
    }
    return { shouldError: false };
  };

  // Mock apps endpoint (GET)
  // Use flexible pattern to match URLs with UID (e.g., /api/datasources/proxy/uid/xxx/remote/apps)
  await page.route('**/api/datasources/proxy/**/remote/apps**', async (route) => {
    await addDelay();
    const errorCheck = shouldError('apps');
    if (errorCheck.shouldError && errorCheck.error) {
      await route.fulfill({
        status: errorCheck.error.status,
        contentType: 'application/json',
        body: JSON.stringify(createErrorResponse(errorCheck.error.status, errorCheck.error.message)),
      });
      return;
    }
    const response = config.apps || createAppsResponse();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(response),
    });
  });

  await page.route('**/api/datasources/proxy/**/local/apps**', async (route) => {
    await addDelay();
    const errorCheck = shouldError('apps');
    if (errorCheck.shouldError && errorCheck.error) {
      await route.fulfill({
        status: errorCheck.error.status,
        contentType: 'application/json',
        body: JSON.stringify(createErrorResponse(errorCheck.error.status, errorCheck.error.message)),
      });
      return;
    }
    const response = config.apps || createAppsResponse();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(response),
    });
  });

  // Mock logs query endpoint (POST)
  // Use flexible pattern to match URLs with UID (e.g., /api/datasources/proxy/uid/xxx/remote/logs/query)
  await page.route('**/api/datasources/proxy/**/remote/logs/query**', async (route) => {
    await addDelay();
    const errorCheck = shouldError('logs/query');
    if (errorCheck.shouldError && errorCheck.error) {
      await route.fulfill({
        status: errorCheck.error.status,
        contentType: 'application/json',
        body: JSON.stringify(createErrorResponse(errorCheck.error.status, errorCheck.error.message)),
      });
      return;
    }
    const response = config.logs || createLogsResponse();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(response),
    });
  });

  await page.route('**/api/datasources/proxy/**/local/logs/query**', async (route) => {
    await addDelay();
    const errorCheck = shouldError('logs/query');
    if (errorCheck.shouldError && errorCheck.error) {
      await route.fulfill({
        status: errorCheck.error.status,
        contentType: 'application/json',
        body: JSON.stringify(createErrorResponse(errorCheck.error.status, errorCheck.error.message)),
      });
      return;
    }
    const response = config.logs || createLogsResponse();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(response),
    });
  });

  // Mock logs fields endpoint (GET)
  // Use a flexible string pattern that matches any proxy request to logs/fields
  await page.route('**/api/datasources/proxy/**/logs/fields**', async (route) => {
    const method = route.request().method();
    
    // Only handle GET requests for logs/fields
    if (method !== 'GET') {
      await route.continue();
      return;
    }
    
    await addDelay();
    const errorCheck = shouldError('logs/fields');
    if (errorCheck.shouldError && errorCheck.error) {
      await route.fulfill({
        status: errorCheck.error.status,
        contentType: 'application/json',
        body: JSON.stringify(createErrorResponse(errorCheck.error.status, errorCheck.error.message)),
      });
      return;
    }
    const response = config.logsFields || createFieldsResponse();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(response),
    });
  });

  // Mock metrics query endpoint (POST)
  // Use flexible pattern to match URLs with UID (e.g., /api/datasources/proxy/uid/xxx/remote/metrics/query)
  await page.route('**/api/datasources/proxy/**/remote/metrics/query**', async (route) => {
    await addDelay();
    const errorCheck = shouldError('metrics/query');
    if (errorCheck.shouldError && errorCheck.error) {
      await route.fulfill({
        status: errorCheck.error.status,
        contentType: 'application/json',
        body: JSON.stringify(createErrorResponse(errorCheck.error.status, errorCheck.error.message)),
      });
      return;
    }
    const response = config.metrics || createMetricsResponse();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(response),
    });
  });

  await page.route('**/api/datasources/proxy/**/local/metrics/query**', async (route) => {
    await addDelay();
    const errorCheck = shouldError('metrics/query');
    if (errorCheck.shouldError && errorCheck.error) {
      await route.fulfill({
        status: errorCheck.error.status,
        contentType: 'application/json',
        body: JSON.stringify(createErrorResponse(errorCheck.error.status, errorCheck.error.message)),
      });
      return;
    }
    const response = config.metrics || createMetricsResponse();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(response),
    });
  });

  // Mock metrics fields endpoint (GET)
  await page.route('**/api/datasources/proxy/*/remote/metrics/fields*', async (route) => {
    await addDelay();
    const errorCheck = shouldError('metrics/fields');
    if (errorCheck.shouldError && errorCheck.error) {
      await route.fulfill({
        status: errorCheck.error.status,
        contentType: 'application/json',
        body: JSON.stringify(createErrorResponse(errorCheck.error.status, errorCheck.error.message)),
      });
      return;
    }
    const response = config.metricsFields || createFieldsResponse();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(response),
    });
  });

  await page.route('**/api/datasources/proxy/*/local/metrics/fields*', async (route) => {
    await addDelay();
    const errorCheck = shouldError('metrics/fields');
    if (errorCheck.shouldError && errorCheck.error) {
      await route.fulfill({
        status: errorCheck.error.status,
        contentType: 'application/json',
        body: JSON.stringify(createErrorResponse(errorCheck.error.status, errorCheck.error.message)),
      });
      return;
    }
    const response = config.metricsFields || createFieldsResponse();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(response),
    });
  });
}

