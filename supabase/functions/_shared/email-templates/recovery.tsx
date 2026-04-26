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
  Preview,
  Section,
  Text,
} from 'npm:@react-email/components@0.0.22'

import { BRAND, styles } from './_brand.ts'

interface RecoveryEmailProps {
  siteName: string
  confirmationUrl: string
}

export const RecoveryEmail = ({
  siteName,
  confirmationUrl,
}: RecoveryEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Reset your {siteName} password</Preview>
    <Body style={styles.main}>
      <Container style={styles.container}>
        <Section style={styles.header}>
          <Img src={BRAND.logoUrl} alt="Prime Care VIP" style={styles.logo} />
          <Text style={styles.brandLine}>Prime Care VIP · Admin</Text>
        </Section>
        <Section style={styles.body}>
          <Heading style={styles.h1}>Reset your password</Heading>
          <Text style={styles.text}>
            We received a request to reset the password on your {siteName}{' '}
            account. Click below to choose a new one.
          </Text>
          <Section style={styles.buttonWrap}>
            <Button style={styles.button} href={confirmationUrl}>
              Reset password
            </Button>
          </Section>
          <Text style={styles.textMuted}>
            For your security, this link expires shortly. After resetting,
            you'll need to sign in again on every device.
          </Text>
          <Hr style={styles.divider} />
          <Text style={styles.footer}>
            If you didn't request a password reset, you can safely ignore this
            email — your password will not change.
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

export default RecoveryEmail
