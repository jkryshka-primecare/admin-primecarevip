import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Fetches the total price per provider for a given service,
 * by summing service_prices grouped by provider_id.
 */
export function useProviderTotals(serviceId: string, providerIds: string[]) {
  return useQuery({
    queryKey: ["estimator", "provider_totals", serviceId, providerIds],
    enabled: providerIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("service_prices")
        .select("provider_id, price")
        .eq("service_id", serviceId)
        .in("provider_id", providerIds);
      if (error) throw error;

      const totals: Record<string, number> = {};
      for (const row of data) {
        totals[row.provider_id] = (totals[row.provider_id] || 0) + Number(row.price);
      }
      return totals;
    },
  });
}
