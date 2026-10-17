// Which pharmacy program an Elation script belongs to, from its
// "pharmacy instructions" note. PCVIP = bill in Hint from inventory price;
// HERO = deduct stock, $0, never billed.

export type RxProgram = "pcvip" | "hero";
export type ProgramResult =
  | { kind: "program"; program: RxProgram }
  | { kind: "needs_review" }
  | { kind: "ignore" };

export function detectRxProgram(note: string | null | undefined): ProgramResult {
  if (!note) return { kind: "ignore" };
  const pcvip = /\bpcvip\b/i.test(note);
  const hero = /\bhero\b/i.test(note);
  if (pcvip && hero) return { kind: "needs_review" };
  if (pcvip) return { kind: "program", program: "pcvip" };
  if (hero) return { kind: "program", program: "hero" };
  return { kind: "ignore" };
}

/** Pricing for a dispense. HERO is always $0 and never sent to Hint. */
export function dispensePricing(
  program: RxProgram | null | undefined,
  pricePerUnit: number | null | undefined,
  quantity: number,
): { unitPrice: number | null; totalCost: number | null; billInHint: boolean } {
  if (program === "hero") return { unitPrice: 0, totalCost: 0, billInHint: false };
  if (pricePerUnit == null) return { unitPrice: null, totalCost: null, billInHint: true };
  return { unitPrice: pricePerUnit, totalCost: pricePerUnit * quantity, billInHint: true };
}
