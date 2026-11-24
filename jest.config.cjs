/** Jest runs unit tests (model, layout, store, sync client) and server tests (registry, MCP tools, sync). */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/app', '<rootDir>/server'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          module: 'commonjs',
          moduleResolution: 'node',
          esModuleInterop: true,
          jsx: 'react-jsx',
          isolatedModules: true,
          types: ['jest', 'node'],
        },
      },
    ],
  },
};
