module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/api/**/*.e2e.ts'],
  testTimeout: 60000,
  // Node's fetch keeps idle HTTP sockets around for a few seconds; don't let that hold the run open.
  forceExit: true,
};
