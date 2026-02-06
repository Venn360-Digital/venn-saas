import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
    console.log('🌱 Starting seed...')

    // 1. Create a default user if not exists (simulate auth user)
    // Note: In Supabase, users are in auth.users. This local user is for public.users table.
    // We need to match a real Auth ID if we want to login, but for dev we can create a placeholder
    // and manually link or just rely on the app creating the user via triggers (if set up) or manual insert.

    // For now, let's create a default Workspace that we can manually assign to any user

    const workspaceSlug = 'kaly-hq'

    const existingWorkspace = await prisma.workspace.findUnique({
        where: { slug: workspaceSlug }
    })

    if (existingWorkspace) {
        console.log('✅ Workspace already exists:', existingWorkspace.name)
        return
    }

    // Create workspace
    const workspace = await prisma.workspace.create({
        data: {
            name: 'Kaly HQ',
            slug: workspaceSlug,
            settings: { theme: 'light', language: 'pt-BR' },
        }
    })

    console.log('✅ Created Workspace:', workspace.name)

    // We can't easily create a WorkspaceUser without a valid auth.users ID.
    // The user should run this, then manually add their user ID to this workspace via SQL or I can provide a SQL script.
}

main()
    .then(async () => {
        await prisma.$disconnect()
    })
    .catch(async (e) => {
        console.error(e)
        await prisma.$disconnect()
        process.exit(1)
    })
