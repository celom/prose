/// <reference types='vitest' />
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';
import * as path from 'path';
import { readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync(path.join(import.meta.dirname, 'package.json'), 'utf-8'));

export default defineConfig(() => ({
  root: import.meta.dirname,
  define: {
    __PROSE_VERSION__: JSON.stringify(pkg.version),
  },
  cacheDir: '../../node_modules/.vite/packages/prose',
  plugins: [
    dts({
      entryRoot: 'src',
      tsconfigPath: path.join(import.meta.dirname, 'tsconfig.lib.json'),
    }),
  ],
  // Uncomment this if you are using workers.
  // worker: {
  //  plugins: [],
  // },
  // Configuration for building your library.
  // See: https://vite.dev/guide/build.html#library-mode
  build: {
    outDir: './dist',
    emptyOutDir: true,
    reportCompressedSize: true,
    commonjsOptions: {
      transformMixedEsModules: true,
    },
    lib: {
      entry: {
        index: 'src/index.ts',
        cli: 'src/cli.ts',
      },
      name: '@celom/prose',
      formats: ['es' as const],
    },
    rollupOptions: {
      external: [
        '@modelcontextprotocol/sdk',
        '@modelcontextprotocol/sdk/server/mcp.js',
        '@modelcontextprotocol/sdk/server/stdio.js',
        'zod',
        'node:fs',
        'node:fs/promises',
        'node:path',
        'node:url',
      ],
      output: {
        banner: (chunk) => {
          if (chunk.fileName === 'cli.js') {
            return '#!/usr/bin/env node';
          }
          return '';
        },
      },
    },
  },
  test: {
    name: '@celom/prose',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: './test-output/vitest/coverage',
      provider: 'v8' as const,
    },
  },
}));
