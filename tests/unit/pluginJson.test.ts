import pluginJson from '../../src/plugin.json';

interface Route {
  path: string;
  headers: Array<{ name: string; content: string }>;
}

describe('plugin.json route headers', () => {
  const routes = (pluginJson as unknown as { routes: Route[] }).routes;

  it('declares routes', () => {
    expect(routes.length).toBeGreaterThan(0);
  });

  it.each(routes.map((r) => [r.path, r] as const))('%s sends the static client identification headers', (_p, route) => {
    const byName = Object.fromEntries(route.headers.map((h) => [h.name, h.content]));
    expect(byName['X-VTEX-Client']).toBe('vtexio-grafana-datasource');
    expect(byName['User-Agent']).toMatch(/^vtexio-grafana-datasource\//);
    // auth headers must still be present
    expect(byName['X-VTEX-API-AppKey']).toBeDefined();
    expect(byName['X-VTEX-API-AppToken']).toBeDefined();
  });
});
