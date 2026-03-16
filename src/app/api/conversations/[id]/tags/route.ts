import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'

// GET: List tags on a conversation
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id: conversationId } = await params
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

        const tags = await prisma.conversationTag.findMany({
            where: { conversationId },
            include: { tag: { select: { id: true, name: true, color: true } } }
        })

        return NextResponse.json(tags.map(ct => ct.tag))
    } catch (error) {
        console.error('[CONV_TAGS_GET] Error:', error)
        return NextResponse.json({ error: 'Erro' }, { status: 500 })
    }
}

// POST: Add tag to conversation
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id: conversationId } = await params
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

        const { tagId } = await request.json()
        if (!tagId) return NextResponse.json({ error: 'tagId obrigatório' }, { status: 400 })

        await prisma.conversationTag.create({
            data: { conversationId, tagId }
        })

        const tag = await prisma.tag.findUnique({
            where: { id: tagId },
            select: { id: true, name: true, color: true }
        })

        return NextResponse.json(tag, { status: 201 })
    } catch (error: any) {
        if (error?.code === 'P2002') {
            return NextResponse.json({ error: 'Tag já adicionada' }, { status: 409 })
        }
        console.error('[CONV_TAGS_POST] Error:', error)
        return NextResponse.json({ error: 'Erro' }, { status: 500 })
    }
}

// DELETE: Remove tag from conversation
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id: conversationId } = await params
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

        const { tagId } = await request.json()
        if (!tagId) return NextResponse.json({ error: 'tagId obrigatório' }, { status: 400 })

        await prisma.conversationTag.delete({
            where: { conversationId_tagId: { conversationId, tagId } }
        })

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('[CONV_TAGS_DELETE] Error:', error)
        return NextResponse.json({ error: 'Erro' }, { status: 500 })
    }
}
