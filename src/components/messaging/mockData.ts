import type { MessageThread, MessagingChannel } from "./types";

/** Weekend SLA window: Fri 6pm → Mon 8am (local). */
export const isWeekendWindow = (iso: string): boolean => {
  const d = new Date(iso);
  const day = d.getDay(); // 0 Sun .. 6 Sat
  const hour = d.getHours();
  if (day === 6) return true; // Saturday
  if (day === 0) return true; // Sunday
  if (day === 5 && hour >= 18) return true; // Fri 6pm+
  if (day === 1 && hour < 8) return true; // Mon before 8am
  return false;
};

export const WEEKDAY_SLA_MIN = 5;
export const WEEKEND_SLA_MIN = 15; // upper bound of 10–15 band
export const WEEKEND_SLA_BAND: [number, number] = [10, 15];

const checkSla = (mins: number | null, weekend: boolean): boolean => {
  if (mins === null) return false;
  return mins <= (weekend ? WEEKEND_SLA_MIN : WEEKDAY_SLA_MIN);
};

interface RawThread {
  id: string;
  patientId: string;
  patientName: string;
  channel: MessagingChannel;
  receivedAt: string;
  responseMinutes: number | null;
  subject: string;
  responder?: string;
}

const raw: RawThread[] = [
  // ===== Weekday chat (mostly within 5 min) =====
  { id: "T-1001", patientId: "VIP-9942-A", patientName: "Ryan Spam",          channel: "chat",      receivedAt: "2026-04-15T09:12:00", responseMinutes: 2,  subject: "Refill question — lisinopril",      responder: "Dr. Patel" },
  { id: "T-1002", patientId: "VIP-8210-C", patientName: "Marisol Beltran",    channel: "chat",      receivedAt: "2026-04-15T10:48:00", responseMinutes: 3,  subject: "Lab result follow-up",              responder: "Dr. Cho" },
  { id: "T-1003", patientId: "VIP-1104-E", patientName: "Wendell Park",       channel: "chat",      receivedAt: "2026-04-15T13:20:00", responseMinutes: 9,  subject: "Side effect from new med",          responder: "Nurse Adler" },
  { id: "T-1004", patientId: "VIP-7732-G", patientName: "Diego Alvarez",      channel: "chat",      receivedAt: "2026-04-16T08:30:00", responseMinutes: 1,  subject: "Booking annual physical",           responder: "Front Desk" },
  { id: "T-1005", patientId: "VIP-5511-K", patientName: "Theodore Lin",       channel: "chat",      receivedAt: "2026-04-16T14:05:00", responseMinutes: 4,  subject: "Insurance card update",             responder: "Front Desk" },
  { id: "T-1006", patientId: "VIP-3320-N", patientName: "Camille Devereux",   channel: "chat",      receivedAt: "2026-04-17T11:11:00", responseMinutes: 6,  subject: "Headache — should I come in?",      responder: "Dr. Cho" },
  { id: "T-1007", patientId: "VIP-9081-L", patientName: "Selene Carrasco",    channel: "chat",      receivedAt: "2026-04-17T15:42:00", responseMinutes: 2,  subject: "Glucose readings this week",        responder: "Dr. Patel" },

  // ===== Weekday SMS =====
  { id: "T-1101", patientId: "HH-3382-B",  patientName: "Anita Torres",       channel: "sms",       receivedAt: "2026-04-15T16:05:00", responseMinutes: 3,  subject: "Confirming my appt tomorrow",       responder: "Front Desk" },
  { id: "T-1102", patientId: "HH-4501-D",  patientName: "Jordan Mahoney",     channel: "sms",       receivedAt: "2026-04-16T09:50:00", responseMinutes: 7,  subject: "Need referral note",                responder: "Nurse Adler" },
  { id: "T-1103", patientId: "VIP-6620-F", patientName: "Priya Ramachandran", channel: "sms",       receivedAt: "2026-04-16T12:33:00", responseMinutes: 4,  subject: "Pharmacy didn't receive Rx",        responder: "Dr. Cho" },
  { id: "T-1104", patientId: "HH-2210-J",  patientName: "Faith Okonkwo",      channel: "sms",       receivedAt: "2026-04-17T10:15:00", responseMinutes: 12, subject: "Question about copay",              responder: "Billing" },

  // ===== Weekday voice =====
  { id: "T-1201", patientId: "VIP-9942-A", patientName: "Ryan Spam",          channel: "voice",     receivedAt: "2026-04-15T11:00:00", responseMinutes: 0,  subject: "Inbound call — answered live",      responder: "Front Desk" },
  { id: "T-1202", patientId: "VIP-1180-P", patientName: "Rashid El-Amin",     channel: "voice",     receivedAt: "2026-04-16T13:45:00", responseMinutes: 0,  subject: "Inbound call — answered live",      responder: "Nurse Adler" },
  { id: "T-1203", patientId: "VIP-5511-K", patientName: "Theodore Lin",       channel: "voice",     receivedAt: "2026-04-17T09:20:00", responseMinutes: 0,  subject: "Inbound call — answered live",      responder: "Front Desk" },

  // ===== Weekday voicemail callbacks =====
  { id: "T-1301", patientId: "HH-9912-Q",  patientName: "Margot Sinclair",    channel: "voicemail", receivedAt: "2026-04-15T08:02:00", responseMinutes: 4,  subject: "VM — needs medication clarification", responder: "Nurse Adler" },
  { id: "T-1302", patientId: "VIP-7732-G", patientName: "Diego Alvarez",      channel: "voicemail", receivedAt: "2026-04-16T07:55:00", responseMinutes: 18, subject: "VM — wants to reschedule",         responder: "Front Desk" },
  { id: "T-1303", patientId: "VIP-3320-N", patientName: "Camille Devereux",   channel: "voicemail", receivedAt: "2026-04-17T17:30:00", responseMinutes: 9,  subject: "VM — billing question",            responder: "Billing" },

  // ===== Weekend (Fri 6pm → Mon 8am) =====
  { id: "T-2001", patientId: "VIP-9942-A", patientName: "Ryan Spam",          channel: "chat",      receivedAt: "2026-04-10T19:30:00", responseMinutes: 11, subject: "Sore throat — go to ER?",          responder: "On-call Dr. Singh" }, // Fri evening
  { id: "T-2002", patientId: "HH-3382-B",  patientName: "Anita Torres",       channel: "sms",       receivedAt: "2026-04-11T10:12:00", responseMinutes: 13, subject: "Child has fever",                  responder: "On-call Dr. Singh" }, // Sat
  { id: "T-2003", patientId: "VIP-6620-F", patientName: "Priya Ramachandran", channel: "chat",      receivedAt: "2026-04-11T22:40:00", responseMinutes: 14, subject: "Chest tightness",                  responder: "On-call Dr. Singh" }, // Sat night
  { id: "T-2004", patientId: "VIP-9081-L", patientName: "Selene Carrasco",    channel: "voice",     receivedAt: "2026-04-12T09:05:00", responseMinutes: 0,  subject: "Inbound call — answered live",     responder: "On-call Dr. Singh" }, // Sun
  { id: "T-2005", patientId: "VIP-7732-G", patientName: "Diego Alvarez",      channel: "voicemail", receivedAt: "2026-04-12T14:20:00", responseMinutes: 22, subject: "VM — Rx ran out",                  responder: "On-call Nurse" }, // Sun, breach
  { id: "T-2006", patientId: "HH-7741-M",  patientName: "Bennett Hayes",      channel: "sms",       receivedAt: "2026-04-13T06:40:00", responseMinutes: 12, subject: "Back pain after fall",             responder: "On-call Dr. Singh" }, // Mon early
  { id: "T-2007", patientId: "VIP-1104-E", patientName: "Wendell Park",       channel: "chat",      receivedAt: "2026-04-11T15:00:00", responseMinutes: 9,  subject: "Cough getting worse",              responder: "On-call Dr. Singh" },
  { id: "T-2008", patientId: "VIP-5511-K", patientName: "Theodore Lin",       channel: "chat",      receivedAt: "2026-04-12T11:25:00", responseMinutes: 28, subject: "Migraine, no response to meds",    responder: "On-call Dr. Singh" }, // breach

  // A few unanswered (drives outstanding count)
  { id: "T-3001", patientId: "HH-4501-D",  patientName: "Jordan Mahoney",     channel: "chat",      receivedAt: "2026-04-17T22:10:00", responseMinutes: null, subject: "Need clarification on lab" },
  { id: "T-3002", patientId: "VIP-1180-P", patientName: "Rashid El-Amin",     channel: "voicemail", receivedAt: "2026-04-17T23:05:00", responseMinutes: null, subject: "VM — left message" },
];

export const messageThreads: MessageThread[] = raw.map((t) => {
  const weekend = isWeekendWindow(t.receivedAt);
  return {
    ...t,
    isWeekend: weekend,
    withinSla: checkSla(t.responseMinutes, weekend),
  };
});

export const channelLabel: Record<MessagingChannel, string> = {
  chat: "Chat",
  sms: "SMS",
  voice: "Phone",
  voicemail: "Voicemail",
};

export const formatResponse = (mins: number | null, channel: MessagingChannel): string => {
  if (mins === null) return "Unanswered";
  if (channel === "voice" && mins === 0) return "Live answer";
  if (mins < 1) return "<1 min";
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${m}m`;
};

export const avgResponseMin = (threads: MessageThread[]): number => {
  const answered = threads.filter((t) => t.responseMinutes !== null && !(t.channel === "voice" && t.responseMinutes === 0));
  if (answered.length === 0) return 0;
  return answered.reduce((a, t) => a + (t.responseMinutes ?? 0), 0) / answered.length;
};

export const slaRate = (threads: MessageThread[]): number => {
  const answered = threads.filter((t) => t.responseMinutes !== null);
  if (answered.length === 0) return 0;
  return (answered.filter((t) => t.withinSla).length / answered.length) * 100;
};
