/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'

import {
  Body,
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

interface ReauthenticationEmailProps {
  token: string
}

export const ReauthenticationEmail = ({ token }: ReauthenticationEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Your Prime Care VIP verification code</Preview>
    <Body style={styles.main}>
      <Container style={styles.container}>
        <Section style={styles.header}>
          <Img src={BRAND.logoUrl} alt="Prime Care VIP" style={styles.logo} />
          <Text style={styles.brandLine}>Prime Care VIP · Admin</Text>
        </Section>
        <Section style={styles.body}>
          <Heading style={styles.h1}>Verify it's you</Heading>
          <Text style={styles.text}>
            Use this one-time code to confirm your identity:
          </Text>
          <Text style={styles.code}>{token}</Text>
          <Hr style={styles.divider} />
          <Text style={styles.footer}>
            This code expires shortly. If you didn't request it, you can
            safely ignore this email.
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

export default ReauthenticationEmail
