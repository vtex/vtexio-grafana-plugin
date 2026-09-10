import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConfigEditor } from '../ConfigEditor';
import { VTEXIODataSourceOptions, VTEXIOSecureJsonData } from '../../types';

type Props = React.ComponentProps<typeof ConfigEditor>;

function buildProps(overrides?: {
  jsonData?: Partial<VTEXIODataSourceOptions>;
  secureJsonData?: Partial<VTEXIOSecureJsonData>;
  secureJsonFields?: Record<string, boolean>;
}): Props {
  return {
    onOptionsChange: jest.fn(),
    options: {
      id: 1,
      uid: 'test-uid',
      orgId: 1,
      name: 'VTEX IO',
      type: 'vtexio-grafana-datasource',
      typeName: 'VTEX IO',
      typeLogoUrl: '',
      access: 'proxy',
      url: '',
      password: '',
      user: '',
      database: '',
      basicAuth: false,
      basicAuthUser: '',
      withCredentials: false,
      isDefault: false,
      readOnly: false,
      version: 1,
      jsonData: { appKey: '', ...overrides?.jsonData },
      secureJsonData: { appToken: '', ...overrides?.secureJsonData },
      secureJsonFields: overrides?.secureJsonFields ?? {},
      // The real prop type carries many DataSourceSettings fields ConfigEditor never
      // reads; this test double only needs the ones it actually destructures.
    } as any,
  };
}

describe('ConfigEditor', () => {
  it('renders the App Key, Account, and App Token fields', () => {
    render(<ConfigEditor {...buildProps()} />);

    expect(screen.getByLabelText('App Key')).toBeInTheDocument();
    expect(screen.getByLabelText('Account')).toBeInTheDocument();
    expect(screen.getByLabelText('App Token')).toBeInTheDocument();
  });

  it('does not render an apiUrl field: it is dev-only, set via provisioning, never customer-facing', () => {
    render(<ConfigEditor {...buildProps()} />);

    expect(screen.queryByLabelText(/api url/i)).not.toBeInTheDocument();
  });

  it('updates appKey and auto-extracts the tenant into Account on a valid key', () => {
    const props = buildProps();
    render(<ConfigEditor {...props} />);

    fireEvent.change(screen.getByLabelText('App Key'), {
      target: { value: 'vtexappkey-footloose-ABCD1234' },
    });

    expect(props.onOptionsChange).toHaveBeenCalledWith(
      expect.objectContaining({
        jsonData: expect.objectContaining({ appKey: 'vtexappkey-footloose-ABCD1234', tenant: 'footloose' }),
      })
    );
  });

  it('leaves tenant untouched when the App Key does not match the expected pattern', () => {
    const props = buildProps();
    render(<ConfigEditor {...props} />);

    fireEvent.change(screen.getByLabelText('App Key'), { target: { value: 'not-a-valid-key' } });

    expect(props.onOptionsChange).toHaveBeenCalledWith(
      expect.objectContaining({
        jsonData: expect.objectContaining({ appKey: 'not-a-valid-key' }),
      })
    );
    const [[lastCall]] = (props.onOptionsChange as jest.Mock).mock.calls.slice(-1);
    expect(lastCall.jsonData.tenant).toBeUndefined();
  });

  it('lets Account override the auto-extracted tenant', () => {
    const props = buildProps({ jsonData: { tenant: 'footloose' } });
    render(<ConfigEditor {...props} />);

    fireEvent.change(screen.getByLabelText('Account'), { target: { value: 'othertenant' } });

    expect(props.onOptionsChange).toHaveBeenCalledWith(
      expect.objectContaining({ jsonData: expect.objectContaining({ tenant: 'othertenant' }) })
    );
  });

  it('updates the App Token as secureJsonData', () => {
    const props = buildProps();
    render(<ConfigEditor {...props} />);

    fireEvent.change(screen.getByLabelText('App Token'), { target: { value: 'my-secret-token' } });

    expect(props.onOptionsChange).toHaveBeenCalledWith(
      expect.objectContaining({ secureJsonData: expect.objectContaining({ appToken: 'my-secret-token' }) })
    );
  });

  it('shows "Configured" as the App Token placeholder once a secret is already set', () => {
    render(<ConfigEditor {...buildProps({ secureJsonFields: { appToken: true } })} />);

    expect(screen.getByLabelText('App Token')).toHaveAttribute('placeholder', 'Configured');
  });
});
