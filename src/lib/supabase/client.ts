import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
    const dbSchema = (process.env.NEXT_PUBLIC_SUPABASE_DB_SCHEMA || 'public') as 'public' | 'dev'

    return createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            db: {
                schema: dbSchema,
            },
        }
    )
}
