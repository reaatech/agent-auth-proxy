import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    environment: 'node',
    env: {
      USE_PGLITE: 'true',
      MASTER_KEY: 'YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWE=',
      AGENT_JWT_SECRET: 'test-agent-jwt-secret-32-bytes-long!!',
      ADMIN_API_KEY: 'test-admin-api-key-secret-32b!!',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      thresholds: {
        lines: 85,
        functions: 85,
        branches: 80,
        statements: 85,
      },
      exclude: [
        'node_modules/',
        'dist/',
        'tests/',
        '**/*.d.ts',
        'src/types/**',
        'scripts/**',
        '*.config.*',
        '.eslintrc.cjs',
        'test-*.ts',
        'test-*.mjs',
        'src/db/schema/**',
      ],
    },
    setupFiles: ['./tests/setup.ts'],
    testTimeout: 30000,
  },
  resolve: {
    alias: {
      '@': '/src',
      '@auth': '/src/auth',
      '@config': '/src/config',
      '@db': '/src/db',
      '@services': '/src/services',
      '@types': '/src/types',
      '@utils': '/src/utils',
      '@proxy': '/src/proxy',
    },
  },
});
