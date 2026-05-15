import React, { ChangeEvent } from 'react';
import { InlineField, Input } from '@grafana/ui';
import { DataSourcePluginOptionsEditorProps } from '@grafana/data';
import { VTEXIODataSourceOptions, VTEXIOSecureJsonData } from '../types';
import { extractTenantFromAppKey } from './utils';

interface Props extends DataSourcePluginOptionsEditorProps<VTEXIODataSourceOptions, VTEXIOSecureJsonData> {}

export function ConfigEditor(props: Props) {
  const { onOptionsChange, options } = props;
  const { secureJsonData, secureJsonFields, jsonData } = options;

  const onAppTokenChange = (event: ChangeEvent<HTMLInputElement>) => {
    onOptionsChange({
      ...options,
      secureJsonData: {
        appToken: event.target.value,
      },
    });
  };

  // Enhanced onAppKeyChange to update tenant if pattern matches
  const onAppKeyChange = (event: ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    const extractedTenant = extractTenantFromAppKey(value);
    onOptionsChange({
      ...options,
      jsonData: {
        ...options.jsonData,
        appKey: value,
        ...(extractedTenant ? { tenant: extractedTenant } : { tenant: '' }),
      },
    });
  };

  const onResetAPIKey = () => {
    onOptionsChange({
      ...options,
      secureJsonFields: {
        ...options.secureJsonFields,
        appToken: false,
      },
      secureJsonData: {
        ...options.secureJsonData,
        appToken: '',
      },
    });
  };

  return (
    <>
        <InlineField
          label="App Key"
          labelWidth={14}
          interactive
          tooltip={'VTEX app key for the observability platform'}
        >
          <Input
            id="config-editor-app-key"
            aria-label="App Key"
            onChange={onAppKeyChange}
            value={jsonData.appKey || ''}
            placeholder="Enter your app key, e.g. vtexappkey-mystore-ABCD1234"
            width={72}
            required
          />
        </InlineField>
        <InlineField
          label="App Token"
          labelWidth={14}
          interactive
          tooltip={'VTEX app token for the observability platform'}
        >
          <Input
            id="config-editor-app-token"
            aria-label="App Token"
            type="password"
            onChange={onAppTokenChange}
            onReset={onResetAPIKey}
            value={secureJsonData?.appToken || ''}
            placeholder={secureJsonFields?.appToken ? 'Configured' : 'Enter your app token'}
            width={72}
            required
          />
        </InlineField>
    </>
  );
}
