import { extractTenantFromAppKey, isValidTenantName, normalizeTenantName } from '../utils';

describe('extractTenantFromAppKey', () => {
  it('should extract tenant from valid vtexappkey format', () => {
    const result = extractTenantFromAppKey('vtexappkey-mytenant-abc123def456');
    expect(result).toBe('mytenant');
  });

  it('should return null for invalid appKey format', () => {
    const result = extractTenantFromAppKey('invalid-key');
    expect(result).toBeNull();
  });

  it('should return null for empty string', () => {
    const result = extractTenantFromAppKey('');
    expect(result).toBeNull();
  });

  it('should return null if missing hash part', () => {
    const result = extractTenantFromAppKey('vtexappkey-mytenant-');
    expect(result).toBeNull();
  });

  it('should return null if missing tenant part', () => {
    const result = extractTenantFromAppKey('vtexappkey--abc123');
    expect(result).toBeNull();
  });

  it('should handle tenant with alphanumeric characters', () => {
    const result = extractTenantFromAppKey('vtexappkey-tenant123-abc123def456');
    expect(result).toBe('tenant123');
  });

  it('should handle tenant with internal hyphens', () => {
    const result = extractTenantFromAppKey('vtexappkey-my-tenant-abc123def456');
    expect(result).toBe('my-tenant');
  });

  it('should return null for malformed prefix', () => {
    const result = extractTenantFromAppKey('vtexkey-mytenant-abc123def456');
    expect(result).toBeNull();
  });

  it('should reject tenant values with path or query fragments', () => {
    expect(isValidTenantName('tenant/path')).toBe(false);
    expect(isValidTenantName('tenant?x=y')).toBe(false);
  });

  it('should reject tenant values with leading or trailing hyphens', () => {
    expect(isValidTenantName('-tenant')).toBe(false);
    expect(isValidTenantName('tenant-')).toBe(false);
  });

  it('should normalize tenant values before validation', () => {
    expect(normalizeTenantName(' MyTenant ')).toBe('mytenant');
    expect(isValidTenantName(' MyTenant ')).toBe(true);
  });
});
