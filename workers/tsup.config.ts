import { defineConfig } from 'tsup'

export default defineConfig({
    entry: ['workers/src/index.ts'],
    outDir: 'workers/dist',
    format: ['cjs'],
    target: 'node22',
    platform: 'node',
    sourcemap: true,
    clean: true,
    // Bundled so the runtime image does not need the app's full dependency tree,
    // but these three must stay external: Prisma loads its native query engine at
    // runtime, and the LangChain packages do dynamic requires that break bundling
    // (the Next.js config lists them under serverExternalPackages for the same reason).
    external: ['@prisma/client', '.prisma/client'],
    noExternal: [],
    esbuildOptions(options) {
        options.alias = {
            ...options.alias,
            '@': './src',
            'server-only': './workers/src/shims/server-only.ts',
        }
    },
})
