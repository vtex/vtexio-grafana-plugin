import { test, expect } from '@grafana/plugin-e2e';
import { setupApiMocks } from './fixtures/apiMocks';
import { createAppsResponse, createLogsResponse, createMetricsResponse } from './fixtures/mockData';
import { ensureLogsVisualization } from './fixtures/testHelpers';

test.describe('QueryEditor - API Interactions', () => {
  test('should load apps list when datasource is selected', async ({ 
    panelEditPage, 
    readProvisionedDataSource,
    page 
  }) => {
    // Setup API mocks BEFORE accessing panelEditPage (which navigates)
    const mockApps = createAppsResponse({
      logsApps: ['app-1', 'app-2', 'app-3'],
      metricsApps: ['app-1', 'app-2'],
    });

    await setupApiMocks(page, {
      apps: mockApps,
    });

    // Now navigate - panelEditPage will navigate when accessed
    const ds = await readProvisionedDataSource({ fileName: 'datasources.yml' });
    await panelEditPage.datasource.set('VTEX IO');

    // Wait for query editor to load
    await expect(
      panelEditPage.getQueryEditorRow('A').getByRole('combobox', { name: 'Query Type' })
    ).toBeVisible({ timeout: 10000 });

    // App name field should be visible (apps should be loaded)
    await expect(
      panelEditPage.getQueryEditorRow('A').locator('label', { hasText: 'App name' })
    ).toBeVisible();
  });

  test('should execute logs query successfully and display data', async ({ 
    panelEditPage, 
    readProvisionedDataSource,
    page 
  }) => {
    // 1. Setup API mocks FIRST (before any navigation)
    const mockApps = createAppsResponse({
      logsApps: ['test-app'],
      metricsApps: ['test-app'],
    });

    const mockLogs = createLogsResponse({
      refId: 'A',
      recordCount: 3,
      messages: ['Log entry 1', 'Log entry 2', 'Log entry 3'],
      accounts: ['account-1', 'account-2', 'account-1'],
      levels: ['info', 'error', 'warning'],
    });

    await setupApiMocks(page, {
      apps: mockApps,
      logs: mockLogs,
    });

    // 2. Read datasource config
    const ds = await readProvisionedDataSource({ fileName: 'datasources.yml' });
    
    // 3. Now navigate and interact
    await panelEditPage.datasource.set('VTEX IO');

    // 4. Wait for query editor to load with explicit timeout
    await expect(
      panelEditPage.getQueryEditorRow('A').getByRole('combobox', { name: 'Query Type' })
    ).toBeVisible({ timeout: 15000 });
    
    // Wait for app dropdown to be visible
    const appNameCombobox = page.getByRole('combobox', { name: 'App name' });
    await expect(appNameCombobox).toBeVisible({ timeout: 10000 });
    await appNameCombobox.click();

    // Wait for dropdown options (listbox/option) then select test-app
    const testAppOption = page.getByRole('option', { name: 'test-app' }).or(page.getByText('test-app', { exact: true }));
    await expect(testAppOption.first()).toBeVisible({ timeout: 10000 });
    await testAppOption.first().click();
    await expect(appNameCombobox).toHaveValue('test-app');

    // Set visualization to Logs (G13: direct Logs button; G12: Change Visualization combobox then Logs)
    await ensureLogsVisualization(page);

    // Wait and validate if the fixture logs are showing in the panel.
    // Scope to the panel content to avoid strict-mode violation in Grafana 13:
    // the "Suggested Visualizations" sidebar (Logs/Table thumbnails) also renders
    // the same text, causing getByText() to match multiple elements.
    const panelContent = page.getByTestId('data-testid panel content');
    await expect(panelContent.getByText('Log entry 1')).toBeVisible({ timeout: 10000 });
    await expect(panelContent.getByText('Log entry 2')).toBeVisible({ timeout: 10000 });
    await expect(panelContent.getByText('Log entry 3')).toBeVisible({ timeout: 10000 });
  });
});

test.describe('QueryEditor - API Error Handling', () => {
  test('should handle logs query error (500)', async ({ 
    panelEditPage, 
    readProvisionedDataSource,
    page 
  }) => {
    // Setup API mocks with error - include test-app-1 in the apps list
    await setupApiMocks(page, {
      apps: createAppsResponse({
        logsApps: ['test-app-1', 'test-app-2'],
        metricsApps: ['test-app-1', 'test-app-2'],
      }),
      errors: [
        { endpoint: 'logs/query', status: 500, message: 'Internal Server Error' },
      ],
    });

    const ds = await readProvisionedDataSource({ fileName: 'datasources.yml' });
    await panelEditPage.datasource.set('VTEX IO');

    // Wait for query editor to load
    await expect(
      panelEditPage.getQueryEditorRow('A').getByRole('combobox', { name: 'Query Type' })
    ).toBeVisible({ timeout: 10000 });

    // Wait for app dropdown to be visible
    const appNameCombobox = page.getByRole('combobox', { name: 'App name' });
    await expect(appNameCombobox).toBeVisible({ timeout: 10000 });
    
    // Wait for apps to load, then open the dropdown and wait for the option to appear
    await appNameCombobox.click();
    
    // Wait for 'test-app-1' option to appear in the dropdown
    const testAppOption = page.getByRole('option', { name: 'test-app-1' }).or(page.getByText('test-app-1', { exact: true }));
    await expect(testAppOption.first()).toBeVisible({ timeout: 10000 });
    await testAppOption.first().click();
    await expect(appNameCombobox).toHaveValue('test-app-1');

    // Validate the error message to contain the word 'Internal Server Error'
    // Use the Alert component to be more specific and avoid strict mode violation
    await expect(page.getByTestId('data-testid Alert error').getByText(/Internal Server Error/i)).toBeVisible({ timeout: 10000 });
  });

  test('should handle metrics query error (401)', async ({ 
    panelEditPage, 
    readProvisionedDataSource,
    page 
  }) => {
    // Setup API mocks with authentication error - include test-app-1 in the apps list
    await setupApiMocks(page, {
      apps: createAppsResponse({
        logsApps: ['test-app-1', 'test-app-2'],
        metricsApps: ['test-app-1', 'test-app-2'],
      }),
      errors: [
        { endpoint: 'metrics/query', status: 401, message: 'Unauthorized' },
      ],
    });

    const ds = await readProvisionedDataSource({ fileName: 'datasources.yml' });
    await panelEditPage.datasource.set('VTEX IO');

    // Wait for query editor to load
    await expect(
      panelEditPage.getQueryEditorRow('A').getByRole('combobox', { name: 'Query Type' })
    ).toBeVisible({ timeout: 10000 });

    // Switch to metrics
    const queryTypeCombobox = panelEditPage.getQueryEditorRow('A').getByRole('combobox', { name: 'Query Type' });
    await queryTypeCombobox.click();
    await page.getByText('Metrics', { exact: true }).click();
    await expect(queryTypeCombobox).toHaveValue('Metrics');

    // Wait for app dropdown to be visible
    const appNameCombobox = page.getByRole('combobox', { name: 'App name' });
    await expect(appNameCombobox).toBeVisible({ timeout: 10000 });
    
    // Wait for apps to load, then open the dropdown and wait for the option to appear
    await appNameCombobox.click();
    
    // Wait for 'test-app-1' option to appear in the dropdown
    const testAppOption = page.getByRole('option', { name: 'test-app-1' }).or(page.getByText('test-app-1', { exact: true }));
    await expect(testAppOption.first()).toBeVisible({ timeout: 10000 });
    await testAppOption.first().click();
    await expect(appNameCombobox).toHaveValue('test-app-1');

    // Select the Request Rate per Account option
    const metricsTypeCombobox = page.getByRole('combobox', { name: 'Metric Type' });
    await metricsTypeCombobox.click();
    await page.getByText('Request Rate per Account', { exact: true }).click();
    await expect(metricsTypeCombobox).toHaveValue('Request Rate per Account');

    // Validate the error message to contain the word 'Unauthorized'
    // Use the Alert component to be more specific and avoid strict mode violation
    await expect(page.getByTestId('data-testid Alert error').getByText(/Unauthorized/i)).toBeVisible({ timeout: 10000 });
  });
});


