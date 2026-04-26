/// <reference types="npm:@types/react@18.3.1" />

// Prime Care VIP brand tokens for email templates.
// Email clients have spotty support for web fonts and CSS variables, so we
// inline literal HEX colors and use web-safe serif/sans fallbacks that
// approximate Tinos / Roboto.

export const BRAND = {
  navy: '#04244C',          // Midnight Care — primary
  navyDeep: '#031A37',
  aqua: '#00B8FF',          // Pulse Blue — accent / CTA
  cream: '#F5F4EE',         // Pure Calm — body bg accent
  white: '#FFFFFF',
  ink: '#04244C',
  textBody: '#3A4A63',
  textMuted: '#6B7A91',
  textFooter: '#8A95A8',
  border: '#E2E6EE',
  success: '#00C853',
  pink: '#EB3774',
  logoUrl:
    'https://imewkweatgvqledptdna.supabase.co/storage/v1/object/public/email-assets/primecare-logo.jpg',
}

const serifStack =
  '"Tinos", "Times New Roman", Georgia, "Droid Serif", serif'
const sansStack =
  '"Roboto", -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif'

export const styles = {
  main: {
    backgroundColor: BRAND.cream,
    fontFamily: sansStack,
    margin: 0,
    padding: '32px 0',
  } as const,
  container: {
    backgroundColor: BRAND.white,
    borderRadius: '14px',
    border: `1px solid ${BRAND.border}`,
    boxShadow: '0 2px 8px rgba(4,36,76,0.06)',
    margin: '0 auto',
    maxWidth: '560px',
    padding: '0',
    overflow: 'hidden',
  } as const,
  header: {
    backgroundColor: BRAND.navy,
    padding: '24px 32px',
    textAlign: 'center' as const,
  },
  logo: {
    display: 'inline-block',
    height: '40px',
    width: 'auto',
    borderRadius: '6px',
  } as const,
  brandLine: {
    color: BRAND.white,
    fontFamily: serifStack,
    fontSize: '13px',
    letterSpacing: '0.18em',
    textTransform: 'uppercase' as const,
    margin: '10px 0 0',
  },
  body: {
    padding: '32px 36px 28px',
  } as const,
  h1: {
    fontFamily: serifStack,
    fontSize: '26px',
    fontWeight: 600 as const,
    color: BRAND.navy,
    lineHeight: '1.25',
    margin: '0 0 18px',
    letterSpacing: '-0.01em',
  },
  text: {
    fontFamily: sansStack,
    fontSize: '15px',
    color: BRAND.textBody,
    lineHeight: '1.6',
    margin: '0 0 18px',
  },
  textMuted: {
    fontFamily: sansStack,
    fontSize: '14px',
    color: BRAND.textMuted,
    lineHeight: '1.55',
    margin: '0 0 20px',
  },
  link: {
    color: BRAND.navy,
    textDecoration: 'underline',
    fontWeight: 500 as const,
  },
  button: {
    backgroundColor: BRAND.aqua,
    color: BRAND.navy,
    fontFamily: sansStack,
    fontSize: '15px',
    fontWeight: 700 as const,
    letterSpacing: '0.02em',
    borderRadius: '10px',
    padding: '14px 28px',
    textDecoration: 'none',
    display: 'inline-block',
  } as const,
  buttonWrap: {
    margin: '8px 0 28px',
  } as const,
  divider: {
    borderColor: BRAND.border,
    borderTop: `1px solid ${BRAND.border}`,
    margin: '24px 0 18px',
  } as const,
  footer: {
    fontFamily: sansStack,
    fontSize: '12px',
    color: BRAND.textFooter,
    lineHeight: '1.55',
    margin: '0',
  } as const,
  footerSection: {
    backgroundColor: BRAND.cream,
    padding: '18px 36px 24px',
    textAlign: 'center' as const,
  } as const,
  code: {
    fontFamily:
      '"Roboto Mono", "SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace',
    fontSize: '28px',
    fontWeight: 700 as const,
    color: BRAND.navy,
    backgroundColor: BRAND.cream,
    border: `1px solid ${BRAND.border}`,
    borderRadius: '10px',
    padding: '14px 20px',
    letterSpacing: '0.4em',
    textAlign: 'center' as const,
    margin: '0 0 24px',
    display: 'block',
  } as const,
}
