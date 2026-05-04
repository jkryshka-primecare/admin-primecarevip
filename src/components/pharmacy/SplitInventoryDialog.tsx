import { useState, useRef } from "react";
import { Scissors, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Medication, splitMedication, SplitResult } from "@/lib/medications";
import { toast } from "sonner";

interface Props {
  source: Medication | null;
  onClose: () => void;
  onComplete: () => void;
}

export function SplitInventoryDialog({ source, onClose, onComplete }: Props) {
  const [qtyPerVial, setQtyPerVial] = useState(1);
  const [numberOfVials, setNumberOfVials] = useState(1);
  const [splitResult, setSplitResult] = useState<SplitResult | null>(null);
  const labelsRef = useRef<HTMLDivElement>(null);

  if (!source) return null;

  const totalNeeded = qtyPerVial * numberOfVials;
  const totalCostPerVial = qtyPerVial * source.dispensePricePerUnit;
  const isValid = totalNeeded > 0 && totalNeeded <= source.quantity && qtyPerVial > 0 && numberOfVials > 0;

  const handleSplit = async () => {
    try {
      const result = await splitMedication(source.id, qtyPerVial, numberOfVials);
      setSplitResult(result);
      toast.success(`Split into ${numberOfVials} vial(s) of ${qtyPerVial} units each`);
      onComplete();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Split failed");
    }
  };

  const handlePrintLabels = () => {
    if (!labelsRef.current) return;

    const labelHtml = `<!DOCTYPE html><html><head><title>Split Labels</title>
      <style>
        @page { size: 2.25in 1.25in; margin: 0.8in; }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: Arial, Helvetica, sans-serif; }
        .label {
          width: 2.25in; height: 1.25in; padding: 0.04in 0.06in;
          display: flex; flex-direction: column; justify-content: space-between;
          page-break-after: always;
        }
        .label:last-child { page-break-after: auto; }
        .name { font-size: 8pt; font-weight: 700; text-transform: uppercase; line-height: 1.1; }
        .detail { font-size: 6.5pt; color: #333; line-height: 1.15; }
        .med { font-size: 7.5pt; font-weight: 700; line-height: 1.1; }
        .price { font-size: 7pt; font-weight: 600; border-top: 0.5pt solid #999; border-bottom: 0.5pt solid #999; padding: 1pt 0; line-height: 1.15; }
        .footer { font-size: 5.5pt; color: #555; display: flex; justify-content: space-between; line-height: 1.1; }
      </style></head><body>${labelsRef.current.innerHTML}</body></html>`;

    // Use a hidden iframe to avoid popup blockers
    const iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "none";
    document.body.appendChild(iframe);

    const iframeDoc = iframe.contentWindow?.document;
    if (!iframeDoc || !iframe.contentWindow) {
      document.body.removeChild(iframe);
      toast.error("Unable to open print dialog");
      return;
    }

    iframeDoc.open();
    iframeDoc.write(labelHtml);
    iframeDoc.close();

    // Wait for content to render before printing
    iframe.onload = () => {
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      } catch {
        toast.error("Print failed — try allowing popups for this site");
      }
      setTimeout(() => document.body.removeChild(iframe), 1000);
    };

    // Fallback if onload doesn't fire (some browsers)
    setTimeout(() => {
      if (document.body.contains(iframe)) {
        try {
          iframe.contentWindow?.focus();
          iframe.contentWindow?.print();
        } catch {
          // silent
        }
        setTimeout(() => {
          if (document.body.contains(iframe)) document.body.removeChild(iframe);
        }, 1000);
      }
    }, 500);
  };

  const handleClose = () => {
    setSplitResult(null);
    setQtyPerVial(1);
    setNumberOfVials(1);
    onClose();
  };

  const today = new Date().toLocaleDateString();

  return (
    <Dialog open={!!source} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>
            <Scissors className="h-4 w-4 inline mr-2" />
            Split Inventory — Pre-Pack
          </DialogTitle>
        </DialogHeader>

        <div className="rounded-md border p-3 bg-muted/50 text-sm">
          <p className="font-medium">{source.name}</p>
          <p className="text-muted-foreground">
            {source.strength} · {source.dosageForm} · Available: {source.quantity} · ${source.dispensePricePerUnit.toFixed(2)}/unit
          </p>
        </div>

        {!splitResult ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Units Per Vial</Label>
                <Input
                  type="number"
                  min={1}
                  max={source.quantity}
                  value={qtyPerVial}
                  onChange={(e) => setQtyPerVial(Number(e.target.value))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Number of Vials</Label>
                <Input
                  type="number"
                  min={1}
                  max={Math.floor(source.quantity / Math.max(qtyPerVial, 1))}
                  value={numberOfVials}
                  onChange={(e) => setNumberOfVials(Number(e.target.value))}
                />
              </div>
            </div>

            <div className="rounded-md border p-3 text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total units to split</span>
                <span className="font-medium">{totalNeeded}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Remaining in source</span>
                <span className="font-medium">{Math.max(source.quantity - totalNeeded, 0)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Price per vial</span>
                <span className="font-medium">${totalCostPerVial.toFixed(2)}</span>
              </div>
              <div className="flex justify-between border-t pt-1">
                <span className="text-muted-foreground">Labels to print</span>
                <span className="font-semibold text-primary">{numberOfVials}</span>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={handleClose}>Cancel</Button>
              <Button disabled={!isValid} onClick={handleSplit}>
                <Scissors className="h-4 w-4 mr-2" />
                Split &amp; Create {numberOfVials} Vial{numberOfVials !== 1 ? "s" : ""}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Created {splitResult.newItems.length} pre-packed vial(s).
              {splitResult.sourceRemaining > 0
                ? ` ${splitResult.sourceRemaining} units remain in the original.`
                : " Original item was fully consumed."}
            </p>

            {/* Hidden printable labels */}
            <div ref={labelsRef} className="hidden">
              {splitResult.newItems.map((item, i) => (
                <div key={item.id} className="label">
                  <div>
                    <div className="name">{item.name}</div>
                    <div className="detail">Pre-Pack #{i + 1} of {splitResult.newItems.length} · {today}</div>
                  </div>
                  <div>
                    <div className="med">{item.name} {item.strength}</div>
                    <div className="detail">
                      {item.dosageForm} · Qty: {item.quantity}
                      {item.manufacturer && <> · Mfr: {item.manufacturer}</>}
                    </div>
                  </div>
                  <div className="price">
                    Price: ${(item.quantity * item.dispensePricePerUnit).toFixed(2)} ({item.quantity} × ${item.dispensePricePerUnit.toFixed(2)})
                  </div>
                  <div className="footer">
                    <div>
                      <span>NDC: {item.ndcNumber}</span>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <span>Exp: {item.expiryDate}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Label preview */}
            <div className="border rounded-lg p-4 bg-white flex justify-center">
              <div
                style={{
                  width: "2.25in",
                  height: "1.25in",
                  transform: "scale(2)",
                  transformOrigin: "top center",
                  fontFamily: "Arial, Helvetica, sans-serif",
                }}
              >
                <div
                  style={{
                    width: "100%",
                    height: "100%",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                    padding: "0.04in 0.06in",
                  }}
                >
                  <div>
                    <div style={{ fontSize: "8pt", fontWeight: 700, textTransform: "uppercase", lineHeight: 1.1 }}>
                      {source.name}
                    </div>
                    <div style={{ fontSize: "6pt", color: "#444", lineHeight: 1.1 }}>
                      Pre-Pack · {today}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: "7.5pt", fontWeight: 700, lineHeight: 1.1 }}>
                      {source.name} {source.strength}
                    </div>
                    <div style={{ fontSize: "6pt", color: "#333", lineHeight: 1.1 }}>
                      {source.dosageForm} · Qty: {qtyPerVial}
                      {source.manufacturer && <> · Mfr: {source.manufacturer}</>}
                    </div>
                  </div>
                  <div style={{ fontSize: "6.5pt", fontWeight: 600, lineHeight: 1.15, borderTop: "0.5pt solid #999", borderBottom: "0.5pt solid #999", padding: "1pt 0" }}>
                    Price: ${totalCostPerVial.toFixed(2)} ({qtyPerVial} × ${source.dispensePricePerUnit.toFixed(2)})
                  </div>
                  <div style={{ fontSize: "5.5pt", color: "#555", display: "flex", justifyContent: "space-between", lineHeight: 1.1 }}>
                    <span>NDC: {source.ndcNumber}</span>
                    <span>Exp: {source.expiryDate}</span>
                  </div>
                </div>
              </div>
            </div>
            <div style={{ height: "1.25in" }} />

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={handleClose}>Done</Button>
              <Button onClick={handlePrintLabels}>
                <Printer className="h-4 w-4 mr-2" />
                Print {splitResult.newItems.length} Label{splitResult.newItems.length !== 1 ? "s" : ""}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
