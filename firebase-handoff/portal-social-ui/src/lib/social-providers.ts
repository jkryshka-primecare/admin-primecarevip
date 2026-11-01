import type { ProviderIdentity } from "./social-flow";
import { socialConfig } from "./social-config";

type GoogleSdk = { accounts: { id: {
  initialize: (options: { client_id: string; callback: (response: { credential?: string }) => void; nonce: string; auto_select: boolean }) => void;
  renderButton: (element: HTMLElement, options: { theme: string; size: string; text: string; width: number }) => void;
  cancel: () => void;
} } };
type AppleSdk = { auth: {
  init: (options: { clientId: string; scope: string; redirectURI: string; state: string; nonce: string; usePopup: boolean }) => void;
  signIn: () => Promise<{ authorization: { id_token?: string; state?: string } }>;
} };
declare global { interface Window { google?: GoogleSdk; AppleID?: AppleSdk } }

const scripts = new Map<string, Promise<void>>();
function load(src: string): Promise<void> {
  const prior = scripts.get(src);
  if (prior) return prior;
  const promise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src; script.async = true;
    const timer = window.setTimeout(() => { script.remove(); scripts.delete(src); reject(new Error("PROVIDER_UNAVAILABLE")); }, 15000);
    script.onload = () => { clearTimeout(timer); resolve(); };
    script.onerror = () => { clearTimeout(timer); script.remove(); scripts.delete(src); reject(new Error("PROVIDER_UNAVAILABLE")); };
    document.head.appendChild(script);
  });
  scripts.set(src, promise);
  return promise;
}

/** Provider-native credential acquisition; no Firebase social SDK is imported. */
export async function mountGoogle(element: HTMLElement, receive: (id: ProviderIdentity) => void): Promise<() => void> {
  if (!socialConfig.displayEnabled || !socialConfig.googleClientId) throw new Error("PROVIDER_NOT_CONFIGURED");
  await load("https://accounts.google.com/gsi/client");
  const sdk = window.google;
  if (!sdk) throw new Error("PROVIDER_UNAVAILABLE");
  let active = true;
  sdk.accounts.id.initialize({ client_id: socialConfig.googleClientId, nonce: crypto.randomUUID(), auto_select: false,
    callback: ({ credential }) => { if (active && credential) receive({ providerId: "google.com", idToken: credential }); },
  });
  sdk.accounts.id.renderButton(element, { theme: "outline", size: "large", text: "continue_with", width: Math.min(element.clientWidth || 280, 400) });
  return () => { active = false; sdk.accounts.id.cancel(); element.replaceChildren(); };
}

export async function acquireApple(): Promise<ProviderIdentity> {
  if (!socialConfig.displayEnabled || !socialConfig.appleRedirectUri) throw new Error("PROVIDER_NOT_CONFIGURED");
  await load("https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js");
  const sdk = window.AppleID;
  if (!sdk) throw new Error("PROVIDER_UNAVAILABLE");
  const state = crypto.randomUUID();
  sdk.auth.init({ clientId: socialConfig.appleClientId, scope: "name email", redirectURI: socialConfig.appleRedirectUri,
    state, nonce: crypto.randomUUID(), usePopup: true });
  const response = await sdk.auth.signIn();
  if (response.authorization.state !== state || !response.authorization.id_token) throw new Error("INVALID_PROVIDER_RESPONSE");
  return { providerId: "apple.com", idToken: response.authorization.id_token };
}