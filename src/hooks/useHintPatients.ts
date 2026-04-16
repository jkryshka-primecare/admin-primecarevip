import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { HintResponse } from "@/components/hint-sandbox/types";

export type HintPatient = {
  id: string;
  name?: string;
  first_name?: string;
  last_name?: string;
};

export type HintPatientsResult = {
  patients: HintPatient[];
  total: number | null;
  raw: HintResponse | null;
};

const PATIENTS_LIMIT = 100;

/**
 * Cached fetch of the Hint patients list (practice scope, first 100).
 * Shared between MedicationStats and any other consumer so navigating
 * between views doesn't refetch.
 */
export function useHintPatients() {
  return useQuery<HintPatientsResult>({
    queryKey: ["hint", "patients", "list", { scope: "practice", limit: PATIENTS_LIMIT, offset: 0 }],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke<HintResponse>("hint-sandbox", {
        body: {
          resource: "patients",
          scope: "practice",
          method: "GET",
          query: { limit: PATIENTS_LIMIT, offset: 0 },
        },
      });
      if (error) throw error;
      if (!data) throw new Error("Empty response from Hint sandbox");
      const patients: HintPatient[] = Array.isArray(data.data) ? (data.data as HintPatient[]) : [];
      return {
        patients,
        total: data.pagination?.total ?? null,
        raw: data,
      };
    },
    staleTime: 5 * 60 * 1000, // 5 minutes — patient list rarely changes mid-session
    gcTime: 30 * 60 * 1000,
  });
}

/**
 * Cached fetch of a single Hint patient's detail. Reopening the same
 * patient drawer is instant after the first fetch.
 */
export function useHintPatientDetail(patientId: string | null) {
  return useQuery<HintResponse>({
    queryKey: ["hint", "patients", "detail", patientId],
    queryFn: async () => {
      if (!patientId) throw new Error("No patient id");
      const { data, error } = await supabase.functions.invoke<HintResponse>("hint-sandbox", {
        body: { resource: "patients", id: patientId, scope: "practice", method: "GET" },
      });
      if (error) throw error;
      if (!data) throw new Error("Empty response from Hint sandbox");
      return data;
    },
    enabled: !!patientId,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });
}
