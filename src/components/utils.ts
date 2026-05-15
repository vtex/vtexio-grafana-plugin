// Utility function to extract tenant from a vtexappkey-{{tenant}}-{{hash}} format
export function extractTenantFromAppKey(appKey: string): string | null {
    // Matches vtexappkey-<tenant>-<hash>
    const match = appKey.match(/^vtexappkey-([^-]+)-[a-zA-Z0-9]+$/);
    return match ? match[1] : null;
}
