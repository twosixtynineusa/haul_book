/**
 * Jest config for the Haul Book API.
 *
 * The converter specs are pure, and the conversion e2e boots a NestJS app with an
 * in-memory company list, writing converted files to a throwaway temp folder
 * (test/setup-env.ts). The companies integration spec needs a real Postgres: the
 * `globalSetup` provisions an isolated test database (DATABASE_URL_TEST) with
 * `prisma db push`, and that spec self-skips when DATABASE_URL_TEST is unset.
 * Infra must be up first (`make test-api` / `make ci` bring it up).
 */
/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/test'],
  testMatch: ['**/*.spec.ts', '**/*.e2e-spec.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  globalSetup: '<rootDir>/test/global-setup.ts',
  transform: {
    '^.+\\.[tj]s$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.jest.json',
        diagnostics: false,
      },
    ],
  },
  setupFiles: ['<rootDir>/test/setup-env.ts'],
  maxWorkers: 1,
  testTimeout: 30000,
  clearMocks: true,
};
