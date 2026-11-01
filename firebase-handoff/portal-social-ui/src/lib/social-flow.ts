/** Reviewed callable protocol only. Provider tokens never authenticate with Firebase. */
export type ProviderAttempt = { attemptId: string; proof: string; nonce: string };
export type ProviderIdentity = { providerId: "google.com" | "apple.com"; idToken: string; attemptId: string; proof: string };
export type Challenge = { challengeId: string; channel: "sms" | "email"; destination: string };
export type LinkOutcome = { path: "A" | "B" | "C"; customToken?: string };
export type Callable = (name: string, data: Record<string, unknown>) => Promise<unknown>;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") throw new Error("INVALID_RESPONSE");
  return value as Record<string, unknown>;
}

export class SocialFlow {
  private identity: ProviderIdentity | null = null;
  private challenge: Challenge | null = null;
  private busy = false;
  constructor(
    private readonly enabled: boolean,
    private readonly call: Callable,
    private readonly signInWithToken: (token: string) => Promise<void>,
  ) {}

  clear() { this.identity = null; this.challenge = null; }

  private async exclusive<T>(action: () => Promise<T>): Promise<T> {
    if (!this.enabled) throw new Error("SOCIAL_SIGNIN_DISABLED");
    if (this.busy) throw new Error("IN_PROGRESS");
    this.busy = true;
    try { return await action(); } finally { this.busy = false; }
  }

  private async finish(value: unknown): Promise<"signed-in"> {
    const response = record(value);
    if ((response.path !== "A" && response.path !== "B") || typeof response.customToken !== "string" || !response.customToken) {
      throw new Error("INVALID_RESPONSE");
    }
    // The server alone chooses the true-case UID encoded in this custom token.
    await this.signInWithToken(response.customToken);
    this.clear();
    return "signed-in";
  }

  async start(identity: ProviderIdentity): Promise<"signed-in" | "identity-required" | "contact-practice"> {
    return this.exclusive(async () => {
      this.clear();
      if (!identity.idToken) throw new Error("NO_PROVIDER_TOKEN");
      this.identity = identity;
      const response = record(await this.call("socialLinkExisting", { ...identity }));
      if (response.path === "A") return this.finish(response);
      if (response.path === "B") return "identity-required";
      this.clear();
      if (response.path === "C") return "contact-practice";
      throw new Error("INVALID_RESPONSE");
    });
  }

  async verify(input: { firstName: string; lastName: string; dob: string }): Promise<Challenge> {
    return this.exclusive(async () => {
      if (!this.identity) throw new Error("RESTART_REQUIRED");
      const response = record(await this.call("socialStartVerification", {
        ...this.identity, firstName: input.firstName.trim(), lastName: input.lastName.trim(), dob: input.dob,
      }));
      if (typeof response.challengeId !== "string" || !response.challengeId ||
          (response.channel !== "sms" && response.channel !== "email") || typeof response.destination !== "string") {
        throw new Error("INVALID_RESPONSE");
      }
      this.challenge = { challengeId: response.challengeId, channel: response.channel, destination: response.destination };
      return this.challenge;
    });
  }

  async confirm(code: string): Promise<"signed-in"> {
    return this.exclusive(async () => {
      if (!this.identity || !this.challenge) throw new Error("RESTART_REQUIRED");
      const result = await this.call("socialConfirmVerification", {
        ...this.identity, challengeId: this.challenge.challengeId, code: code.trim(),
      });
      return this.finish(result);
    });
  }
}