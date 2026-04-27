import * as React from 'npm:react@18.3.1'
import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Section,
  Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = 'Prime Care VIP'

interface LicenseExpirationAlertProps {
  employeeName?: string
  certificationName?: string
  expirationDate?: string
  daysRemaining?: number
  issuingAuthority?: string
}

const LicenseExpirationAlertEmail = ({
  employeeName,
  certificationName,
  expirationDate,
  daysRemaining,
  issuingAuthority,
}: LicenseExpirationAlertProps) => {
  const urgent = typeof daysRemaining === 'number' && daysRemaining <= 14
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>
        {certificationName ?? 'Your certification'} expires
        {typeof daysRemaining === 'number' ? ` in ${daysRemaining} days` : ' soon'}
      </Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>
            {urgent ? 'Action required: ' : ''}Certification expiring soon
          </Heading>
          <Text style={text}>
            Hi {employeeName ?? 'there'},
          </Text>
          <Text style={text}>
            This is a reminder from the {SITE_NAME} HR team that your
            credential is approaching its expiration date.
          </Text>

          <Section style={card}>
            <Text style={cardLabel}>Certification</Text>
            <Text style={cardValue}>{certificationName ?? 'Credential'}</Text>

            {issuingAuthority && (
              <>
                <Text style={cardLabel}>Issuing authority</Text>
                <Text style={cardValue}>{issuingAuthority}</Text>
              </>
            )}

            <Text style={cardLabel}>Expiration date</Text>
            <Text style={cardValue}>{expirationDate ?? '—'}</Text>

            {typeof daysRemaining === 'number' && (
              <>
                <Text style={cardLabel}>Days remaining</Text>
                <Text style={{ ...cardValue, color: urgent ? '#EB3774' : '#04244C' }}>
                  {daysRemaining}
                </Text>
              </>
            )}
          </Section>

          <Text style={text}>
            Please coordinate with HR to renew this credential before the
            expiration date to remain compliant.
          </Text>

          <Text style={footer}>— The {SITE_NAME} HR Team</Text>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: LicenseExpirationAlertEmail,
  subject: (data: Record<string, any>) =>
    `Certification expiring${
      typeof data?.daysRemaining === 'number' ? ` in ${data.daysRemaining} days` : ' soon'
    }: ${data?.certificationName ?? 'credential'}`,
  displayName: 'License expiration alert',
  previewData: {
    employeeName: 'Jane Doe',
    certificationName: 'RN License',
    expirationDate: '2026-06-15',
    daysRemaining: 30,
    issuingAuthority: 'Texas Board of Nursing',
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Roboto, Arial, sans-serif' }
const container = { padding: '32px 28px', maxWidth: '560px', margin: '0 auto' }
const h1 = {
  fontFamily: 'Tinos, Georgia, serif',
  fontSize: '24px',
  fontWeight: 'bold',
  color: '#04244C',
  margin: '0 0 20px',
}
const text = { fontSize: '15px', color: '#1a1a1a', lineHeight: '1.6', margin: '0 0 16px' }
const card = {
  backgroundColor: '#F5F4EE',
  borderRadius: '8px',
  padding: '20px 24px',
  margin: '24px 0',
}
const cardLabel = {
  fontSize: '11px',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.05em',
  color: '#6b7280',
  margin: '12px 0 4px',
}
const cardValue = {
  fontSize: '15px',
  color: '#04244C',
  fontWeight: 600 as const,
  margin: '0',
}
const footer = { fontSize: '13px', color: '#6b7280', margin: '32px 0 0' }
