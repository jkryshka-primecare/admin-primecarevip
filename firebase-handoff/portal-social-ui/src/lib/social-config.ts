/** Review-only defaults. Enabling requires separate owner approval, never a URL parameter. */
export const socialConfig = {
  displayEnabled: false,
  // Explicitly PUBLIC web configuration in the owning Hub project; never a server secret import.
  googleClientId: import.meta.env.VITE_SOCIAL_GOOGLE_CLIENT_ID || "44285595520-6r27m39dufu0ppt211h9k10qiqq7hd2a.apps.googleusercontent.com",
  appleClientId: "com.primecarevip.portal.web",
  // Owner must authorize an Apple web popup return URL for this Services ID.
  // Do not reuse Firebase's handler: this flow does not use Firebase OAuth.
  appleRedirectUri: import.meta.env.VITE_SOCIAL_APPLE_RETURN_URL || "",
} as const;