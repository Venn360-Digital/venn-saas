import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/auth/workspace'
import { DesignSystemGallery } from './gallery'

export const metadata = {
    title: 'Design system — OdontoBox360',
}

/**
 * The visible face of DESIGN.md.
 *
 * It renders the real primitives against the real tokens and reads its swatch
 * values back out of the computed stylesheet, so it cannot drift from the code
 * the way a static pattern-library page does — the one in docs/referencias/ is
 * the cautionary example.
 *
 * notFound() rather than a 403 page: this is internal tooling, and a 404 does
 * not confirm to a logged-in member of another role that the route exists.
 */
export default async function DesignSystemPage() {
    const auth = await requireRole(['OWNER', 'ADMIN'])
    if (!auth.ok) notFound()

    return <DesignSystemGallery />
}
