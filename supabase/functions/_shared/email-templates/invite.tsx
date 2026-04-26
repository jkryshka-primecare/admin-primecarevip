/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'

import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
} from 'npm:@react-email/components@0.0.22'

import { BRAND, styles } from './_brand.ts'

interface InviteEmailProps {
  siteName: string
  siteUrl: string
  confirmationUrl: string
}

export const InviteEmail = ({
  siteName,
  siteUrl,
  confirmationUrl,
}: InviteEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>You've been invited to {siteName}</Preview>
    <Body style={styles.main}>
      <Container style={styles.container}>
        <Section style={styles.header}>
          <Img src={BRAND.logoUrl} alt="Prime Care VIP" style={styles.logo} />
          <Text style={styles.brandLine}>Prime Care VIP · Admin</Text>
        </Section>
        <Section style={styles.body}>
          <Heading style={styles.h1}>You're invited</Heading>
          <Text style={styles.text}>
            A Prime Care VIP administrator has invited you to join{' '}
            <Link href={siteUrl} style={styles.link}>
              <strong>{siteName}</strong>
            </Link>
            {' '}— our internal operations console for clinical, pharmacy, and
            practice teams.
          </Text>
          <Section style={styles.buttonWrap}>
            <Button style={styles.button} href={confirmationUrl}>
              Accept invitation
            </Button>
          </Section>
          <Text style={styles.textMuted}>
            This link is unique to you and expires after first use. By
            accepting, you'll be granted the role assigned to you and gain
            access to PHI — all activity is logged for HIPAA compliance.
          </Text>
          <Hr style={styles.divider} />
          <Text style={styles.footer}>
            If you weren't expecting this invitation, you can safely ignore
            this email — no account will be created.
          </Text>
        </Section>
        <Section style={styles.footerSection}>
          <Text style={styles.footer}>
            Prime Care VIP · Concierge primary care for Texas
          </Text>
        </Section>
      </Container>
    </Body>
  </Html>
)

export default InviteEmail
