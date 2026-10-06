'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ArrowRight } from 'lucide-react'

interface Step1WorkspaceProps {
    data: {
        workspaceName: string
        workspaceSlug: string
    }
    updateData: (data: any) => void
    onNext: () => void
}

/**
 * Host shown before the workspace slug. Derived from NEXT_PUBLIC_APP_URL rather
 * than hardcoded, so it follows the deployment instead of naming a brand domain
 * in the source.
 */
const workspaceUrlPrefix = (() => {
    const raw = process.env.NEXT_PUBLIC_APP_URL
    if (!raw) return 'app.odontobox360.com.br'
    try {
        return new URL(raw).host
    } catch {
        return raw.replace(/^https?:\/\//, '').replace(/\/$/, '')
    }
})()

export function Step1Workspace({ data, updateData, onNext }: Step1WorkspaceProps) {
    const [name, setName] = useState(data.workspaceName)
    const [slug, setSlug] = useState(data.workspaceSlug)

    const generateSlug = (name: string) => {
        return name
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
    }

    const handleNameChange = (value: string) => {
        setName(value)
        if (!slug || slug === generateSlug(data.workspaceName)) {
            setSlug(generateSlug(value))
        }
    }

    const handleContinue = () => {
        if (!name.trim()) return
        updateData({ workspaceName: name, workspaceSlug: slug || generateSlug(name) })
        onNext()
    }

    return (
        <div className="rounded-2xl border border-border bg-card p-8">
            <div className="mb-8">
                <h2 className="mb-2 text-2xl font-bold">Workspace</h2>
                <p className="text-muted-foreground">Crie um nome para seu workspace</p>
            </div>

            <div className="space-y-6">
                <div>
                    <Label htmlFor="workspace-name" className="text-sm text-foreground">
                        Nome do workspace
                    </Label>
                    <Input
                        id="workspace-name"
                        value={name}
                        onChange={(e) => handleNameChange(e.target.value)}
                        placeholder="Sua Empresa"
                        className="mt-2 border-border bg-card text-white placeholder:text-muted-foreground"
                    />
                </div>

                <div>
                    <Label htmlFor="workspace-url" className="text-sm text-foreground">
                        URL do workspace
                    </Label>
                    <div className="mt-2 flex items-center gap-2">
                        <span className="text-muted-foreground">{workspaceUrlPrefix}/</span>
                        <Input
                            id="workspace-url"
                            value={slug}
                            onChange={(e) => setSlug(generateSlug(e.target.value))}
                            placeholder="suaempresa"
                            className="flex-1 border-border bg-card text-white placeholder:text-muted-foreground"
                        />
                    </div>
                </div>

                <div className="flex justify-end pt-4">
                    <Button
                        onClick={handleContinue}
                        disabled={!name.trim()}

                    >
                        Continuar
                        <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                </div>
            </div>
        </div>
    )
}
