import { test, expect } from '@grafana/plugin-e2e';
import { setupApiMocks } from './fixtures/apiMocks';

test.describe('ConfigEditor - Basic Rendering', () => {
  test('should render config editor with App Key and App Token fields', async ({ 
    createDataSourceConfigPage, 
    readProvisionedDataSource, 
    page 
  }) => {
    const ds = await readProvisionedDataSource({ fileName: 'datasources.yml' });
    await createDataSourceConfigPage({ type: ds.type });
    
    // Wait for config editor to load
    await expect(page.getByLabel('App Key')).toBeVisible({ timeout: 10000 });
    await expect(page.getByLabel('App Token')).toBeVisible();
  });

  test('should show correct placeholders for empty fields', async ({ 
    createDataSourceConfigPage, 
    readProvisionedDataSource, 
    page 
  }) => {
    const ds = await readProvisionedDataSource({ fileName: 'datasources.yml' });
    await createDataSourceConfigPage({ type: ds.type });

    await expect(page.getByLabel('App Key')).toBeVisible({ timeout: 10000 });
    
    // Check placeholders
    await expect(page.locator('#config-editor-app-key')).toHaveAttribute(
      'placeholder', 
      'Enter your app key, e.g. vtexappkey-mystore-ABCD1234'
    );
    await expect(page.locator('#config-editor-app-token')).toHaveAttribute(
      'placeholder', 
      'Enter your app token'
    );
  });
});

test.describe('ConfigEditor - Field Interactions', () => {
  test('should allow filling app key field', async ({ 
    createDataSourceConfigPage, 
    readProvisionedDataSource, 
    page 
  }) => {
    const ds = await readProvisionedDataSource({ fileName: 'datasources.yml' });
    await createDataSourceConfigPage({ type: ds.type });

    await expect(page.getByLabel('App Key')).toBeVisible({ timeout: 10000 });
    
    const appKeyInput = page.getByLabel('App Key');
    await appKeyInput.fill('vtexappkey-mytenant-abc123def456');
    await expect(appKeyInput).toHaveValue('vtexappkey-mytenant-abc123def456');
  });

  test('should allow filling app token field', async ({ 
    createDataSourceConfigPage, 
    readProvisionedDataSource, 
    page 
  }) => {
    const ds = await readProvisionedDataSource({ fileName: 'datasources.yml' });
    await createDataSourceConfigPage({ type: ds.type });

    await expect(page.getByLabel('App Key')).toBeVisible({ timeout: 10000 });
    
    const appTokenInput = page.getByLabel('App Token');
    await appTokenInput.fill('my-secret-token-12345');
    await expect(appTokenInput).toHaveValue('my-secret-token-12345');
  });
});

test.describe('ConfigEditor - Password Field Behavior', () => {
  test('should show password type for app token field', async ({ 
    createDataSourceConfigPage, 
    readProvisionedDataSource, 
    page 
  }) => {
    const ds = await readProvisionedDataSource({ fileName: 'datasources.yml' });
    await createDataSourceConfigPage({ type: ds.type });

    await expect(page.getByLabel('App Key')).toBeVisible({ timeout: 10000 });
    
    // Check that app token field is of type password
    await expect(page.locator('#config-editor-app-token')).toHaveAttribute('type', 'password');
  });
});

test.describe('ConfigEditor - Save Functionality', () => {
  test('should enable saving with valid credentials', async ({ 
    createDataSourceConfigPage, 
    readProvisionedDataSource, 
    page 
  }) => {
    const ds = await readProvisionedDataSource({ fileName: 'datasources.yml' });
    await createDataSourceConfigPage({ type: ds.type });

    await expect(page.getByLabel('App Key')).toBeVisible({ timeout: 10000 });
    
    // Fill in valid credentials
    await page.getByLabel('App Key').fill('vtexappkey-teststore-validkey123');
    await page.getByLabel('App Token').fill('valid-token-value');
    
    // Save button should be visible and clickable
    const saveButton = page.getByRole('button', { name: 'Save & test' });
    await expect(saveButton).toBeVisible();
    await expect(saveButton).toBeEnabled();
  });
});

test.describe('ConfigEditor - API Connection Testing', () => {
  test('should test datasource connection successfully', async ({ 
    createDataSourceConfigPage, 
    readProvisionedDataSource, 
    page 
  }) => {
    const ds = await readProvisionedDataSource({ fileName: 'datasources.yml' });
    
    // Setup API mocks BEFORE creating the page to ensure they're ready
    // The logs/fields endpoint should return a successful response (200)
    await setupApiMocks(page, {
      logsFields: [
        { name: 'account', type: 'string' },
        { name: 'workspace', type: 'string' },
        { name: 'level', type: 'string' },
      ],
    });

    await createDataSourceConfigPage({ type: ds.type });

    await expect(page.getByLabel('App Key')).toBeVisible({ timeout: 10000 });
    
    // Fill in credentials
    await page.getByLabel('App Key').fill('vtexappkey-test-valid');
    await page.getByLabel('App Token').fill('valid-token');
    
    // Click Save & test button - this will save the config and then test the connection
    await page.getByRole('button', { name: 'Save & test' }).click();
    
    // Wait for success message - the testDatasource() method should succeed
    // The mock should intercept the FetchLogsFields() call and return 200
    await expect(page.getByText(/successfully connected/i)).toBeVisible({ timeout: 15000 });
  });

  test('should handle connection test failure with 401 error', async ({ 
    createDataSourceConfigPage, 
    readProvisionedDataSource, 
    page 
  }) => {
    // Setup API mocks for authentication error
    await setupApiMocks(page, {
      errors: [
        { endpoint: 'logs/fields', status: 401, message: 'Unauthorized' },
      ],
    });

    const ds = await readProvisionedDataSource({ fileName: 'datasources.yml' });
    await createDataSourceConfigPage({ type: ds.type });

    await expect(page.getByLabel('App Key')).toBeVisible({ timeout: 10000 });
    
    // Fill in invalid credentials
    await page.getByLabel('App Key').fill('vtexappkey-test-invalid');
    await page.getByLabel('App Token').fill('invalid-token');
    
    // Click Save & test button
    await page.getByRole('button', { name: 'Save & test' }).click();
    
    // Wait for error message
    await expect(page.getByText(/failed|error|unauthorized/i)).toBeVisible({ timeout: 10000 });
  });
});

