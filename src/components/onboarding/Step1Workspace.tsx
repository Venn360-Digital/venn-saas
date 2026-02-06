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
        <div className="rounded-2xl border border-gray-800 bg-[#0F1629] p-8">
            <div className="mb-8">
                <h2 className="mb-2 text-2xl font-bold">Workspace</h2>
                <p className="text-gray-400">Crie um nome para seu workspace</p>
            </div>

            <div className="space-y-6">
                <div>
                    <Label htmlFor="workspace-name" className="text-sm text-gray-300">
                        Nome do workspace
                    </Label>
                    <Input
                        id="workspace-name"
                        value={name}
                        onChange={(e) => handleNameChange(e.target.value)}
                        placeholder="Venn360"
                        className="mt-2 border-gray-700 bg-[#0A0E27] text-white placeholder:text-gray-500"
                    />
                </div>

                <div>
                    <Label htmlFor="workspace-url" className="text-sm text-gray-300">
                        URL do workspace
                    </Label>
                    <div className="mt-2 flex items-center gap-2">
                        <span className="text-gray-500">platform.kaly.app/</span>
                        <Input
                            id="workspace-url"
                            value={slug}
                            onChange={(e) => setSlug(e.target.value)}
                            placeholder="venn360"
                            className="flex-1 border-gray-700 bg-[#0A0E27] text-white placeholder:text-gray-500"
                        />
                    </div>
                </div>

                <div className="flex justify-end pt-4">
                    <Button
                        onClick={handleContinue}
                        disabled={!name.trim()}
                        className="bg-purple-600 hover:bg-purple-700"
                    >
                        Continuar
                        <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                </div>
            </div>
        </div>
    )
}
