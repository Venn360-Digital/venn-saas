'use client'

import { Key, Code, Lock } from 'lucide-react'

export function ApiTab() {
    return (
        <div className="space-y-6">
            {/* Header */}
            <div>
                <p className="text-[12.5px] text-muted-foreground">
                    Acesse seu Agente programaticamente via API
                </p>
            </div>

            {/* Coming Soon */}
            <div className="rounded-lg border border-dashed border-muted-foreground/25 p-12 text-center">
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
                    <Code className="h-8 w-8 text-primary" />
                </div>
                <h3 className="text-xl font-semibold mb-2">Em Breve</h3>
                <p className="text-muted-foreground max-w-md mx-auto">
                    Estamos trabalhando para disponibilizar o acesso programático ao seu Agente via API REST.
                    Em breve você poderá gerar API Keys e integrar seu Agente em qualquer sistema.
                </p>
            </div>

            {/* Preview Features */}
            <div className="grid gap-4 md:grid-cols-3">
                <div className="rounded-lg border bg-card p-4">
                    <Key className="h-6 w-6 text-primary mb-3" />
                    <h4 className="font-medium mb-1">API Keys</h4>
                    <p className="text-[12.5px] text-muted-foreground">
                        Gere chaves de acesso seguras para suas aplicações
                    </p>
                </div>
                <div className="rounded-lg border bg-card p-4">
                    <Code className="h-6 w-6 text-primary mb-3" />
                    <h4 className="font-medium mb-1">REST API</h4>
                    <p className="text-[12.5px] text-muted-foreground">
                        Envie mensagens e receba respostas via endpoints REST
                    </p>
                </div>
                <div className="rounded-lg border bg-card p-4">
                    <Lock className="h-6 w-6 text-primary mb-3" />
                    <h4 className="font-medium mb-1">Autenticação</h4>
                    <p className="text-[12.5px] text-muted-foreground">
                        Controle de acesso com tokens JWT e rate limiting
                    </p>
                </div>
            </div>
        </div>
    )
}
