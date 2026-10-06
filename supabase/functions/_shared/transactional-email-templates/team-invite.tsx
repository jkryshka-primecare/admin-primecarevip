import * as React from 'npm:react@18.3.1'
import {
  Body, Button, Container, Head, Heading, Html, Img, Preview, Section, Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

interface Props {
  firstName?: string
  inviteUrl?: string
  roleLabel?: string
  invitedBy?: string
}

const LOGO = 'https://imewkweatgvqledptdna.supabase.co/storage/v1/object/public/email-assets/primecare-logo.jpg'

const TeamInviteEmail = ({ firstName, inviteUrl, roleLabel, invitedBy }: Props) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>You've been invited to PrimeCare OS</Preview>
    <Body style={main}>
      <Container style={container}>
        <Section style={header}>
          <Img src={LOGO} alt="Prime Care VIP" style={logo} />
        </Section>
        <Section style={content}>
          <Heading style={h1}>You're invited to PrimeCare OS</Heading>
          <Text style={text}>Hi {firstName || 'there'},</Text>
          <Text style={text}>
            {invitedBy ? `${invitedBy} has` : 'A Prime Care VIP administrator has'} invited you to
            PrimeCare OS, our internal operations console
            {roleLabel ? `, with ${roleLabel} access` : ''}.
          </Text>
          {inviteUrl && (
            <Section style={{ textAlign: 'center', margin: '28px 0' }}>
              <Button style={button} href={inviteUrl}>Accept invitation</Button>
            </Section>
          )}
          <Text style={muted}>
            This link is just for you and works once. Patient information in PrimeCare OS is
            protected under HIPAA, and all activity is logged.
          </Text>
          <Text style={muted}>If you weren't expecting this, you can ignore this email.</Text>
        </Section>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: TeamInviteEmail,
  subject: "You're invited to PrimeCare OS",
  displayName: 'Team invitation',
  previewData: { firstName: 'Jane', inviteUrl: 'https://admin.primecarevip.com/auth?invite=example', roleLabel: 'clinical', invitedBy: 'Lainey Kieffer' },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Roboto, Helvetica, Arial, sans-serif' }
const container = { maxWidth: '560px', margin: '0 auto', border: '1px solid #E2E6EE', borderRadius: '14px', overflow: 'hidden' }
const header = { backgroundColor: '#04244C', padding: '24px 32px', textAlign: 'center' as const }
const logo = { display: 'inline-block', height: '40px', width: 'auto', borderRadius: '6px' }
const content = { padding: '28px 32px' }
const h1 = { color: '#04244C', fontFamily: 'Tinos, Georgia, serif', fontSize: '24px', margin: '0 0 16px' }
const text = { color: '#3A4A63', fontSize: '15px', lineHeight: '1.6', margin: '0 0 14px' }
const muted = { color: '#6B7A91', fontSize: '13px', lineHeight: '1.6', margin: '0 0 10px' }
const button = { backgroundColor: '#00B8FF', color: '#04244C', fontWeight: 'bold', fontSize: '15px', padding: '12px 24px', borderRadius: '10px', textDecoration: 'none' }
