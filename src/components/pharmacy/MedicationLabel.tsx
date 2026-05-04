import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Printer } from "lucide-react";
import logoUrl from "@/assets/prime-care-vip-rx-logo.jpg";

export interface LabelData {
  patientName: string;
  rxNumber: string;
  medicationName: string;
  strength: string;
  quantity: number;
  directions: string;
  prescriber: string;
  dispensedBy: string;
  dispensedDate: string;
  refillsAuthorized: number;
  refillNumber: number;
  manufacturer?: string;
  lotNumber?: string;
  expiryDate?: string;
  totalCost?: number;
}

export function MedicationLabel({ data, onClose }: { data: LabelData; onClose: () => void }) {
  const labelRef = useRef<HTMLDivElement>(null);

  const handlePrint = () => {
    const labelHtml = labelRef.current?.innerHTML || "";
    if (!labelHtml) return;

    const fullHtml = `<!DOCTYPE html>
<html>
<head>
  <title>Medication Label</title>
  <style>
    @page {
      size: 2.25in 1.25in;
      margin: 0.8in;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      width: 2.25in;
      height: 1.25in;
      font-family: Arial, Helvetica, sans-serif;
      padding: 0.04in 0.06in 0.04in 0.16in;
      overflow: hidden;
    }
    .label-container {
      width: 100%;
      height: 100%;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }
  </style>
</head>
<body>${labelHtml}</body>
</html>`;

    const iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.top = "-10000px";
    iframe.style.left = "-10000px";
    iframe.style.width = "2.25in";
    iframe.style.height = "1.25in";
    iframe.style.border = "none";
    document.body.appendChild(iframe);

    const iframeDoc = iframe.contentWindow?.document;
    if (!iframeDoc) {
      document.body.removeChild(iframe);
      return;
    }

    iframeDoc.open();
    iframeDoc.write(fullHtml);
    iframeDoc.close();

    iframe.onload = () => {
      const doPrint = () => {
        try {
          iframe.contentWindow?.print();
        } catch {
          const blob = new Blob([fullHtml], { type: "text/html" });
          const url = URL.createObjectURL(blob);
          window.open(url, "_blank");
          setTimeout(() => URL.revokeObjectURL(url), 5000);
        }
        setTimeout(() => document.body.removeChild(iframe), 1000);
      };

      // Wait for images inside the iframe to load before printing
      const imgs = Array.from(iframe.contentDocument?.images || []);
      const pending = imgs.filter((img) => !img.complete);
      if (pending.length === 0) {
        doPrint();
      } else {
        let remaining = pending.length;
        const done = () => {
          remaining -= 1;
          if (remaining <= 0) doPrint();
        };
        pending.forEach((img) => {
          img.addEventListener("load", done);
          img.addEventListener("error", done);
        });
      }
    };
  };

  const dispensedDate = data.dispensedDate
    ? new Date(data.dispensedDate).toLocaleDateString()
    : new Date().toLocaleDateString();

  return (
    <div className="space-y-4">
      {/* On-screen preview scaled up for readability */}
      <div className="border border-border rounded-lg p-4 bg-white flex justify-center">
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
            ref={labelRef}
            className="label-container"
            style={{
              width: "100%",
              height: "100%",
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              padding: "0.04in 0.06in 0.04in 0.16in",
            }}
          >
            {/* Header: Pharmacy logo */}
            <div
              style={{
                textAlign: "center",
                lineHeight: 0,
                borderBottom: "0.5pt solid #04244C",
                paddingBottom: "1.5pt",
                marginBottom: "1.5pt",
              }}
            >
              <img
                src={logoUrl}
                alt="Prime Care VIP Rx"
                style={{ height: "16pt", width: "auto", display: "inline-block" }}
              />
            </div>


            {/* Row 1: Patient + Rx */}
            <div>
              <div style={{ fontSize: "8pt", fontWeight: 700, textTransform: "uppercase", lineHeight: 1.1 }}>
                {data.patientName}
              </div>
              <div style={{ fontSize: "6pt", color: "#444", lineHeight: 1.1 }}>
                Rx# {data.rxNumber} &nbsp;|&nbsp; Date: {dispensedDate}
              </div>
            </div>

            {/* Row 2: Medication */}
            <div>
              <div style={{ fontSize: "7.5pt", fontWeight: 700, lineHeight: 1.1 }}>
                {data.medicationName} {data.strength}
              </div>
              <div style={{ fontSize: "6pt", color: "#333", lineHeight: 1.1 }}>
                Qty: {data.quantity}
                {data.totalCost != null && <> &nbsp;|&nbsp; Cost: ${data.totalCost.toFixed(2)}</>}
                {data.manufacturer && <> &nbsp;|&nbsp; Mfr: {data.manufacturer}</>}
                {data.lotNumber && <> &nbsp;|&nbsp; Lot: {data.lotNumber}</>}
              </div>
            </div>

            {/* Row 3: Directions (Sig) */}
            <div
              style={{
                fontSize: "6.5pt",
                fontWeight: 600,
                lineHeight: 1.15,
                borderTop: "0.5pt solid #999",
                borderBottom: "0.5pt solid #999",
                padding: "1pt 0",
              }}
            >
              {data.directions || "See prescriber instructions"}
            </div>

            {/* Row 4: Footer */}
            <div
              style={{
                fontSize: "5.5pt",
                color: "#555",
                display: "flex",
                justifyContent: "space-between",
                lineHeight: 1.1,
              }}
            >
              <div style={{ display: "flex", flexDirection: "column" }}>
                <span>Prescriber: {data.prescriber}</span>
                <span>Dispensed by: {data.dispensedBy}</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", textAlign: "right" }}>
                <span>Refill {data.refillNumber} of {data.refillsAuthorized}</span>
                {data.expiryDate && <span>Exp: {data.expiryDate}</span>}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Extra vertical space for scaled preview */}
      <div style={{ height: "1.25in" }} />

      <div className="flex gap-2 justify-end">
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
        <Button onClick={handlePrint}>
          <Printer className="h-4 w-4 mr-2" />
          Print Label
        </Button>
      </div>
    </div>
  );
}
