/** Integration tests: boot the Nest app against a throwaway Postgres (Testcontainers). */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/test/integration/**/*.int-spec.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  testTimeout: 120000,
};
