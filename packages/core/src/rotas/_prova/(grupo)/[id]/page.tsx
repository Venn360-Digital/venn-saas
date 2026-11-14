export default async function ProvaDinamica({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    return <main>prova {id}</main>
}
