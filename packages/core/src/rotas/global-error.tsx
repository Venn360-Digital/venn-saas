'use client'

/**
 * The last boundary. It replaces the root layout entirely, so it renders its own
 * <html> and <body> and sits ABOVE ThemeProvider — the `.dark` class is never
 * applied here and globals.css may not even have loaded. Everything is therefore
 * inline and theme-neutral on purpose; reaching for a token would risk rendering
 * invisible text at the exact moment the app has already failed.
 */
export default function GlobalError({
    error,
    reset,
}: {
    error: Error & { digest?: string }
    reset: () => void
}) {
    return (
        <html lang="pt-BR">
            <body
                style={{
                    margin: 0,
                    minHeight: '100vh',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '1.5rem',
                    backgroundColor: '#f7f9fa',
                    color: '#0f3351',
                    fontFamily:
                        'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
                }}
            >
                <div style={{ maxWidth: '26rem', textAlign: 'center' }}>
                    <h1
                        style={{
                            margin: 0,
                            fontSize: '1.75rem',
                            lineHeight: 1.2,
                            fontWeight: 700,
                        }}
                    >
                        Alguma coisa quebrou
                    </h1>
                    <p
                        style={{
                            margin: '0.75rem 0 1.5rem',
                            fontSize: '0.875rem',
                            lineHeight: 1.5,
                            color: '#5b7183',
                        }}
                    >
                        Recarregue a página. Se continuar, o problema está do nosso lado.
                    </p>
                    <button
                        type="button"
                        onClick={reset}
                        style={{
                            cursor: 'pointer',
                            borderRadius: '0.625rem',
                            border: 'none',
                            backgroundColor: '#3678ae',
                            color: '#ffffff',
                            padding: '0.5rem 1.25rem',
                            fontSize: '0.875rem',
                            fontWeight: 500,
                        }}
                    >
                        Recarregar
                    </button>
                    {error.digest ? (
                        <p
                            style={{
                                marginTop: '1.5rem',
                                fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
                                fontSize: '0.75rem',
                                color: '#5b7183',
                            }}
                        >
                            {error.digest}
                        </p>
                    ) : null}
                </div>
            </body>
        </html>
    )
}
