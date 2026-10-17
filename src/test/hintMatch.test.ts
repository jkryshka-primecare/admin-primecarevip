import { describe, it, expect } from "vitest";
import { selectExactHintPatient } from "../../supabase/functions/_shared/hintMatch";

const jane = { id: "a", first_name: "Jane", last_name: "Doe", date_of_birth: "1980-01-02" };

describe("Hint billing match rule", () => {
  it("bills only when exactly one exact name+DOB match", () => {
    const r = selectExactHintPatient([jane, { ...jane, id: "b", date_of_birth: "1990-05-05" }], "Jane Doe", "1980-01-02");
    expect(r).toEqual({ kind: "match", patient: jane });
  });
  it("does not bill when nothing matches exactly (no first-result fallback)", () => {
    expect(selectExactHintPatient([{ ...jane, first_name: "Janet" }], "Jane Doe", "1980-01-02").kind).toBe("none");
  });
  it("does not bill when name matches but DOB differs", () => {
    expect(selectExactHintPatient([jane], "Jane Doe", "1980-01-03").kind).toBe("none");
  });
  it("does not bill when two people share name and DOB", () => {
    expect(selectExactHintPatient([jane, { ...jane, id: "b" }], "Jane Doe", "1980-01-02").kind).toBe("ambiguous");
  });
  it("does not bill when DOB is missing", () => {
    expect(selectExactHintPatient([jane], "Jane Doe", null).kind).toBe("none");
  });
});
