import { chromium, FullConfig } from '@playwright/test';

async function globalSetup(config: FullConfig) {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  // Wait for Grafana to be ready
  try {
    await page.goto(config.projects[0].use.baseURL || 'http://localhost:3000');
    await page.waitForLoadState('networkidle', { timeout: 60000 });
  } catch (error) {
    console.warn('Grafana might not be ready:', error);
  }
  
  await browser.close();
}

export default globalSetup;
