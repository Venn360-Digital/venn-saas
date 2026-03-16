import { createClient as createSupabaseClient } from '@supabase/supabase-js'

/**
 * Creates a Supabase admin client with service role key.
 * This bypasses RLS and should ONLY be used on the server side.
 * Never expose this client to the browser.
 * 
 * Uses SUPABASE_DB_SCHEMA env var to select the database schema.
 * Defaults to 'public' (production).
 */
export function createAdminClient() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    const dbSchema = (process.env.SUPABASE_DB_SCHEMA || 'public') as 'public' | 'dev'

    if (!supabaseUrl || !supabaseServiceKey) {
        throw new Error('Missing Supabase URL or Service Role Key')
    }

    return createSupabaseClient(supabaseUrl, supabaseServiceKey, {
        auth: {
            autoRefreshToken: false,
            persistSession: false,
        },
        db: {
            schema: dbSchema,
        },
    })
}
