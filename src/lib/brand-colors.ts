/**
 * Colours that belong to other companies.
 *
 * These are the one legitimate exception to the token rule: WhatsApp's green and
 * Instagram's gradient are those products' identities, and recolouring them to
 * our palette would make the channel harder to recognise, not more consistent.
 * They are gathered here — and this file is allowlisted in lint:colors — so the
 * exception is declared in one place rather than argued for at each call site.
 *
 * Anything that is OUR colour does not belong in this file. If a value here is
 * not a third party's brand, it is a token.
 */
export const BRAND_COLORS = {
    whatsapp: 'bg-[#25D366]',
    whatsappDark: 'bg-[#128C7E]',
    instagram: 'bg-gradient-to-r from-[#833AB4] via-[#E1306C] to-[#F77737]',
    slack: 'bg-[#4A154B]',
    mercadoLivre: 'bg-[#FFE600]',
    google: 'bg-[#4285F4]',
} as const

/** For channels that have no brand of their own — a generic web widget. */
export const NEUTRAL_CHANNEL = 'bg-muted-foreground'
