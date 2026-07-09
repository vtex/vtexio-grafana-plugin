import { Locator, Page, expect } from '@playwright/test';
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
 * Grafana 13 can render the selected datasource without the data-testid used by
 * @grafana/plugin-e2e's datasource.set(), so prefer visible editor state and
 * fall back to role/placeholder based picker interaction.
 */
export async function selectDatasource(
  panelEditPage: PanelEditPage,
  page: Page,
  datasourceName: string
): Promise<void> {
  const queryTypeCombobox = panelEditPage.getQueryEditorRow('A').getByRole('combobox', { name: 'Query Type' });

  const isEditorAlreadyLoaded = await queryTypeCombobox
    .waitFor({ state: 'visible', timeout: 1500 })
    .then(() => true)
    .catch(() => false);

  if (isEditorAlreadyLoaded) {
    return;
  }

  const datasourcePicker = page
    .getByRole('textbox', { name: /select a data source/i })
    .or(page.getByTestId('data-testid Select a data source'))
    .or(page.getByPlaceholder(datasourceName))
    .first();

  await expect(datasourcePicker).toBeVisible({ timeout: 15000 });
  await datasourcePicker.click();
  await datasourcePicker.fill(datasourceName);

  const datasourceOption = page.getByRole('option', { name: datasourceName }).or(page.getByText(datasourceName, { exact: true }));
  const isOptionVisible = await datasourceOption
    .first()
    .waitFor({ state: 'visible', timeout: 5000 })
    .then(() => true)
    .catch(() => false);

  if (isOptionVisible) {
    await datasourceOption.first().click();
  } else {
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
  }

  await expect(queryTypeCombobox).toBeVisible({ timeout: 15000 });
}

/**
 * Selects an option from a Grafana Combobox, including async option providers
 * that only render suggestions after the user types a filter value.
 */
export async function selectComboboxOption(page: Page, combobox: Locator, optionText: string): Promise<void> {
  await expect(combobox).toBeVisible({ timeout: 10000 });

  await expect(async () => {
    await combobox.click();
    await combobox.fill('');
    await combobox.pressSequentially(optionText);

    const option = page.getByRole('option', { name: optionText }).or(page.getByText(optionText, { exact: true }));
    const isOptionVisible = await option
      .first()
      .waitFor({ state: 'visible', timeout: 1000 })
      .then(() => true)
      .catch(() => false);

    if (isOptionVisible) {
      await option.first().click();
    } else {
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
    }

    await expect(combobox).toHaveValue(optionText, { timeout: 1000 });
  }).toPass({ timeout: 15000 });
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
