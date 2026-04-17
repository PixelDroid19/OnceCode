import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/src/**/*.test.ts'],
    restoreMocks: true,
    clearMocks: true,
    mockReset: true,
    testTimeout: 20000,
    hookTimeout: 20000,
  },
})
