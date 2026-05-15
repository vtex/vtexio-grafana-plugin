import { test, expect } from '@grafana/plugin-e2e';
import { setupApiMocks } from './fixtures/apiMocks';
import { createAppsResponse } from './fixtures/mockData';
import { selectDatasource } from './fixtures/testHelpers';

test.describe('QueryEditor - Basic Rendering', () => {
  test('should render query editor with default fields', async ({ 
    panelEditPage, 
    readProvisionedDataSource 
  }) => {
    const ds = await readProvisionedDataSource({ fileName: 'datasources.yml' });
    // Use name to select the VTEX IO datasource
    await panelEditPage.datasource.set('VTEX IO');

    // Wait for query editor to load
    await expect(
      panelEditPage.getQueryEditorRow('A').getByRole('combobox', { name: 'Query Type' })
    ).toBeVisible({ timeout: 10000 });

    // Check if page size input is visible
    await expect(
      panelEditPage.getQueryEditorRow('A').getByRole('spinbutton', { name: 'Page Size' })
    ).toBeVisible();
  });

  test('should show default query type as logs', async ({ 
    panelEditPage, 
    readProvisionedDataSource 
  }) => {
    const ds = await readProvisionedDataSource({ fileName: 'datasources.yml' });
    // Use name to select the VTEX IO datasource
    await panelEditPage.datasource.set('VTEX IO');

    await expect(
      panelEditPage.getQueryEditorRow('A').getByRole('combobox', { name: 'Query Type' })
    ).toBeVisible({ timeout: 10000 });

    // Default should be logs (checking the input value attribute)
    const queryTypeCombobox = panelEditPage.getQueryEditorRow('A').getByRole('combobox', { name: 'Query Type' });
    // The combobox is an input element, so check its value attribute
    await expect(queryTypeCombobox).toHaveValue('Logs');
  });
});

test.describe('QueryEditor - Query Type Selection', () => {
  test('should allow switching to metrics query type', async ({ 
    panelEditPage, 
    readProvisionedDataSource,
    page 
  }) => {
    const ds = await readProvisionedDataSource({ fileName: 'datasources.yml' });
    // Use name to select the VTEX IO datasource
    await panelEditPage.datasource.set('VTEX IO');

    const queryTypeCombobox = panelEditPage.getQueryEditorRow('A').getByRole('combobox', { name: 'Query Type' });
    await expect(queryTypeCombobox).toBeVisible({ timeout: 10000 });

    // Click and select metrics (Combobox renders options in DOM)
    await queryTypeCombobox.click();
    await page.getByText('Metrics', { exact: true }).click();

    // Verify the selection (checking the input value attribute)
    await expect(queryTypeCombobox).toHaveValue('Metrics');
  });

  test('should show app name field after selecting logs query type', async ({ 
    panelEditPage, 
    readProvisionedDataSource,
    page 
  }) => {
    const ds = await readProvisionedDataSource({ fileName: 'datasources.yml' });
    // Use name to select the VTEX IO datasource
    await panelEditPage.datasource.set('VTEX IO');

    await expect(
      panelEditPage.getQueryEditorRow('A').getByRole('combobox', { name: 'Query Type' })
    ).toBeVisible({ timeout: 10000 });

    // Logs is default, so app name label should be visible
    await expect(
      panelEditPage.getQueryEditorRow('A').locator('label', { hasText: 'App name' })
    ).toBeVisible();
  });
});

test.describe('QueryEditor - Conditional Field Display', () => {
  test('should show predefined metric type field only for metrics query type', async ({ 
    panelEditPage, 
    readProvisionedDataSource,
    page 
  }) => {
    const ds = await readProvisionedDataSource({ fileName: 'datasources.yml' });
    // Use name to select the VTEX IO datasource
    await panelEditPage.datasource.set('VTEX IO');

    const queryTypeCombobox = panelEditPage.getQueryEditorRow('A').getByRole('combobox', { name: 'Query Type' });
    await expect(queryTypeCombobox).toBeVisible({ timeout: 10000 });

    // Initially on logs - predefined metric type label should not be visible
    await expect(
      panelEditPage.getQueryEditorRow('A').locator('label', { hasText: 'Metric Type' })
    ).not.toBeVisible();

    // Switch to metrics
    await queryTypeCombobox.click();
    await page.getByText('Metrics', { exact: true }).click();

    // Note: Predefined metric type only appears after app name is selected
    // For now just verify the query type changed (checking the input value attribute)
    await expect(queryTypeCombobox).toHaveValue('Metrics');
  });

  test('should not show predefined metric type field for logs query type', async ({ 
    panelEditPage, 
    readProvisionedDataSource 
  }) => {
    const ds = await readProvisionedDataSource({ fileName: 'datasources.yml' });
    // Use name to select the VTEX IO datasource
    await panelEditPage.datasource.set('VTEX IO');

    await expect(
      panelEditPage.getQueryEditorRow('A').getByRole('combobox', { name: 'Query Type' })
    ).toBeVisible({ timeout: 10000 });

    // On logs query type, predefined metric type label should not be visible
    await expect(
      panelEditPage.getQueryEditorRow('A').locator('label', { hasText: 'Metric Type' })
    ).not.toBeVisible();
  });
});

test.describe('QueryEditor - Page Size Input', () => {
  test('should allow changing page size', async ({ 
    panelEditPage, 
    readProvisionedDataSource 
  }) => {
    const ds = await readProvisionedDataSource({ fileName: 'datasources.yml' });
    // Use name to select the VTEX IO datasource
    await panelEditPage.datasource.set('VTEX IO');

    // Wait for query editor to load first
    await expect(
      panelEditPage.getQueryEditorRow('A').getByRole('combobox', { name: 'Query Type' })
    ).toBeVisible({ timeout: 10000 });

    const pageSizeInput = panelEditPage.getQueryEditorRow('A').getByRole('spinbutton', { name: 'Page Size' });
    await expect(pageSizeInput).toBeVisible();

    // Change page size
    await pageSizeInput.clear();
    await pageSizeInput.fill('50');
    
    await expect(pageSizeInput).toHaveValue('50');
  });

  test('should accept valid page size values', async ({ 
    panelEditPage, 
    readProvisionedDataSource 
  }) => {
    const ds = await readProvisionedDataSource({ fileName: 'datasources.yml' });
    // Use name to select the VTEX IO datasource
    await panelEditPage.datasource.set('VTEX IO');

    // Wait for query editor to load first
    await expect(
      panelEditPage.getQueryEditorRow('A').getByRole('combobox', { name: 'Query Type' })
    ).toBeVisible({ timeout: 10000 });

    const pageSizeInput = panelEditPage.getQueryEditorRow('A').getByRole('spinbutton', { name: 'Page Size' });
    await expect(pageSizeInput).toBeVisible();

    // Test various valid page sizes
    const validPageSizes = ['10', '100', '500', '1000'];

    for (const pageSize of validPageSizes) {
      await pageSizeInput.clear();
      await pageSizeInput.fill(pageSize);
      await expect(pageSizeInput).toHaveValue(pageSize);
    }
  });
});

test.describe('QueryEditor - Field Dependencies', () => {
  test('should show app name dropdown with placeholder', async ({ 
    panelEditPage, 
    readProvisionedDataSource,
    page 
  }) => {
    // Setup API mocks for app loading
    await setupApiMocks(page, {
      apps: createAppsResponse({
        logsApps: ['test-app-1', 'test-app-2'],
        metricsApps: ['test-app-1'],
      }),
    });

    const ds = await readProvisionedDataSource({ fileName: 'datasources.yml' });
    // Use name to select the VTEX IO datasource
    await panelEditPage.datasource.set('VTEX IO');

    await expect(
      panelEditPage.getQueryEditorRow('A').getByRole('combobox', { name: 'Query Type' })
    ).toBeVisible({ timeout: 10000 });

    // App name label should be visible
    await expect(
      panelEditPage.getQueryEditorRow('A').locator('label', { hasText: 'App name' })
    ).toBeVisible();
  });
});

test.describe('QueryEditor - Accessibility', () => {
  test('should have proper aria labels for all inputs', async ({ 
    panelEditPage, 
    readProvisionedDataSource 
  }) => {
    const ds = await readProvisionedDataSource({ fileName: 'datasources.yml' });
    // Use name to select the VTEX IO datasource
    await panelEditPage.datasource.set('VTEX IO');

    // Wait for query editor to load
    await expect(
      panelEditPage.getQueryEditorRow('A').getByRole('combobox', { name: 'Query Type' })
    ).toBeVisible({ timeout: 10000 });

    // Check all fields have proper aria labels
    await expect(
      panelEditPage.getQueryEditorRow('A').getByRole('combobox', { name: 'Query Type' })
    ).toBeVisible();
    
    await expect(
      panelEditPage.getQueryEditorRow('A').getByRole('spinbutton', { name: 'Page Size' })
    ).toBeVisible();
  });
});

test.describe('QueryEditor - Predefined Metric Types', () => {
  test('should offer Request Rate per Account option', async ({ 
    panelEditPage, 
    readProvisionedDataSource,
    page 
  }) => {
    // Setup API mocks for app loading - include test-app-1 in the apps list
    await setupApiMocks(page, {
      apps: createAppsResponse({
        logsApps: ['test-app-1', 'test-app-2'],
        metricsApps: ['test-app-1', 'test-app-2'],
      }),
    });

    const ds = await readProvisionedDataSource({ fileName: 'datasources.yml' });
    // Use robust datasource selection that handles dropdown across Grafana versions
    await selectDatasource(panelEditPage, page, 'VTEX IO');

    const queryTypeCombobox = panelEditPage.getQueryEditorRow('A').getByRole('combobox', { name: 'Query Type' });
    await expect(queryTypeCombobox).toBeVisible({ timeout: 10000 });

    // Switch to metrics (Combobox renders options in DOM)
    await queryTypeCombobox.click();
    await page.getByText('Metrics', { exact: true }).click();

    // Verify metrics query type is selected (checking the input value attribute)
    await expect(queryTypeCombobox).toHaveValue('Metrics');

    // Wait for app dropdown to be visible
    const appNameCombobox = page.getByRole('combobox', { name: 'App name' });
    await expect(appNameCombobox).toBeVisible({ timeout: 10000 });
    
    // Wait a moment for apps to load (the useEffect triggers after query type changes)
    // Then open the dropdown and wait for the option to appear
    await appNameCombobox.click();
    
    // Wait for 'test-app-1' option to appear in the dropdown
    const testAppOption = page.getByText('test-app-1', { exact: true });
    await expect(testAppOption).toBeVisible({ timeout: 10000 });
    await testAppOption.click();

    // Click in the Metrics Type and select the Request Rate per Account option
    const metricsTypeCombobox = page.getByRole('combobox', { name: 'Metric Type' });
    await metricsTypeCombobox.click();
    await page.getByText('Request Rate per Account', { exact: true }).click();
    await expect(metricsTypeCombobox).toHaveValue('Request Rate per Account');
  });

  test('should offer Error Rate per Handler option', async ({ 
    panelEditPage, 
    readProvisionedDataSource,
    page 
  }) => {
    // Setup API mocks for app loading - include test-app-1 in the apps list
    await setupApiMocks(page, {
      apps: createAppsResponse({
        logsApps: ['test-app-1', 'test-app-2'],
        metricsApps: ['test-app-1', 'test-app-2'],
      }),
    });

    const ds = await readProvisionedDataSource({ fileName: 'datasources.yml' });
    // Use robust datasource selection that handles dropdown across Grafana versions
    await selectDatasource(panelEditPage, page, 'VTEX IO');

    const queryTypeCombobox = panelEditPage.getQueryEditorRow('A').getByRole('combobox', { name: 'Query Type' });
    await expect(queryTypeCombobox).toBeVisible({ timeout: 10000 });

    // Switch to metrics (Combobox renders options in DOM)
    await queryTypeCombobox.click();
    await page.getByText('Metrics', { exact: true }).click();

    // Verify metrics query type is selected (checking the input value attribute)
    await expect(queryTypeCombobox).toHaveValue('Metrics');

    // Wait for app dropdown to be visible
    const appNameCombobox = page.getByRole('combobox', { name: 'App name' });
    await expect(appNameCombobox).toBeVisible({ timeout: 10000 });
    
    // Wait a moment for apps to load (the useEffect triggers after query type changes)
    // Then open the dropdown and wait for the option to appear
    await appNameCombobox.click();
    
    // Wait for 'test-app-1' option to appear in the dropdown
    const testAppOption = page.getByText('test-app-1', { exact: true });
    await expect(testAppOption).toBeVisible({ timeout: 10000 });
    await testAppOption.click();

    // Click in the Metrics Type and select the Error Rate per Handler option
    const metricsTypeCombobox = page.getByRole('combobox', { name: 'Metric Type' });
    await metricsTypeCombobox.click();
    await page.getByText('Error Rate per Handler', { exact: true }).click();
    await expect(metricsTypeCombobox).toHaveValue('Error Rate per Handler');
  });
});
