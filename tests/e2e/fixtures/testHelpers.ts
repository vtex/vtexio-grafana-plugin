import { Page, expect } from '@playwright/test';
import { PanelEditPage } from '@grafana/plugin-e2e';
import { ApiMockConfig } from './types';
import { setupApiMocks } from './apiMocks';

/**
 * Sets up API mocks and ensures page is ready before navigation
 */
export async function setupTestWithMocks(
  page: Page,
  panelEditPage: PanelEditPage,
  mockConfig: ApiMockConfig
): Promise<void> {
  // Set up mocks BEFORE any navigation happens
  await setupApiMocks(page, mockConfig);
  
  // Wait for any existing navigation to complete
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {
    // Ignore if already idle
  });
}

/**
 * Selects a datasource by name, handling dropdown selection across Grafana versions.
 * This is more robust than just using panelEditPage.datasource.set() which may
 * only type text without selecting in newer Grafana versions.
 */
export async function selectDatasource(
  panelEditPage: PanelEditPage,
  page: Page,
  datasourceName: string
): Promise<void> {
  // Use the built-in method first
  await panelEditPage.datasource.set(datasourceName);

  // Wait a moment for dropdown to appear
  await page.waitForTimeout(500);

  // Try to click on the dropdown option if it appears
  const dropdownOption = page.getByRole('option', { name: datasourceName });
  const isDropdownVisible = await dropdownOption.isVisible().catch(() => false);

  if (isDropdownVisible) {
    await dropdownOption.click();
  } else {
    // Alternative: try listbox item
    const listboxItem = page.locator(`[role="listbox"] >> text="${datasourceName}"`);
    const isListboxVisible = await listboxItem.isVisible().catch(() => false);
    if (isListboxVisible) {
      await listboxItem.click();
    }
  }

  // Wait for the selection to be confirmed
  await page.waitForTimeout(300);
}

const VISUALIZATION_SELECTOR_TIMEOUT = 3000;

/**
 * Ensures the panel visualization is set to Logs, handling both Grafana 12 and 13+ UI.
 * - G13: direct "Logs" visualization item button (data-testid "data-testid Plugin visualization item Logs").
 * - G12: "Change Visualization" combobox, then select "Logs".
 * No-op if no control is found (e.g. panel already shows Logs or UI differs).
 */
export async function ensureLogsVisualization(page: Page): Promise<void> {
  try {
    // G13 first: direct Logs visualization button (no dropdown)
    const logsButtonG13 = page.getByTestId('data-testid Plugin visualization item Logs');
    await logsButtonG13.waitFor({ state: 'visible', timeout: VISUALIZATION_SELECTOR_TIMEOUT });
    await logsButtonG13.click();
    return;
  } catch {
    // G13 control not found, try G12
  }

  try {
    // G12 fallback: Change Visualization combobox, then select Logs
    const changeViz =
      page.getByLabel('Change Visualization').or(
        page.getByRole('combobox', { name: /visualization/i })
      );
    await changeViz.first().waitFor({ state: 'visible', timeout: VISUALIZATION_SELECTOR_TIMEOUT });
    await changeViz.first().click();
    await page.getByText('Logs', { exact: true }).click({ timeout: VISUALIZATION_SELECTOR_TIMEOUT });
  } catch {
    // Missing or changed UI: no-op so test can continue
  }
}
