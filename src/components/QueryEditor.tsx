import React, { ChangeEvent, useMemo, useCallback, useRef } from 'react';
import semver from 'semver';
import { Combobox, InlineField, Input, Stack, Tag, Alert } from '@grafana/ui';
import { QueryEditorProps } from '@grafana/data';
import { locationService } from '@grafana/runtime';
import { DataSource } from '../datasource';
import { VTEXIODataSourceOptions, AppQuery, QueryType, PredefinedMetricType, DEFAULT_QUERY, QueryFilter } from '../types';

type Props = QueryEditorProps<DataSource, AppQuery, VTEXIODataSourceOptions>;

// Time conversion constants for readability
const SECOND_IN_MS = 1000;
const MINUTE_IN_MS = 60 * SECOND_IN_MS;
const HOUR_IN_MS = 60 * MINUTE_IN_MS;
const DAY_IN_MS = 24 * HOUR_IN_MS;
const WEEK_IN_MS = 7 * DAY_IN_MS;

// Helper function to parse Grafana duration strings (e.g., "1h", "30m", "7d")
function parseDuration(duration: string): number {
  const match = duration.match(/^(\d+)([smhdw])$/);
  if (!match) {
    return HOUR_IN_MS; // Default to 1 hour
  }

  const value = parseInt(match[1], 10);
  const unit = match[2];

  switch (unit) {
    case 's': return value * SECOND_IN_MS;
    case 'm': return value * MINUTE_IN_MS;
    case 'h': return value * HOUR_IN_MS;
    case 'd': return value * DAY_IN_MS;
    case 'w': return value * WEEK_IN_MS;
    default: return HOUR_IN_MS; // Default to 1 hour
  }
}

// Helper function to parse time range from URL parameters
function parseTimeRange(currentTimeFrom: any, currentTimeTo: any): { fromTime?: number; toTime?: number } {
  let fromTime: number | undefined;
  let toTime: number | undefined;
  
  try {
    if (currentTimeFrom && currentTimeTo) {
      // Parse time range from URL parameters
      const from = typeof currentTimeFrom === 'string' ? currentTimeFrom : String(currentTimeFrom);
      const to = typeof currentTimeTo === 'string' ? currentTimeTo : String(currentTimeTo);
      
      // Handle relative time (like "now-1h") and absolute time
      if (from.startsWith('now-')) {
        const duration = from.replace('now-', '');
        fromTime = Date.now() - parseDuration(duration);
      } else {
        fromTime = new Date(from).getTime();
      }
      
      if (to === 'now') {
        toTime = Date.now();
      } else {
        toTime = new Date(to).getTime();
      }
    }
  } catch (error) {
    // Fallback to default behavior if time range is not available
  }
  
  return { fromTime, toTime };
}

export function QueryEditor({ query, onChange, onRunQuery, datasource, data }: Props) {
  // Extract error for the current query
  const queryError = data?.errors?.find((error) => error.refId === query.refId);

  // Get current time range from URL
  const searchParams = locationService.getSearchObject();
  const currentTimeFrom = searchParams.from;
  const currentTimeTo = searchParams.to;
  
  // Get query type with default
  const queryType = query.queryType || DEFAULT_QUERY.queryType || QueryType.logs;

  const onQueryTypeChange = (option: { value: QueryType } | null) => {
    if (option) {
      const newQuery = { ...query, queryType: option.value };
      onChange(newQuery);

      // Don't run query immediately - wait for appName to be selected
    }
  };

  const onPageSizeChange = (event: ChangeEvent<HTMLInputElement>) => {
    const pageSize = parseInt(event.target.value, 10);
    if (!isNaN(pageSize) && pageSize > 0) {
      onChange({ ...query, pageSize });
      onRunQuery();
    }
  };

  const onPredefinedMetricChange = (option: { value: PredefinedMetricType } | null) => {
    const newQuery = { ...query, predefinedMetric: option?.value || undefined };
    onChange(newQuery);

    // Only run query if both appName and predefinedMetric are selected for metrics
    if (queryType === QueryType.metrics && query.appName && option?.value) {
      onRunQuery();
    }
  };

  const onAppNameChange = (option: { value: string } | null) => {
    // Clear predefined metric when app changes to prevent inconsistent state
    const newQuery = { ...query, appName: option?.value || undefined, predefinedMetric: undefined };
    onChange(newQuery);

    // Run query for logs when app is selected (metrics need both app and predefined metric)
    if (queryType === QueryType.logs && option?.value) {
      onRunQuery();
    }
  };

  const onRemoveFilter = (filterToRemove: QueryFilter) => {
    const filters = query.filters || [];
    const updatedFilters = filters.filter(
      (f) => !(f.column === filterToRemove.column && f.operator === filterToRemove.operator && f.value === filterToRemove.value)
    );
    const newQuery = { ...query, filters: updatedFilters };
    onChange(newQuery);
    onRunQuery();
  };

  const { pageSize = DEFAULT_QUERY.pageSize, predefinedMetric, appName } = query;
  const filters = query.filters || [];

  // The app list, fetched once per (data source, time range, query type) and kept
  // as a stable promise. It runs eagerly (the fetch starts as this memo is
  // created), and the Combobox loader below awaits it.
  const appOptions = useMemo<Promise<Array<{ label: string; value: string }>>>(() => {
    if (queryType !== QueryType.metrics && queryType !== QueryType.logs) {
      return Promise.resolve([]);
    }
    // Grafana stores the dashboard time range in the URL.
    const { fromTime, toTime } = parseTimeRange(currentTimeFrom, currentTimeTo);
    return datasource
      .getApps(fromTime, toTime)
      .then((apps) => {
        const appNames = queryType === QueryType.logs ? apps.LogsApps : apps.MetricsApps;
        // Sort by version descending so the most recent appears first.
        // App names follow the pattern "vendor.name@major.minor.patch".
        const sorted = [...appNames].sort((a, b) => {
          const vA = semver.coerce(a.split('@')[1]);
          const vB = semver.coerce(b.split('@')[1]);
          if (!vA || !vB) {
            return 0;
          }
          return semver.rcompare(vA, vB);
        });
        const options = sorted.map((name) => ({ label: name, value: name }));
        // Keep the currently-selected app selectable even if it is no longer returned.
        if (query.appName && !options.some((o) => o.value === query.appName)) {
          options.unshift({ label: query.appName, value: query.appName });
        }
        return options;
      })
      .catch((error) => {
        console.error('Error fetching app names:', error);
        return query.appName ? [{ label: query.appName, value: query.appName }] : [];
      });
  }, [queryType, datasource, currentTimeFrom, currentTimeTo, query.appName]);

  // App-name options loader for the Combobox below.
  //
  // Combobox only re-derives a plain-array `options` prop at mount, so an array
  // that is empty until the fetch resolves leaves the field on "No options found"
  // until the user types. A function uses Combobox's async path, which re-loads on
  // every menu open — but Combobox wraps it in useLatestAsyncCall and discards a
  // resolved result if the loader's identity changed mid-lookup, a race an
  // inline/changing function loses in the frequently-re-rendering alert-rule
  // editor. So the loader keeps a constant identity (reading the latest fetch
  // through a ref) and AWAITS that fetch rather than reading a snapshot — which
  // also means opening the field before the fetch finishes still resolves the
  // apps once they arrive, instead of showing an empty menu until reopened.
  const appOptionsRef = useRef(appOptions);
  appOptionsRef.current = appOptions;
  const loadAppNameOptions = useCallback(async (inputValue: string) => {
    const options = await appOptionsRef.current;
    return options.filter((option) => option.label.toLowerCase().includes(inputValue.toLowerCase()));
  }, []);

  const queryTypeOptions = useMemo(
    () => [
      { label: 'Logs', value: QueryType.logs },
      { label: 'Metrics', value: QueryType.metrics },
    ],
    []
  );

  const predefinedMetricOptions = useMemo(
    () => [
      { label: 'Request Rate per Account', value: PredefinedMetricType.REQUEST_RATE },
      { label: 'Error Rate per Handler', value: PredefinedMetricType.ERROR_RATE_BY_HANDLER },
      { label: 'Latency Stats per Account and Handler', value: PredefinedMetricType.LATENCY_STATS_BY_ACCOUNT_AND_HANDLER },
      { label: 'Latency Stats per Account', value: PredefinedMetricType.LATENCY_STATS_PER_ACCOUNT },
      { label: '2xx Latency P50 per Handler', value: PredefinedMetricType.LATENCY_P50_PER_HANDLER },
      { label: '2xx Latency P90 per Handler', value: PredefinedMetricType.LATENCY_P90_PER_HANDLER },
      { label: '2xx Latency P99 per Handler', value: PredefinedMetricType.LATENCY_P99_PER_HANDLER },
    ],
    []
  );

  return (
    <Stack gap={2} direction="column">
      {/* Error display */}
      {queryError && (
        <Alert title="Query Error" severity="error">
          {queryError.message}
        </Alert>
      )}
      
      {/* First row: Query configuration fields */}
      <Stack gap={0}>
        <InlineField label="Query Type" labelWidth={16} tooltip="Select logs or metrics">
          <Combobox
            id="query-editor-type"
            aria-label="Query Type"
            options={queryTypeOptions}
            value={queryType}
            onChange={onQueryTypeChange}
            placeholder="Select query type"
            isClearable={false}
            width={24}
          />
        </InlineField>

        {(queryType === QueryType.metrics || queryType === QueryType.logs) && (
          <>
            <InlineField label="App name" labelWidth={16} tooltip="Select an app name from the available options">
              <Combobox
                id="query-editor-app-name"
                aria-label="App name"
                // Async loader (see loadAppNameOptions above), not a plain array: a plain
                // array never populates because Combobox only seeds it at mount, before the
                // apps have loaded. Combobox shows its own loading spinner while the loader
                // is in flight.
                options={loadAppNameOptions}
                value={appName}
                onChange={onAppNameChange}
                placeholder="Select app name"
                isClearable={true}
                width={24}
              />
            </InlineField>

            {queryType === QueryType.metrics && appName && (
              <InlineField 
                label="Metric Type"
                labelWidth={16} 
                tooltip="Select the type of metric to visualize. Request counting metrics show requests over time."
              >
                <Combobox
                  id="query-editor-metric-type"
                  aria-label="Metric Type"
                  options={predefinedMetricOptions}
                  value={predefinedMetric}
                  onChange={onPredefinedMetricChange}
                  placeholder="Select metric type"
                  isClearable={true}
                  width={32}
                />
              </InlineField>
            )}
          </>
        )}

        <InlineField label="Page Size" labelWidth={16} tooltip="Number of records to fetch (default: 100)">
          <Input
            id="query-editor-page-size"
            aria-label="Page Size"
            type="number"
            onChange={onPageSizeChange}
            value={pageSize}
            placeholder="100"
            min={1}
            max={1000}
            width={8}
          />
        </InlineField>
      </Stack>

      {/* Second row: Filters section */}
      {queryType === QueryType.logs && filters.length > 0 && (
        <Stack gap={0}>
          <InlineField label="Filters" labelWidth={16} tooltip="Filters applied to the query. Click X on a tag to remove.">
            <Stack gap={1} direction="row" wrap>
              {filters.map((filter, index) => {
                const operatorSymbol = filter.operator === '!=' ? '≠' : '=';
                return (
                  <Tag
                    key={`${filter.column}-${filter.operator}-${filter.value}-${index}`}
                    name={`${filter.column} ${operatorSymbol} ${filter.value}`}
                    colorIndex={filter.operator === '!=' ? 9 : 1}
                    icon="times"
                    onClick={() => onRemoveFilter(filter)}
                    style={{ cursor: 'pointer' }}
                  />
                );
              })}
            </Stack>
          </InlineField>
        </Stack>
      )}
    </Stack>
  );
}
