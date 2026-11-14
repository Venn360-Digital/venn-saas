import Link from 'next/link'
import { FileQuestion } from 'lucide-react'

import { Button } from '@venn/ui/button'
import { EmptyState } from '@venn/core/components/shared/EmptyState'

export default function NotFound() {
    return (
        <div className="flex min-h-screen items-center justify-center p-6">
            <EmptyState
                icon={FileQuestion}
                title="Página não encontrada"
                description="O endereço não existe ou você não tem acesso a ele."
                action={
                    <Button asChild>
                        <Link href="/dashboard">Ir para o dashboard</Link>
                    </Button>
                }
                className="w-full max-w-md"
            />
        </div>
    )
}
