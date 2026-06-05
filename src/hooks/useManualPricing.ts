import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface ManualPricingRow {
  cptCode: string;
  serviceName: string;
  component: string;
  price: string; // raw input
}

export interface ManualPricingSubmission {
  // Provider info
  providerId?: string | null; // if set, update existing
  providerName: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  phone?: string;
  fax?: string;
  categories?: string[]; // specialty ids; first becomes primary specialty_id
  // Pricing rows
  rows: ManualPricingRow[];
  changedByName?: string | null;
}

export interface ManualPricingResult {
  providerId: string;
  pricesWritten: number;
  servicesCreated: number;
}

/**
 * Slugify a CPT code into a deterministic service id for manual entries
 * that don't match an existing services row.
 */
function manualServiceId(cpt: string): string {
  return `MAN-${cpt.trim().toUpperCase().replace(/[^A-Z0-9]/g, "")}`;
}

export function useManualPricing() {
  const qc = useQueryClient();

  return useMutation<ManualPricingResult, Error, ManualPricingSubmission>({
    mutationFn: async (input) => {
      const name = input.providerName.trim();
      if (!name) throw new Error("Provider name is required");

      const primarySpecialty =
        input.categories && input.categories.length > 0 ? input.categories[0] : null;

      // 1. Upsert provider
      let providerId: string;
      if (input.providerId) {
        const { error } = await supabase
          .from("providers")
          .update({
            name,
            address: input.address?.trim() || null,
            city: input.city?.trim() || null,
            state: input.state?.trim() || null,
            zip: input.zip?.trim() || null,
            phone: input.phone?.trim() || null,
            fax: input.fax?.trim() || null,
            categories: input.categories ?? [],
            ...(primarySpecialty ? { specialty_id: primarySpecialty } : {}),
            last_price_update: new Date().toISOString().slice(0, 10),
          } as any)
          .eq("id", input.providerId);
        if (error) throw error;
        providerId = input.providerId;
      } else {
        const { data, error } = await supabase
          .from("providers")
          .insert({
            name,
            address: input.address?.trim() || null,
            city: input.city?.trim() || null,
            state: input.state?.trim() || null,
            zip: input.zip?.trim() || null,
            phone: input.phone?.trim() || null,
            fax: input.fax?.trim() || null,
            categories: input.categories ?? [],
            specialty_id: primarySpecialty,
          } as any)
          .select("id")
          .single();
        if (error) throw error;
        providerId = data.id;
      }

      // 2. Process rows — sanitize price (strip $, commas, spaces) so user
      // input like "$1,200.00" or " 125 " doesn't get silently dropped.
      const sanitizePrice = (raw: string) =>
        parseFloat(String(raw ?? "").replace(/[$,\s]/g, ""));
      const validRows = input.rows.filter((r) => {
        const cpt = r.cptCode.trim();
        const price = sanitizePrice(r.price);
        return cpt.length > 0 && !isNaN(price) && price > 0;
      });

      let servicesCreated = 0;
      let pricesWritten = 0;

      const {
        data: { user },
      } = await supabase.auth.getUser();

      for (const row of validRows) {
        const cpt = row.cptCode.trim().toUpperCase();
        const component = row.component.trim() || "cash";
        const price = sanitizePrice(row.price);

        // Find existing service by CPT
        const { data: existing } = await supabase
          .from("services")
          .select("id, specialty_id")
          .eq("cpt_code", cpt)
          .limit(1)
          .maybeSingle();

        let serviceId: string;
        if (existing) {
          serviceId = existing.id;
        } else {
          serviceId = manualServiceId(cpt);
          const fallbackSpecialty = primarySpecialty ?? "other";
          const { error: svcErr } = await supabase
            .from("services")
            .upsert(
              {
                id: serviceId,
                name: row.serviceName.trim() || `CPT ${cpt}`,
                cpt_code: cpt,
                specialty_id: fallbackSpecialty,
                icd10_codes: [],
              } as any,
              { onConflict: "id" }
            );
          if (svcErr) throw svcErr;
          servicesCreated++;
        }

        // Upsert service_price
        // Need old price for audit
        const { data: existingPrice } = await supabase
          .from("service_prices")
          .select("id, price")
          .eq("provider_id", providerId)
          .eq("service_id", serviceId)
          .eq("component", component)
          .maybeSingle();

        const oldPrice = existingPrice ? Number(existingPrice.price) : 0;

        const { data: upserted, error: priceErr } = await supabase
          .from("service_prices")
          .upsert(
            {
              provider_id: providerId,
              service_id: serviceId,
              component,
              price,
            },
            { onConflict: "provider_id,service_id,component" }
          )
          .select("id")
          .single();
        if (priceErr) throw priceErr;
        pricesWritten++;

        // Audit log
        await supabase.from("price_audit_log").insert({
          service_price_id: upserted.id,
          provider_id: providerId,
          service_id: serviceId,
          component,
          old_price: oldPrice,
          new_price: price,
          changed_by: user?.id ?? null,
          changed_by_name: input.changedByName
            ? `${input.changedByName} (manual entry)`
            : "manual entry",
        });
      }

      return { providerId, pricesWritten, servicesCreated };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["estimator", "providers"] });
      qc.invalidateQueries({ queryKey: ["estimator", "services"] });
      qc.invalidateQueries({ queryKey: ["estimator", "service_prices"] });
      qc.invalidateQueries({ queryKey: ["estimator", "price_audit_log"] });
      qc.invalidateQueries({ queryKey: ["estimator", "provider_totals"] });
    },
  });
}

/**
 * Parse a paste-mode textarea into manual pricing rows.
 * Accepted formats per line (tab or comma separated):
 *   CPT, price
 *   CPT, component, price
 *   CPT, service name, component, price
 */
export function parsePastedRows(text: string): ManualPricingRow[] {
  const rows: ManualPricingRow[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const parts = line.split(/\t|,/).map((p) => p.trim()).filter(Boolean);
    if (parts.length < 2) continue;

    let cptCode = "";
    let serviceName = "";
    let component = "cash";
    let price = "";

    if (parts.length === 2) {
      [cptCode, price] = parts;
    } else if (parts.length === 3) {
      [cptCode, component, price] = parts;
    } else {
      cptCode = parts[0];
      serviceName = parts[1];
      component = parts[2];
      price = parts[3];
    }

    // Strip $ and commas from price
    price = price.replace(/[$,]/g, "");

    rows.push({ cptCode, serviceName, component, price });
  }
  return rows;
}
