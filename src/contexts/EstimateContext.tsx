import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from "react";

export interface EstimateItem {
  id: string; // unique key: `${providerId}-${serviceId}`
  serviceId: string;
  serviceName: string;
  providerId: string;
  providerName: string;
  price: number;
}

interface EstimateContextValue {
  items: EstimateItem[];
  total: number;
  addItem: (item: Omit<EstimateItem, "id">) => void;
  removeItem: (id: string) => void;
  clearAll: () => void;
  hasItem: (providerId: string, serviceId: string) => boolean;
  copyToClipboard: () => void;
}

const EstimateContext = createContext<EstimateContextValue | null>(null);

export function EstimateProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<EstimateItem[]>([]);

  const total = useMemo(() => items.reduce((sum, i) => sum + i.price, 0), [items]);

  const addItem = useCallback((item: Omit<EstimateItem, "id">) => {
    const id = `${item.providerId}-${item.serviceId}`;
    setItems((prev) => {
      if (prev.some((i) => i.id === id)) return prev;
      return [...prev, { ...item, id }];
    });
  }, []);

  const removeItem = useCallback((id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
  }, []);

  const clearAll = useCallback(() => setItems([]), []);

  const hasItem = useCallback(
    (providerId: string, serviceId: string) =>
      items.some((i) => i.id === `${providerId}-${serviceId}`),
    [items]
  );

  const copyToClipboard = useCallback(() => {
    const lines = items.map(
      (i) => `${i.serviceName} (${i.providerName}): $${i.price.toLocaleString()}`
    );
    lines.push(`\nTotal Estimated Cost: $${total.toLocaleString()}`);
    navigator.clipboard.writeText(lines.join("\n"));
  }, [items, total]);

  return (
    <EstimateContext.Provider
      value={{ items, total, addItem, removeItem, clearAll, hasItem, copyToClipboard }}
    >
      {children}
    </EstimateContext.Provider>
  );
}

export function useEstimate() {
  const ctx = useContext(EstimateContext);
  if (!ctx) throw new Error("useEstimate must be used within EstimateProvider");
  return ctx;
}
