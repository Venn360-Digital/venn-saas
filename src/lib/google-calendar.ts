import prisma from '@/lib/prisma'
import { resolveGoogleOAuthClient, type GoogleCalendarCredentials } from '@/lib/google-oauth-client'
import { FUSO_DO_NEGOCIO } from '@/lib/fuso'


/**
 * As credenciais do Google guardadas em `Integration.credentials`.
 *
 * A coluna é `Json?` no Prisma, então o tipo precisa ser afirmado em algum
 * ponto — não há como o banco provar a forma. O que mudou é o alcance da
 * afirmação: antes era `as any` e desligava a checagem do arquivo inteiro;
 * agora é um cast para esta interface, num helper só, e todo o resto continua
 * verificado.
 */
type GoogleCredentials = GoogleCalendarCredentials

/** O que este módulo precisa de um registro de integração. */
interface CalendarIntegration {
    id: string
    credentials: unknown
}

/**
 * Os campos de uma atividade que viram um evento no calendário.
 *
 * Deliberadamente mais frouxo que o modelo do Prisma: os chamadores passam o
 * resultado de um create/update com `contact` e `deal` incluídos, e exigir o
 * modelo inteiro obrigaria a reproduzir relações que o evento não usa.
 */
export interface SyncableActivity {
    id: string
    title: string
    type: string
    description?: string | null
    dueDate?: Date | string | null
    startTime?: string | null
    endTime?: string | null
    reminderMinutes?: number | null
    googleCalendarEventId?: string | null
    contact?: { name?: string | null; phone?: string | null } | null
    deal?: { title?: string | null } | null
}

function credentialsOf(integration: CalendarIntegration): GoogleCredentials {
    return (integration.credentials ?? {}) as GoogleCredentials
}

interface CalendarEventResult {
    success: boolean
    eventId?: string
    error?: string
}

// Refresh access token if expired
/**
 * `workspaceId` and not just the row: when the clinic connects through the
 * platform's application, its own row holds only the tokens, and refreshing
 * still needs the application that issued them.
 */
async function getValidAccessToken(
    integration: CalendarIntegration,
    workspaceId: string
): Promise<string | null> {
    const creds = credentialsOf(integration)
    if (!creds?.refresh_token) return null

    // If token still valid (5min buffer)
    if (creds.expiry_date && Date.now() < creds.expiry_date - 300000) {
        // `?? null` e não `creds.access_token` direto: o JSON pode trazer
        // expiry_date e refresh_token sem access_token, e a função promete
        // `string | null`. Com `any` isso devolvia undefined silenciosamente.
        return creds.access_token ?? null
    }

    const resolved = await resolveGoogleOAuthClient(workspaceId)
    if (!resolved) return null

    try {
        const res = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: resolved.client.clientId,
                client_secret: resolved.client.clientSecret,
                refresh_token: creds.refresh_token,
                grant_type: 'refresh_token',
            }),
        })

        if (!res.ok) {
            console.error('[GCAL_SYNC] Token refresh failed')
            await prisma.integration.update({
                where: { id: integration.id },
                data: { status: 'error' },
            })
            return null
        }

        const tokens = await res.json()
        await prisma.integration.update({
            where: { id: integration.id },
            data: {
                credentials: {
                    ...creds,
                    access_token: tokens.access_token,
                    expiry_date: Date.now() + (tokens.expires_in * 1000),
                },
            },
        })

        return tokens.access_token
    } catch (error) {
        console.error('[GCAL_SYNC] Token refresh error:', error)
        return null
    }
}

// Build Google Calendar event from activity data
function buildCalendarEvent(activity: SyncableActivity) {
    const description = [
        activity.description || '',
        activity.contact?.name ? `Paciente: ${activity.contact.name} ${activity.contact.phone || ''}` : '',
        activity.deal?.title ? `Negócio: ${activity.deal.title}` : '',
        `Tipo: ${activity.type}`,
        'Criado no OdontoBox360',
    ].filter(Boolean).join('\n')

    /**
     * O fuso vem da constante do sistema, não de um literal próprio.
     *
     * Este arquivo tinha a **segunda cópia** de `America/Sao_Paulo`, ao lado de
     * `FUSO_DO_NEGOCIO` em `lib/fuso.ts`. O evento que vai para a agenda do
     * cliente é um dos piores lugares para uma cópia divergir: o horário
     * aparece errado no Google **dele**, não aqui, e nenhuma tela nossa mostra
     * o problema.
     *
     * **O que isto NÃO resolve, e é bom estar escrito**: `FUSO_DO_NEGOCIO` é
     * constante de instalação — fuso por conta ainda não existe. Para uma
     * empresa que opera fora do Brasil, um compromisso das 9h é escrito na
     * agenda dela como 9h de São Paulo. Limitação conhecida, não descuido;
     * consertá-la é dar fuso à conta, com migração.
     */
    const timeZone = FUSO_DO_NEGOCIO

    if (activity.dueDate && activity.startTime) {
        const dateStr = new Date(activity.dueDate).toISOString().split('T')[0]
        const startDateTime = `${dateStr}T${activity.startTime}:00`
        const endTime = activity.endTime || addHour(activity.startTime)
        const endDateTime = `${dateStr}T${endTime}:00`

        return {
            summary: activity.title,
            description,
            start: { dateTime: startDateTime, timeZone },
            end: { dateTime: endDateTime, timeZone },
            reminders: activity.reminderMinutes ? {
                useDefault: false,
                overrides: [{ method: 'popup', minutes: activity.reminderMinutes }],
            } : { useDefault: true },
        }
    }

    if (activity.dueDate) {
        const dateStr = new Date(activity.dueDate).toISOString().split('T')[0]
        return {
            summary: activity.title,
            description,
            start: { date: dateStr },
            end: { date: dateStr },
        }
    }

    const today = new Date().toISOString().split('T')[0]
    return {
        summary: activity.title,
        description,
        start: { date: today },
        end: { date: today },
    }
}

function addHour(time: string): string {
    const [h, m] = time.split(':').map(Number)
    return `${String((h + 1) % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/**
 * Automatically sync an activity to Google Calendar.
 * Call this after creating or updating an activity.
 * Fails silently — does not block the main operation.
 */
export async function syncActivityToGoogleCalendar(
    workspaceId: string,
    activity: SyncableActivity,
): Promise<CalendarEventResult> {
    try {
        // Check if workspace has a connected Google Calendar
        const integration = await prisma.integration.findFirst({
            where: {
                workspaceId,
                provider: 'google_calendar',
                status: 'connected',
            },
        })

        if (!integration) {
            return { success: false, error: 'not_connected' }
        }

        const accessToken = await getValidAccessToken(integration, workspaceId)
        if (!accessToken) {
            return { success: false, error: 'token_expired' }
        }

        const event = buildCalendarEvent(activity)

        // Check if this activity was already synced (has a Google event ID)
        const existingEventId = activity.googleCalendarEventId

        let res: Response

        if (existingEventId) {
            // Update existing event
            res = await fetch(
                `https://www.googleapis.com/calendar/v3/calendars/primary/events/${existingEventId}`,
                {
                    method: 'PUT',
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(event),
                }
            )
        } else {
            // Create new event
            res = await fetch(
                'https://www.googleapis.com/calendar/v3/calendars/primary/events',
                {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(event),
                }
            )
        }

        if (res.ok) {
            const eventData = await res.json()
            // Update last sync timestamp
            await prisma.integration.update({
                where: { id: integration.id },
                data: { lastSyncAt: new Date() },
            })
            return { success: true, eventId: eventData.id }
        } else {
            const err = await res.text()
            console.error('[GCAL_SYNC] API error:', err)
            return { success: false, error: err }
        }
    } catch (error) {
        console.error('[GCAL_SYNC] Error:', error)
        return { success: false, error: String(error) }
    }
}

/**
 * Delete an event from Google Calendar when activity is deleted.
 * Fails silently.
 */
export async function deleteActivityFromGoogleCalendar(
    workspaceId: string,
    googleCalendarEventId: string,
): Promise<void> {
    try {
        const integration = await prisma.integration.findFirst({
            where: {
                workspaceId,
                provider: 'google_calendar',
                status: 'connected',
            },
        })

        if (!integration) return

        const accessToken = await getValidAccessToken(integration, workspaceId)
        if (!accessToken) return

        await fetch(
            `https://www.googleapis.com/calendar/v3/calendars/primary/events/${googleCalendarEventId}`,
            {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${accessToken}` },
            }
        )
    } catch (error) {
        console.error('[GCAL_SYNC] Delete error:', error)
    }
}
