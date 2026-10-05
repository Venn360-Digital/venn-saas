// Stub for the `server-only` package.
// `server-only` throws when imported outside a React Server Component, which
// breaks plain Node workers that reuse modules from src/lib (RAG, etc).
// tsconfig paths maps "server-only" to this file for the worker build.
export {}
