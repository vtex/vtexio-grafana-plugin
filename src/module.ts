import { DataSourcePlugin } from '@grafana/data';
import { DataSource } from './datasource';
import { ConfigEditor } from './components/ConfigEditor';
import { QueryEditor } from './components/QueryEditor';
import { AppQuery, VTEXIODataSourceOptions, VTEXIOSecureJsonData } from './types';

console.log('[VTEX Datasource] Module loading...');

export const plugin = new DataSourcePlugin<DataSource, AppQuery, VTEXIODataSourceOptions, VTEXIOSecureJsonData>(DataSource)
  .setConfigEditor(ConfigEditor)
  .setQueryEditor(QueryEditor);

console.log('[VTEX Datasource] Plugin created and exported');
