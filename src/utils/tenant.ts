const VTEX_ACCOUNT_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const VTEX_APP_KEY_PATTERN = /^vtexappkey-([a-z0-9]+(?:-[a-z0-9]+)*)-[a-zA-Z0-9]+$/;

export function normalizeTenantName(tenant: string | undefined | null): string {
  return tenant?.trim().toLowerCase() ?? '';
}

export function isValidTenantName(tenant: string | undefined | null): boolean {
  return VTEX_ACCOUNT_NAME_PATTERN.test(normalizeTenantName(tenant));
}

export function extractTenantFromAppKey(appKey: string): string | null {
  const match = appKey.trim().match(VTEX_APP_KEY_PATTERN);
  return match ? match[1] : null;
}
