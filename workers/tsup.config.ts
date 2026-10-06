import path from 'node:path'
import { defineConfig } from 'tsup'

export default defineConfig({
    entry: ['workers/src/index.ts'],
    outDir: 'workers/dist',
    format: ['cjs'],
    target: 'node22',
    platform: 'node',
    sourcemap: true,
    clean: true,
    // Only our own source is bundled — that is what resolves the `@/*` aliases.
    // Runtime dependencies stay external on purpose: Prisma loads a native query
    // engine at runtime, and the LangChain packages do dynamic requires that a
    // bundle breaks (next.config.ts lists them under serverExternalPackages for the
    // same reason). The runtime image therefore ships node_modules alongside this
    // bundle.
    skipNodeModulesBundle: true,
    // ...with one exception. `server-only` must be bundled so the alias below can
    // replace it. Left external, the require survives into the bundle and the real
    // package throws on load: its exports map only resolves to a no-op under the
    // `react-server` condition, which a plain Node process does not set. Three
    // files the worker reuses (src/lib/rag/*) import it as a guard against being
    // pulled into a client component — a guard worth keeping for the Next app, so
    // it is neutralised here rather than deleted there.
    noExternal: ['server-only'],
    esbuildOptions(options) {
        options.alias = {
            ...options.alias,
            // Absolute paths: esbuild resolves a relative alias target against the
            // importing file, which would break for every importer at a different
            // depth.
            '@': path.resolve('src'),
            'server-only': path.resolve('workers/src/shims/server-only.ts'),
        }
    },
})
