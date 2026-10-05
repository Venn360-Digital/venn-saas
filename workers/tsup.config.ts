import { defineConfig } from 'tsup'

export default defineConfig({
    entry: ['workers/src/index.ts'],
    outDir: 'workers/dist',
    format: ['cjs'],
    target: 'node22',
    platform: 'node',
    sourcemap: true,
    clean: true,
    // Only our own source is bundled — that is what resolves the `@/*` aliases and
    // the server-only shim. Runtime dependencies stay external on purpose:
    // Prisma loads a native query engine at runtime, and the LangChain packages do
    // dynamic requires that a bundle breaks (next.config.ts lists them under
    // serverExternalPackages for the same reason). The runtime image therefore
    // ships node_modules alongside this bundle.
    skipNodeModulesBundle: true,
    esbuildOptions(options) {
        options.alias = {
            ...options.alias,
            '@': './src',
            'server-only': './workers/src/shims/server-only.ts',
        }
    },
})
