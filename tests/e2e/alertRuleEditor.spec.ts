import { test, expect } from '@grafana/plugin-e2e';
import type { Page } from '@playwright/test';
import { setupApiMocks } from './fixtures/apiMocks';
import { createAppsResponse } from './fixtures/mockData';
import { ApiMockConfig } from './fixtures/types';

/**
 * Coverage for the query editor as it runs inside Grafana's alert-rule editor
 * (Alerting -> New alert rule), rather than the dashboard/Explore panel editor
 * that every other e2e spec drives via `dashboardPage.addPanel()`.
 *
 * This distinction matters: the recent user-facing bugs in this plugin surfaced
 * *only* in the alert-rule editor and were invisible in the panel editor, so a
 * spec that opens a panel can't catch them. The alert-rule editor re-renders the
 * query editor far more often, which is what exposed the "App name" Combobox
 * bug: its options loaded fine but never appeared on open.
 */

// Distinct app names so a stray match against another spec's fixtures can't make
// this pass by accident.
const ALERT_APPS = createAppsResponse({
  logsApps: ['alert-app-1', 'alert-app-2', 'alert-app-3'],
  metricsApps: ['alert-app-1', 'alert-app-2'],
});

const DATASOURCE_NAME = 'VTEX IO';

/**
 * Opens Alerting -> New alert rule and selects this plugin's datasource in the
 * first query row, leaving the query editor (Query Type / App name / Page Size)
 * ready to drive. App-list requests are mocked, so no live read-api is needed.
 */
async function openAlertRuleQueryEditor(
  page: Page,
  readProvisionedDataSource: (args: { fileName: string }) => Promise<unknown>,
  mockConfig: ApiMockConfig = { apps: ALERT_APPS }
): Promise<void> {
  await setupApiMocks(page, mockConfig);
  await readProvisionedDataSource({ fileName: 'datasources.yml' });

  await page.goto('/alerting/new/alerting');

  const appNameField = page.getByRole('combobox', { name: 'App name' });
  const pageSizeField = page.getByRole('spinbutton', { name: 'Page Size' });

  // The editor is only present once our datasource is the query's datasource. A
  // fresh alert rule may default to a different one, so select ours unless the
  // editor is already showing.
  const alreadyLoaded = await appNameField
    .waitFor({ state: 'visible', timeout: 2000 })
    .then(() => true)
    .catch(() => false);

  if (!alreadyLoaded) {
    const datasourcePicker = page
      .getByTestId('data-testid Select a data source')
      .or(page.getByRole('textbox', { name: /select a data source/i }))
      .or(page.getByRole('combobox', { name: /select a data source/i }))
      .first();

    await expect(datasourcePicker).toBeVisible({ timeout: 20000 });
    await datasourcePicker.click();
    await datasourcePicker.fill(DATASOURCE_NAME);

    const option = page
      .getByRole('option', { name: DATASOURCE_NAME })
      .or(page.getByText(DATASOURCE_NAME, { exact: true }));
    await option.first().click();
  }

  await expect(appNameField).toBeVisible({ timeout: 20000 });
  await expect(pageSizeField).toBeVisible({ timeout: 20000 });
}

test.describe('Alert rule editor - App name field', () => {
  test('lists the loaded app names when opened, without the user typing', async ({
    page,
    readProvisionedDataSource,
  }) => {
    await openAlertRuleQueryEditor(page, readProvisionedDataSource);

    const appNameField = page.getByRole('combobox', { name: 'App name' });

    // Open the field and DO NOT type. This is the exact interaction the bug
    // broke: the app list loads after the editor mounts, and Grafana's Combobox
    // only re-populated its menu on a keystroke, so opening with an empty input
    // showed "No options found" in the alert-rule editor even though the fetch
    // had succeeded. Typing to reveal options (as selectComboboxOption does)
    // would hide the regression, so this asserts against the empty-input open.
    await appNameField.click();

    await expect(page.getByRole('option', { name: 'alert-app-1' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('option', { name: 'alert-app-2' })).toBeVisible();
    await expect(page.getByRole('option', { name: 'alert-app-3' })).toBeVisible();

    // And the empty state must NOT be shown.
    await expect(page.getByText('No options found', { exact: false })).toBeHidden();
  });

  test('selects an app picked directly from the opened list', async ({
    page,
    readProvisionedDataSource,
  }) => {
    await openAlertRuleQueryEditor(page, readProvisionedDataSource);

    const appNameField = page.getByRole('combobox', { name: 'App name' });

    // Open (no typing) and pick straight from the list, the way a user sets up
    // an alert. This only works if the options render on open.
    await appNameField.click();
    await page.getByRole('option', { name: 'alert-app-2' }).click();

    await expect(appNameField).toHaveValue('alert-app-2', { timeout: 10000 });
  });

  test('lists the options even when the field is opened before the fetch resolves', async ({
    page,
    readProvisionedDataSource,
  }) => {
    // Hold the app-list response so the field is opened while the fetch is still
    // in flight. This is the timing that instant mocks can't exercise: a loader
    // that reads a snapshot of state (rather than awaiting the fetch) resolves to
    // an empty list here and the menu stays on "No options found" until the user
    // reopens it. Awaiting the in-flight fetch is what makes the options appear.
    await openAlertRuleQueryEditor(page, readProvisionedDataSource, { apps: ALERT_APPS, delay: 3000 });

    const appNameField = page.getByRole('combobox', { name: 'App name' });
    await appNameField.click();

    // The options must appear once the fetch resolves — no typing, no reopening.
    await expect(page.getByRole('option', { name: 'alert-app-1' })).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('option', { name: 'alert-app-2' })).toBeVisible();
    await expect(page.getByRole('option', { name: 'alert-app-3' })).toBeVisible();
  });
});
