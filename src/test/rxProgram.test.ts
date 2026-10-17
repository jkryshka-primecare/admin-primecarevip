import { describe, it, expect } from "vitest";
import { detectRxProgram, dispensePricing } from "../../supabase/functions/_shared/rxProgram";

describe("detectRxProgram", () => {
  it("PCVIP in the note → pcvip (any case)", () => {
    expect(detectRxProgram("PCVIP")).toEqual({ kind: "program", program: "pcvip" });
    expect(detectRxProgram("fill at pcvip please")).toEqual({ kind: "program", program: "pcvip" });
  });
  it("HERO in the note → hero", () => {
    expect(detectRxProgram("Hero")).toEqual({ kind: "program", program: "hero" });
  });
  it("both words → needs review", () => {
    expect(detectRxProgram("PCVIP / HERO")).toEqual({ kind: "needs_review" });
  });
  it("neither word, empty, or partial word → ignored", () => {
    expect(detectRxProgram("good rx")).toEqual({ kind: "ignore" });
    expect(detectRxProgram("")).toEqual({ kind: "ignore" });
    expect(detectRxProgram(null)).toEqual({ kind: "ignore" });
    expect(detectRxProgram("heroin taper")).toEqual({ kind: "ignore" });
  });
});

describe("dispensePricing", () => {
  it("HERO is $0 and never billed in Hint", () => {
    expect(dispensePricing("hero", 2.5, 20)).toEqual({ unitPrice: 0, totalCost: 0, billInHint: false });
  });
  it("PCVIP uses the inventory price and is billed", () => {
    expect(dispensePricing("pcvip", 2.5, 20)).toEqual({ unitPrice: 2.5, totalCost: 50, billInHint: true });
  });
});
