module.exports = {
  rootDir: __dirname, testEnvironment: 'jsdom',
  testEnvironmentOptions: { url: 'https://motion.test' },
  testMatch: ['<rootDir>/tests/**/*.test.ts'],
  modulePaths: ['<rootDir>/../studio-extension/node_modules'],
  transform: { '^.+\\.tsx?$': ['<rootDir>/../studio-extension/node_modules/ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }] },
};
