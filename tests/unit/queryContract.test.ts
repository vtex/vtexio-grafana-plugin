import { of } from 'rxjs';
import contract from '../fixtures/query-contract.json';
import { FetchBodyParams, PredefinedMetricType } from '../../src/types';

// The other half of the shared query contract.
//
// pkg/plugin/query_builder_test.go asserts the Go backend against this same fixture
// file. The Go path serves alert evaluations and the TypeScript path serves dashboards,
// so if they drift a panel and the alert built on it silently measure different things.
// Changing one side without the other fails here or there.

const capturedRequests: any[] = [];

jest.mock('@grafana/runtime', () => ({
  ...jest.requireActual('@grafana/runtime'),
  getBackendSrv: () => ({
    fetch: (options: any) => {
      capturedRequests.push(options.data);
      return of({ data: { refId: 'A', name: 'Metrics', fields: [] }, status: 200, statusText: 'OK' });
    },
  }),
}));

// Imported after the mock so the client picks it up.
/* eslint-disable @typescript-eslint/no-var-requires */
const { ProductionO11yApiClient } = require('../../src/clients/o11yApi');
const { DataSource } = require('../../src/datasource');
/* eslint-enable @typescript-eslint/no-var-requires */

describe('read-api query contract (TypeScript side)', () => {
  beforeEach(() => {
    capturedRequests.length = 0;
  });

  it.each(contract.cases.map((c) => [c.name, c] as const))('%s', async (_name, testCase) => {
    const client = new ProductionO11yApiClient('test-tenant', 'http://test-url');

    // The final request body is produced by two collaborators on this side: the
    // datasource clamps pageSize for the percentile charts, then the client builds the
    // body. Go does both in BuildRequest, so the contract has to span both here too.
    const datasource = new DataSource({
      jsonData: { tenant: 'test-tenant', appKey: 'test-key' },
      url: 'http://test-url',
    } as any);
    const pageSize = (datasource as any).getPageSizeForMetricsQuery({
      queryType: 'metrics',
      predefinedMetric: testCase.query.predefinedMetric,
      pageSize: testCase.query.pageSize,
    });

    const bodyParams: FetchBodyParams = {
      fromTime: contract.fromTime,
      toTime: contract.toTime,
      app: testCase.query.appName,
      predefinedMetric: testCase.query.predefinedMetric as PredefinedMetricType,
      pageSize,
      filters: testCase.query.filters,
    };

    await client.FetchMetrics(bodyParams);

    expect(capturedRequests).toHaveLength(1);
    // Round-trip through JSON so undefined-valued optional keys are dropped, matching
    // what the API actually receives and what Go's omitempty produces.
    expect(JSON.parse(JSON.stringify(capturedRequests[0]))).toEqual(testCase.expected);
  });
});
