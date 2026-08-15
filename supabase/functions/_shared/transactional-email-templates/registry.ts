/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'

export interface TemplateEntry {
  component: React.ComponentType<any>
  subject: string | ((data: Record<string, any>) => string)
  to?: string
  displayName?: string
  previewData?: Record<string, any>
}

import { template as licenseExpirationAlert } from './license-expiration-alert.tsx'
import { template as performanceReviewStatus } from './performance-review-status.tsx'
import { template as integrationHealthAlert } from './integration-health-alert.tsx'

export const TEMPLATES: Record<string, TemplateEntry> = {
  'license-expiration-alert': licenseExpirationAlert,
  'performance-review-status': performanceReviewStatus,
  'integration-health-alert': integrationHealthAlert,
}

