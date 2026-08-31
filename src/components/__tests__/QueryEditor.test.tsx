import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { QueryEditor } from '../QueryEditor';
import { QueryType, AppQuery } from '../../types';

type Props = React.ComponentProps<typeof QueryEditor>;

// Regression guard for a bug where the "App name" field showed "No options
// found" in Grafana's alert-rule editor despite the underlying data fetch
// succeeding.
//
// Grafana's Combobox only re-derives a plain-array `options` prop at mount, never
// afterwards. Because the app list is fetched *after* mount, a plain array is
// empty when Combobox first reads it, so the field is stuck on "No options found"
// until the user types. Passing a function uses Combobox's async path, which
// re-loads on every menu open — but Combobox wraps that function in
// useLatestAsyncCall, which discards a resolved result if the function's identity
// changed while the lookup was in flight. An inline arrow is a new identity on
// every render (rare to lose in Explore, but the alert-rule editor re-renders
// often enough to lose it almost every time), so the loader keeps a constant
// identity and awaits the in-flight fetch rather than reading a state snapshot.
//
// Rendering Grafana's real dropdown isn't practical under jsdom (its virtualized
// option list needs real layout measurements jsdom doesn't compute), so this
// asserts the two properties the fix depends on: `options` is a function, and its
// identity stays constant across re-renders.
const comboboxCalls: any[] = [];

jest.mock('@grafana/ui', () => {
  const actual = jest.requireActual('@grafana/ui');
  return {
    ...actual,
    Combobox: (props: any) => {
      comboboxCalls.push(props);
      return <div data-testid={`combobox-${props['aria-label']}`} />;
    },
  };
});

function appNamePropsHistory() {
  return comboboxCalls.filter((p) => p['aria-label'] === 'App name');
}

function latestAppNameProps() {
  const history = appNamePropsHistory();
  return history[history.length - 1];
}

function buildQuery(overrides?: Partial<AppQuery>): AppQuery {
  return {
    refId: 'A',
    queryType: QueryType.logs,
    pageSize: 100,
    ...overrides,
  } as AppQuery;
}

function buildProps(overrides?: { query?: Partial<AppQuery>; getApps?: jest.Mock }): Props {
  const getApps =
    overrides?.getApps ??
    jest.fn().mockResolvedValue({
      LogsApps: ['acme.checkout@1.2.3', 'acme.orders@2.0.0'],
      MetricsApps: ['acme.checkout@1.2.3'],
    });

  return {
    query: buildQuery(overrides?.query),
    onChange: jest.fn(),
    onRunQuery: jest.fn(),
    datasource: { getApps } as any,
    data: undefined,
  };
}

beforeEach(() => {
  comboboxCalls.length = 0;
});

describe('QueryEditor - App name field', () => {
  it('passes an async options loader that resolves the fetched app names', async () => {
    const props = buildProps();
    render(<QueryEditor {...props} />);

    await waitFor(() => expect(props.datasource.getApps).toHaveBeenCalled());
    // The loader must resolve the loaded suggestions once the fetch settles.
    await waitFor(async () => {
      const loader = latestAppNameProps().options;
      expect(typeof loader).toBe('function');
      // Sorted by version descending (see QueryEditor's fetch effect), so
      // orders@2.0.0 comes before checkout@1.2.3.
      await expect(loader('')).resolves.toEqual([
        { label: 'acme.orders@2.0.0', value: 'acme.orders@2.0.0' },
        { label: 'acme.checkout@1.2.3', value: 'acme.checkout@1.2.3' },
      ]);
    });
  });

  it('filters the resolved options by the typed input', async () => {
    const props = buildProps();
    render(<QueryEditor {...props} />);

    await waitFor(() => expect(props.datasource.getApps).toHaveBeenCalled());
    await waitFor(async () => {
      const loader = latestAppNameProps().options;
      await expect(loader('orders')).resolves.toEqual([
        { label: 'acme.orders@2.0.0', value: 'acme.orders@2.0.0' },
      ]);
    });
  });

  it('keeps the loader identity stable across re-renders that do not change the suggestions', async () => {
    const props = buildProps();
    const { rerender } = render(<QueryEditor {...props} />);

    await waitFor(() => expect(props.datasource.getApps).toHaveBeenCalled());
    // Wait until the loader resolves the loaded suggestions, i.e. the fetch has
    // settled and the component has re-rendered with them.
    await waitFor(async () => {
      await expect(latestAppNameProps().options('')).resolves.toHaveLength(2);
    });

    const loaderBefore = latestAppNameProps().options;

    // A re-render driven by an unrelated prop (the alert-rule editor triggers
    // these far more often than Explore does) must NOT hand Combobox a new
    // options-function identity — that is exactly what made Combobox's
    // useLatestAsyncCall discard the in-flight result and show "No options
    // found" in the alert-rule editor.
    rerender(<QueryEditor {...props} data={{ series: [], state: 'Done' } as any} />);

    const loaderAfter = latestAppNameProps().options;
    expect(loaderAfter).toBe(loaderBefore);
  });
});
