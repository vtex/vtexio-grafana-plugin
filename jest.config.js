// force timezone to UTC to allow tests to work regardless of local timezone
// generally used by snapshots, but can affect specific tests
process.env.TZ = 'UTC';

const baseConfig = require('./.config/jest.config');

module.exports = {
  // Jest configuration provided by Grafana scaffolding
  ...baseConfig,
  // Ensure jsdom environment is used for all tests (including tests directory)
  testEnvironment: 'jest-environment-jsdom',
  // Extend testMatch to include unit tests directory
  testMatch: [
    ...baseConfig.testMatch,
    '<rootDir>/tests/unit/**/*.{test,jest}.{js,jsx,ts,tsx}',
  ],
};
