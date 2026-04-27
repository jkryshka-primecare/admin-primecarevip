import * as React from 'npm:react@18.3.1'
import {
  Body,
  Button,
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

type Stage =
  | 'in_progress'      // reviewer should start
  | 'employee_review'  // employee should review/comment
  | 'completed'        // review finalized

interface PerformanceReviewStatusProps {
  recipientName?: string
  cycleName?: string
  employeeName?: string
  reviewerName?: string
  newStatus?: Stage
  appUrl?: string
  overallRating?: number | null
}

const HEADLINES: Record<Stage, string> = {
  in_progress: 'A performance review is ready for you to start',
  employee_review: 'Your performance review is ready for your input',
  completed: 'Your performance review has been completed',
}

const BODIES: Record<Stage, (p: PerformanceReviewStatusProps) => string> = {
  in_progress: (p) =>
    `The ${p.cycleName ?? 'current'} review cycle is active. You've been assigned to review ${
      p.employeeName ?? 'an employee'
    }. Please open the review to add ratings, strengths, and goals.`,
  employee_review: (p) =>
    `${p.reviewerName ?? 'Your manager'} has finished writing your ${
      p.cycleName ?? 'performance'
    } review. Please open it to read the feedback and add your own comments before it's finalized.`,
  completed: (p) =>
    `Your ${p.cycleName ?? 'performance'} review has been finalized${
      p.reviewerName ? ` by ${p.reviewerName}` : ''
    }. You can revisit it any time from your HR dashboard.`,
}

const PerformanceReviewStatusEmail = ({
  recipientName,
  cycleName,
  employeeName,
  reviewerName,
  newStatus = 'in_progress',
  appUrl,
  overallRating,
}: PerformanceReviewStatusProps) => {
  const headline = HEADLINES[newStatus] ?? HEADLINES.in_progress
  const body = (BODIES[newStatus] ?? BODIES.in_progress)({
    recipientName,
    cycleName,
    employeeName,
    reviewerName,
    newStatus,
  })

  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>{headline}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>{headline}</Heading>
          <Text style={text}>Hi {recipientName ?? 'there'},</Text>
          <Text style={text}>{body}</Text>

          <Section style={card}>
            <Text style={cardLabel}>Cycle</Text>
            <Text style={cardValue}>{cycleName ?? '—'}</Text>

            <Text style={cardLabel}>Employee</Text>
            <Text style={cardValue}>{employeeName ?? '—'}</Text>

            {reviewerName && (
              <>
                <Text style={cardLabel}>Reviewer</Text>
                <Text style={cardValue}>{reviewerName}</Text>
              </>
            )}

            {newStatus === 'completed' && typeof overallRating === 'number' && (
              <>
                <Text style={cardLabel}>Overall rating</Text>
                <Text style={cardValue}>{overallRating.toFixed(1)} / 5</Text>
              </>
            )}
          </Section>

          {appUrl && (
            <Section style={{ textAlign: 'center', margin: '28px 0 8px' }}>
              <Button href={appUrl} style={button}>
                Open review
              </Button>
            </Section>
          )}

          <Text style={footer}>— The {SITE_NAME} HR Team</Text>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: PerformanceReviewStatusEmail,
  subject: (data: Record<string, any>) => {
    const stage = data?.newStatus as Stage | undefined
    const cycle = data?.cycleName ? ` — ${data.cycleName}` : ''
    if (stage === 'employee_review') return `Your review is ready for your input${cycle}`
    if (stage === 'completed') return `Your performance review is complete${cycle}`
    return `Performance review assigned to you${cycle}`
  },
  displayName: 'Performance review status update',
  previewData: {
    recipientName: 'Jane Doe',
    cycleName: 'Q2 2026 Reviews',
    employeeName: 'Sam Patel',
    reviewerName: 'Jane Doe',
    newStatus: 'in_progress',
    appUrl: 'https://admin.primecarevip.com/hr/performance',
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
const button = {
  backgroundColor: '#00B8FF',
  color: '#ffffff',
  fontSize: '14px',
  fontWeight: 600 as const,
  padding: '12px 24px',
  borderRadius: '6px',
  textDecoration: 'none',
  display: 'inline-block',
}
const footer = { fontSize: '13px', color: '#6b7280', margin: '32px 0 0' }
