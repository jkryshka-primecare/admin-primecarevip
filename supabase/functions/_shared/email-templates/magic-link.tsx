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

interface MagicLinkEmailProps {
  siteName: string
  confirmationUrl: string
}

export const MagicLinkEmail = ({
  siteName,
  confirmationUrl,
}: MagicLinkEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Your sign-in link for {siteName}</Preview>
    <Body style={styles.main}>
      <Container style={styles.container}>
        <Section style={styles.header}>
          <Img src={BRAND.logoUrl} alt="Prime Care VIP" style={styles.logo} />
          <Text style={styles.brandLine}>Prime Care VIP · Admin</Text>
        </Section>
        <Section style={styles.body}>
          <Heading style={styles.h1}>Sign in to {siteName}</Heading>
          <Text style={styles.text}>
            Click the button below to sign in. This link is single-use and
            will expire shortly.
          </Text>
          <Section style={styles.buttonWrap}>
            <Button style={styles.button} href={confirmationUrl}>
              Sign in
            </Button>
          </Section>
          <Hr style={styles.divider} />
          <Text style={styles.footer}>
            If you didn't request this link, you can safely ignore this email.
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

export default MagicLinkEmail
