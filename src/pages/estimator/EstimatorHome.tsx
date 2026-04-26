import { useState } from "react";
import { Trash2, Search } from "lucide-react";
import AppLayout from "@/components/AppLayout";
import { SpecialtySidebar } from "@/components/estimator/SpecialtySidebar";
import { SearchBar } from "@/components/estimator/SearchBar";
import { ServiceTable } from "@/components/estimator/ServiceTable";
import { AuditLogPanel } from "@/components/estimator/AuditLogPanel";
import { EstimatePanel } from "@/components/estimator/EstimatePanel";
import { ImportPricingDialog } from "@/components/estimator/ImportPricingDialog";
import { EstimateProvider, useEstimate } from "@/contexts/EstimateContext";
import { useServices, useProviders, useNhsnCategories } from "@/hooks/useEstimatorDb";
import { useAuth } from "@/hooks/useAuth";

function EstimatorContent() {
  const [activeSpecialty, setActiveSpecialty] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [locationFilter, setLocationFilter] = useState("");
  const [providerSearch, setProviderSearch] = useState("");
  const [nhsnCategory, setNhsnCategory] = useState("");
  const { items, clearAll } = useEstimate();
  const { isAdmin } = useAuth();

  const hasProviderSearch = providerSearch.trim().length > 0;
  const hasNhsnFilter = nhsnCategory.trim().length > 0;
  const hasSearch = searchQuery.trim().length >= 3 || hasProviderSearch || hasNhsnFilter;
  const { data: filteredServices = [], isLoading: servicesLoading } = useServices(
    activeSpecialty,
    searchQuery,
    providerSearch,
    nhsnCategory
  );
  const { data: providerList = [] } = useProviders(activeSpecialty, locationFilter);
  const { data: nhsnCategories = [] } = useNhsnCategories();

  return (
    <div className="flex gap-6 items-start">
      <SpecialtySidebar activeSpecialty={activeSpecialty} onSelect={setActiveSpecialty} />

      <div className="flex-1 min-w-0">
        <div className="bg-card border border-border rounded-lg p-4 mb-4">
          <div className="flex items-baseline justify-between mb-3 gap-4 flex-wrap">
            <div>
              <h2 className="font-serif text-lg text-foreground">
                {activeSpecialty === "all"
                  ? "All Specialties"
                  : activeSpecialty.charAt(0).toUpperCase() + activeSpecialty.slice(1)}
              </h2>
              {hasSearch && (
                <p className="text-xs text-muted-foreground mt-0.5 font-mono">
                  {filteredServices.length} service{filteredServices.length !== 1 ? "s" : ""} ·{" "}
                  {providerList.length} provider{providerList.length !== 1 ? "s" : ""}
                  {locationFilter && ` near "${locationFilter}"`}
                </p>
              )}
            </div>
            <div className="flex items-center gap-3">
              {isAdmin && <ImportPricingDialog activeSpecialty={activeSpecialty} />}
              {items.length > 0 && (
                <button
                  onClick={clearAll}
                  className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-destructive transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Clear ({items.length})
                </button>
              )}
            </div>
          </div>
          <SearchBar
            value={searchQuery}
            onChange={setSearchQuery}
            resultCount={filteredServices.length}
            location={locationFilter}
            onLocationChange={setLocationFilter}
            providerSearch={providerSearch}
            onProviderSearchChange={setProviderSearch}
          />
        </div>

        {!hasSearch ? (
          <div className="flex flex-col items-center justify-center py-24 text-center bg-card border border-border rounded-lg">
            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-4">
              <Search className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium text-foreground">Search to get started</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-xs">
              Enter a CPT code, service name, or ICD-10 code (3+ characters), or search by
              provider name to find pricing.
            </p>
          </div>
        ) : servicesLoading ? (
          <div className="flex items-center justify-center py-20">
            <p className="text-sm text-muted-foreground">Searching…</p>
          </div>
        ) : (
          <ServiceTable
            services={filteredServices}
            specialty={activeSpecialty}
            locationFilter={locationFilter}
          />
        )}

        <AuditLogPanel />
      </div>

      <EstimatePanel />
    </div>
  );
}

export default function EstimatorHome() {
  return (
    <AppLayout title="Cost Estimator">
      <EstimateProvider>
        <EstimatorContent />
      </EstimateProvider>
    </AppLayout>
  );
}
