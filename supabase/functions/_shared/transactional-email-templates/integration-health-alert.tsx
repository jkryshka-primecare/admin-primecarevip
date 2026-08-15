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

interface Failure {
  integration?: string
  httpStatus?: number | null
  message?: string | null
}

interface IntegrationHealthAlertProps {
  checkedAt?: string
  failures?: Failure[]
}

const IntegrationHealthAlertEmail = ({
  checkedAt,
  failures = [],
}: IntegrationHealthAlertProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>
      {failures.length} integration check{failures.length === 1 ? '' : 's'} failed
    </Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>Integration health alert</Heading>
        <Text style={text}>
          The daily connection check for {SITE_NAME} found{' '}
          {failures.length} failing integration
          {failures.length === 1 ? '' : 's'}.
        </Text>

        {failures.map((f, i) => (
          <Section key={i} style={card}>
            <Text style={cardLabel}>Integration</Text>
            <Text style={cardValue}>{f.integration ?? 'Unknown'}</Text>
            <Text style={cardLabel}>HTTP status</Text>
            <Text style={cardValue}>{f.httpStatus ?? '—'}</Text>
            <Text style={cardLabel}>Details</Text>
            <Text style={cardValue}>{f.message ?? 'No details returned.'}</Text>
          </Section>
        ))}

        <Text style={text}>
          Open Administration &rarr; Integrations &rarr; Connection health to
          re-run the checks after fixing the credentials.
        </Text>

        <Text style={footer}>
          Checked at {checkedAt ?? 'unknown time'} — {SITE_NAME} OS
        </Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: IntegrationHealthAlertEmail,
  subject: (data: Record<string, any>) =>
    `Integration alert: ${data?.failures?.length ?? 0} connection${
      (data?.failures?.length ?? 0) === 1 ? '' : 's'
    } failing`,
  displayName: 'Integration health alert',
  previewData: {
    checkedAt: '2026-08-15T14:00:00Z',
    failures: [
      {
        integration: 'Hint — practice scope',
        httpStatus: 401,
        message: 'Hint rejected the saved API key.',
      },
    ],
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
  margin: '20px 0',
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
