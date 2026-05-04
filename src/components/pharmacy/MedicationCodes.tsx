import { QRCodeSVG } from "qrcode.react";
import Barcode from "react-barcode";
import { Medication } from "@/lib/medications";

interface MedicationCodesProps {
  medication: Medication;
  size?: "sm" | "md";
}

function buildQRData(med: Medication): string {
  return JSON.stringify({
    id: med.id,
    name: med.name,
    genericName: med.genericName,
    category: med.category,
    dosageForm: med.dosageForm,
    strength: med.strength,
    ndcNumber: med.ndcNumber,
    expiryDate: med.expiryDate,
    supplier: med.supplier,
  });
}

export function MedicationCodes({ medication, size = "sm" }: MedicationCodesProps) {
  const qrSize = size === "sm" ? 80 : 140;
  const barcodeHeight = size === "sm" ? 30 : 50;
  const barcodeFontSize = size === "sm" ? 10 : 12;

  return (
    <div className="flex items-center gap-3">
      <div className="bg-white p-1.5 rounded border border-border">
        <QRCodeSVG
          value={buildQRData(medication)}
          size={qrSize}
          level="M"
        />
      </div>
      <div className="bg-white p-1.5 rounded border border-border overflow-hidden">
        <Barcode
          value={medication.ndcNumber || medication.id}
          width={1}
          height={barcodeHeight}
          fontSize={barcodeFontSize}
          margin={2}
          displayValue={true}
        />
      </div>
    </div>
  );
}
