// The shadcn CLI now emits `import { cn } from "cn"` in everything under
// components/ui, so the primitives and the 31 app files that import from here
// were merging class names through two separate implementations of the same
// clsx + tailwind-merge logic. Re-exporting keeps one implementation in the
// bundle without rewriting every call site, and app code can go on importing
// from the alias it already uses.
export { cn } from "cn"
export type { ClassValue } from "clsx"
