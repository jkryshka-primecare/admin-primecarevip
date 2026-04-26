import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useSpecialties() {
  return useQuery({
    queryKey: ["estimator", "specialties"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("specialties")
        .select("*")
        .order("name");
      if (error) throw error;
      return data;
    },
  });
}

export function useProviders(specialtyId: string, locationFilter?: string) {
  return useQuery({
    queryKey: ["estimator", "providers", specialtyId, locationFilter],
    queryFn: async () => {
      let query = supabase.from("providers").select("*");
      if (specialtyId !== "all") {
        query = query.eq("specialty_id", specialtyId);
      }
      const { data, error } = await query.order("distance", {
        ascending: true,
        nullsFirst: false,
      });
      if (error) throw error;

      if (!locationFilter?.trim()) return data;
      const q = locationFilter.toLowerCase();
      return data.filter(
        (p) =>
          p.city.toLowerCase().includes(q) ||
          p.state.toLowerCase().includes(q) ||
          (p.zip && p.zip.includes(q)) ||
          (p.address && p.address.toLowerCase().includes(q))
      );
    },
  });
}

export function useNhsnCategories() {
  return useQuery({
    queryKey: ["estimator", "nhsn-categories"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cpt_codes")
        .select("category")
        .order("category");
      if (error) throw error;
      const unique = Array.from(new Set((data ?? []).map((r) => r.category)));
      return unique;
    },
  });
}

export function useServices(
  specialtyId: string,
  searchQuery: string,
  providerSearch: string = "",
  nhsnCategory: string = ""
) {
  const trimmed = searchQuery.trim();
  const provTrimmed = providerSearch.trim();
  const nhsnTrimmed = nhsnCategory.trim();
  const hasProviderFilter = provTrimmed.length > 0;
  const hasNhsnFilter = nhsnTrimmed.length > 0;
  const enabled = trimmed.length >= 3 || hasProviderFilter || hasNhsnFilter;

  return useQuery({
    queryKey: ["estimator", "services", specialtyId, trimmed, provTrimmed, nhsnTrimmed],
    enabled,
    queryFn: async () => {
      let providerIds: string[] | null = null;
      if (hasProviderFilter) {
        const pq = provTrimmed.toLowerCase();
        const { data: providers, error: pErr } = await supabase
          .from("providers")
          .select("id")
          .ilike("name", `%${pq}%`);
        if (pErr) throw pErr;
        providerIds = providers.map((p) => p.id);
        if (providerIds.length === 0) return [];
      }

      let serviceIdFilter: string[] | null = null;
      if (providerIds) {
        const { data: sp, error: spErr } = await supabase
          .from("service_prices")
          .select("service_id")
          .in("provider_id", providerIds);
        if (spErr) throw spErr;
        serviceIdFilter = [...new Set(sp.map((r) => r.service_id))];
        if (serviceIdFilter.length === 0) return [];
      }

      let query = supabase.from("services").select("*");
      if (specialtyId !== "all") query = query.eq("specialty_id", specialtyId);
      if (serviceIdFilter) query = query.in("id", serviceIdFilter.slice(0, 200));
      if (hasNhsnFilter) query = query.eq("nhsn_category", nhsnTrimmed);

      if (trimmed.length >= 3) {
        const q = trimmed.toLowerCase();
        query = query.or(`name.ilike.%${q}%,description.ilike.%${q}%,id.ilike.%${q}%,cpt_code.ilike.%${q.toUpperCase()}%`);
      }

      const { data, error } = await query.order("name").limit(50);
      if (error) throw error;

      if (trimmed.length >= 3) {
        const q = trimmed.toLowerCase();
        let icdQuery = supabase.from("services").select("*").contains("icd10_codes", [q]);
        if (specialtyId !== "all") icdQuery = icdQuery.eq("specialty_id", specialtyId);
        if (serviceIdFilter) icdQuery = icdQuery.in("id", serviceIdFilter.slice(0, 200));
        if (hasNhsnFilter) icdQuery = icdQuery.eq("nhsn_category", nhsnTrimmed);
        const { data: icdData, error: icdError } = await icdQuery.limit(50);
        if (icdError) throw icdError;

        const merged = new Map<string, (typeof data)[0]>();
        for (const s of data) merged.set(s.id, s);
        for (const s of icdData) merged.set(s.id, s);
        const results = Array.from(merged.values());
        results.sort((a, b) => a.name.localeCompare(b.name));
        return results.slice(0, 50);
      }

      return data;
    },
  });
}

export function useServicePrices(providerId: string, serviceId: string) {
  return useQuery({
    queryKey: ["estimator", "service_prices", providerId, serviceId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("service_prices")
        .select("*")
        .eq("provider_id", providerId)
        .eq("service_id", serviceId)
        .order("price", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}

export function useUpdateServicePrice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      price,
      providerId,
      serviceId,
      component,
      oldPrice,
      changedByName,
    }: {
      id: string;
      price: number;
      providerId: string;
      serviceId: string;
      component: string;
      oldPrice: number;
      changedByName: string | null;
    }) => {
      const { error } = await supabase
        .from("service_prices")
        .update({ price })
        .eq("id", id);
      if (error) throw error;

      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { error: auditError } = await supabase.from("price_audit_log").insert({
        service_price_id: id,
        provider_id: providerId,
        service_id: serviceId,
        component,
        old_price: oldPrice,
        new_price: price,
        changed_by: user?.id ?? null,
        changed_by_name: changedByName,
      });
      if (auditError) console.error("Audit log error:", auditError);
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["estimator", "service_prices", variables.providerId, variables.serviceId],
      });
      queryClient.invalidateQueries({ queryKey: ["estimator", "price_audit_log"] });
    },
  });
}

export function usePriceAuditLog(limit = 50) {
  return useQuery({
    queryKey: ["estimator", "price_audit_log", limit],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("price_audit_log")
        .select("*")
        .order("changed_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return data;
    },
  });
}
