import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useCreateImportJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      url,
      providerId,
      hospitalName,
      hospitalAddress,
      hospitalCity,
      hospitalState,
      hospitalZip,
    }: {
      url: string;
      providerId: string | null;
      hospitalName?: string | null;
      hospitalAddress?: string | null;
      hospitalCity?: string | null;
      hospitalState?: string | null;
      hospitalZip?: string | null;
    }) => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      const { data: job, error } = await supabase
        .from("import_jobs")
        .insert({
          url,
          provider_id: providerId,
          status: "pending",
          created_by: user?.id ?? null,
          hospital_name: hospitalName || null,
          hospital_address: hospitalAddress || null,
          hospital_city: hospitalCity || null,
          hospital_state: hospitalState || null,
          hospital_zip: hospitalZip || null,
        })
        .select()
        .single();
      if (error) throw error;

      // Kick off the edge function (fire and forget)
      supabase.functions.invoke("import-pricing", {
        body: { job_id: job.id },
      });

      return job;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["estimator", "import_jobs"] });
    },
  });
}

export function useImportJob(jobId: string | null) {
  return useQuery({
    queryKey: ["estimator", "import_jobs", jobId],
    queryFn: async () => {
      if (!jobId) return null;
      const { data, error } = await supabase
        .from("import_jobs")
        .select("*")
        .eq("id", jobId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!jobId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status === "pending" || status === "processing") return 2000;
      return false;
    },
  });
}
