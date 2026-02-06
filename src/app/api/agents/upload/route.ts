import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import prisma from '@/lib/prisma'

export async function POST(request: NextRequest) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            return new NextResponse('Unauthorized', { status: 401 })
        }

        const formData = await request.formData()
        const file = formData.get('file') as File
        const agentId = formData.get('agentId') as string

        if (!file) {
            return new NextResponse('No file provided', { status: 400 })
        }

        // Validate file type
        const allowedTypes = [
            'application/pdf',
            'text/plain',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/vnd.ms-excel',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'image/png',
            'image/jpeg',
        ]

        if (!allowedTypes.includes(file.type)) {
            return new NextResponse('Invalid file type', { status: 400 })
        }

        // Generate unique filename
        const timestamp = Date.now()
        const filename = `${agentId}/${timestamp}-${file.name}`

        // Upload to Supabase Storage
        const { data, error } = await supabase.storage
            .from('agent-knowledge')
            .upload(filename, file, {
                contentType: file.type,
                upsert: false,
            })

        if (error) {
            console.error('[UPLOAD_ERROR]', error)
            return new NextResponse('Upload failed', { status: 500 })
        }

        // Get public URL
        const { data: { publicUrl } } = supabase.storage
            .from('agent-knowledge')
            .getPublicUrl(filename)

        return NextResponse.json({
            url: publicUrl,
            filename: file.name,
            size: file.size,
            type: file.type,
        })
    } catch (error) {
        console.error('[UPLOAD_POST]', error)
        return new NextResponse('Internal Error', { status: 500 })
    }
}
