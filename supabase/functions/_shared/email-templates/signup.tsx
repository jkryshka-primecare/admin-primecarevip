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

interface SignupEmailProps {
  siteName: string
  siteUrl: string
  recipient: string
  confirmationUrl: string
}

export const SignupEmail = ({
  siteName,
  siteUrl,
  recipient,
  confirmationUrl,
}: SignupEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Confirm your email to access {siteName}</Preview>
    <Body style={styles.main}>
      <Container style={styles.container}>
        <Section style={styles.header}>
          <Img src={BRAND.logoUrl} alt="Prime Care VIP" style={styles.logo} />
          <Text style={styles.brandLine}>Prime Care VIP · Admin</Text>
        </Section>
        <Section style={styles.body}>
          <Heading style={styles.h1}>Confirm your email</Heading>
          <Text style={styles.text}>
            Welcome to{' '}
            <Link href={siteUrl} style={styles.link}>
              {siteName}
            </Link>
            . Please confirm <strong>{recipient}</strong> to activate your
            account.
          </Text>
          <Section style={styles.buttonWrap}>
            <Button style={styles.button} href={confirmationUrl}>
              Confirm email
            </Button>
          </Section>
          <Text style={styles.textMuted}>
            New accounts are reviewed by an administrator before being granted
            access to patient data. You'll be notified once your role is
            assigned.
          </Text>
          <Hr style={styles.divider} />
          <Text style={styles.footer}>
            If you didn't create an account, you can safely ignore this email.
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

export default SignupEmail
