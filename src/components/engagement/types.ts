export interface EngagementPatient {
  id: string;
  name: string;
  employer: string;
  physician: string;
  lastEncounter: string;
  encounters: number;
  rxOrders: number;
  messages: number;
  afterHours: boolean;
  digital: boolean;
  flag?: string;
}

export interface DrilldownContext {
  title: string;
  description: string;
  metric: string;
  /** Pre-filtered list of patients to show in the drawer */
  patients: EngagementPatient[];
}
