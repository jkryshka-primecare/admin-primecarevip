/** Review-only defaults. Enabling requires separate owner approval, never a URL parameter. */
export const socialConfig = {
  displayEnabled: false,
  googleClientId: "",
  appleClientId: "com.primecarevip.portal.web",
  // Owner must authorize an Apple web popup return URL for this Services ID.
  // Do not reuse Firebase's handler: this flow does not use Firebase OAuth.
  appleRedirectUri: "",
} as const;