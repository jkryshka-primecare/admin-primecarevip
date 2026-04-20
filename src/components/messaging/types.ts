export type MessagingChannel = "chat" | "sms" | "voice" | "voicemail";

export interface MessageThread {
  id: string;
  patientId: string;
  patientName: string;
  channel: MessagingChannel;
  /** ISO timestamp when patient message / call arrived */
  receivedAt: string;
  /** Minutes until first staff response. null = unanswered */
  responseMinutes: number | null;
  /** Subject / first line preview */
  subject: string;
  responder?: string;
  /** Derived: this arrived inside the weekend window (Fri 6pm → Mon 8am) */
  isWeekend: boolean;
  /** Derived: true if responseMinutes is within SLA for that period */
  withinSla: boolean;
}

export interface MessagingDrilldownContext {
  title: string;
  description: string;
  metric: string;
  threads: MessageThread[];
  /** Show tabs (patients + threads). Defaults true. */
  defaultTab?: "patients" | "threads";
}
