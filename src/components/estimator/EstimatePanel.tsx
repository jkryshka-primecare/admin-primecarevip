import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, ChevronUp, ChevronDown, Copy, Check, Trash2, Calculator } from "lucide-react";
import { useEstimate } from "@/contexts/EstimateContext";

export function EstimatePanel() {
  const { items, total, removeItem, clearAll, copyToClipboard } = useEstimate();
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  if (items.length === 0) return null;

  const handleCopy = () => {
    copyToClipboard();
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <motion.div
      initial={{ y: 100, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 100, opacity: 0 }}
      className="fixed bottom-4 right-4 z-50 w-80 rounded-lg bg-card border border-border overflow-hidden shadow-lg"
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Calculator className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold text-foreground">
            Estimate ({items.length})
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold tabular-nums text-primary font-mono">
            ${total.toLocaleString()}
          </span>
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: "auto" }}
            exit={{ height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="border-t border-border max-h-60 overflow-y-auto">
              {items.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between px-4 py-2 border-b border-border last:border-b-0"
                >
                  <div className="min-w-0 flex-1 mr-2">
                    <p className="text-xs font-medium text-foreground truncate">
                      {item.serviceName}
                    </p>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {item.providerName}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs tabular-nums font-medium text-foreground font-mono">
                      ${item.price.toLocaleString()}
                    </span>
                    <button
                      onClick={() => removeItem(item.id)}
                      className="p-0.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="border-t border-border px-4 py-2.5 flex items-center justify-between bg-muted/30">
              <button
                onClick={clearAll}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive transition-colors"
              >
                <Trash2 className="h-3 w-3" />
                Clear All
              </button>
              <button
                onClick={handleCopy}
                className="flex items-center gap-1 text-xs font-medium text-primary hover:text-primary/80 transition-colors"
              >
                {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                {copied ? "Copied!" : "Copy Summary"}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
