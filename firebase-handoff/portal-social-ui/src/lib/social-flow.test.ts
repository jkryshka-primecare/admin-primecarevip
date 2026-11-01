import { describe, expect, it, vi } from "vitest";
import { SocialFlow } from "./social-flow";
const identity = { providerId: "google.com", idToken: "opaque-provider-token" } as const;

describe("reviewed callable-only social flow", () => {
  it("flag off rejects before any callable or token sign-in", async () => {
    const call = vi.fn(); const signIn = vi.fn();
    await expect(new SocialFlow(false, call, signIn).start(identity)).rejects.toThrow("SOCIAL_SIGNIN_DISABLED");
    expect(call).not.toHaveBeenCalled(); expect(signIn).not.toHaveBeenCalled();
  });
  it("path A signs in only with the exact server-issued custom token", async () => {
    const call = vi.fn().mockResolvedValue({ path: "A", customToken: "true-case-uid-token" }); const signIn = vi.fn();
    expect(await new SocialFlow(true, call, signIn).start(identity)).toBe("signed-in");
    expect(call).toHaveBeenCalledWith("socialLinkExisting", identity);
    expect(signIn).toHaveBeenCalledWith("true-case-uid-token");
    expect(signIn).toHaveBeenCalledTimes(1);
  });
  it("path B sends only name/DOB and uses server challenge and masked destination", async () => {
    const call = vi.fn().mockResolvedValueOnce({ path: "B" }).mockResolvedValueOnce({ challengeId: "c-1", channel: "sms", destination: "***1234" }).mockResolvedValueOnce({ path: "B", customToken: "preserved-uid-token" });
    const signIn = vi.fn(); const flow = new SocialFlow(true, call, signIn);
    expect(await flow.start(identity)).toBe("identity-required");
    expect(signIn).not.toHaveBeenCalled();
    expect(await flow.verify({ firstName: " A ", lastName: " B ", dob: "1980-01-02" })).toEqual({ challengeId: "c-1", channel: "sms", destination: "***1234" });
    expect(call.mock.calls[1]).toEqual(["socialStartVerification", { ...identity, firstName: "A", lastName: "B", dob: "1980-01-02" }]);
    await flow.confirm(" 123456 ");
    expect(call.mock.calls[2]).toEqual(["socialConfirmVerification", { ...identity, challengeId: "c-1", code: "123456" }]);
    expect(signIn).toHaveBeenCalledWith("preserved-uid-token");
    await expect(flow.confirm("123456")).rejects.toThrow("RESTART_REQUIRED");
  });
  it("Apple relay follows server path B without decoding email or locating a patient", async () => {
    const call = vi.fn().mockResolvedValue({ path: "B" }); const signIn = vi.fn();
    await new SocialFlow(true, call, signIn).start({ providerId: "apple.com", idToken: "opaque-relay-token" });
    expect(call).toHaveBeenCalledWith("socialLinkExisting", { providerId: "apple.com", idToken: "opaque-relay-token" }); expect(signIn).not.toHaveBeenCalled();
  });
  it("refused path C never exchanges a token", async () => {
    const call = vi.fn().mockResolvedValue({ path: "C", customToken: "must-not-use" }); const signIn = vi.fn();
    expect(await new SocialFlow(true, call, signIn).start(identity)).toBe("contact-practice"); expect(signIn).not.toHaveBeenCalled();
  });
  it("malformed happy-path response cannot sign in", async () => {
    const signIn = vi.fn(); const flow = new SocialFlow(true, vi.fn().mockResolvedValue({ path: "A" }), signIn);
    await expect(flow.start(identity)).rejects.toThrow("INVALID_RESPONSE"); expect(signIn).not.toHaveBeenCalled();
  });
  it("serializes double clicks so linking cannot run twice concurrently", async () => {
    let release: (value: unknown) => void = () => {};
    const call = vi.fn(() => new Promise(resolve => { release = resolve; }));
    const flow = new SocialFlow(true, call, vi.fn()); const first = flow.start(identity);
    await expect(flow.start(identity)).rejects.toThrow("IN_PROGRESS");
    release({ path: "C" }); await first; expect(call).toHaveBeenCalledTimes(1);
  });
  it("a failed code check does not sign in or invent an email fallback", async () => {
    const call = vi.fn().mockResolvedValueOnce({ path: "B" }).mockResolvedValueOnce({ challengeId: "c", channel: "sms", destination: "***1234" }).mockRejectedValueOnce(new Error("CODE_MISMATCH"));
    const signIn = vi.fn(); const flow = new SocialFlow(true, call, signIn);
    await flow.start(identity); await flow.verify({ firstName: "A", lastName: "B", dob: "1980-01-02" });
    await expect(flow.confirm("000000")).rejects.toThrow("CODE_MISMATCH"); expect(signIn).not.toHaveBeenCalled(); expect(call).toHaveBeenCalledTimes(3);
  });
});