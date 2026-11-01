import { expect, it, vi } from "vitest";
import { requestReset } from "./reset-flow";
it("propagates reset transport failures instead of claiming the send succeeded", async () => {
  const send = vi.fn().mockRejectedValue({ code: "auth/network-request-failed" });
  await expect(requestReset(send, " x@example.invalid ")).rejects.toEqual({ code: "auth/network-request-failed" });
  expect(send).toHaveBeenCalledWith("x@example.invalid");
});
it("unknown account stays neutral without leaking account existence", async () => {
  await expect(requestReset(vi.fn().mockRejectedValue({ code: "auth/user-not-found" }), "x@example.invalid")).resolves.toBeUndefined();
});