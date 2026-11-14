/**
 * Tipos de `raizes-de-codigo.mjs`, para os verificadores escritos em
 * TypeScript (`check-*.ts`, rodados por tsx) importarem o mesmo módulo que os
 * linters em `.mjs` usam. O módulo é `.mjs` porque `lint-colors`, `lint-fuso`
 * e `lint-workspace` rodam com `node` puro, sem tsx — e o `prebuild` depende
 * deles serem rápidos.
 */
export declare function raizesDeCodigo(): string[]
export declare function arquivosDeCodigo(subcaminhos?: string[] | null): string[]
export declare function exigirPiso(nome: string, arquivos: unknown[], piso: number): void
export declare function conferirAllowlist(nome: string, prefixos: string[], arquivos: string[]): void
