/** Report operational send failures truthfully without revealing account existence. */
export async function requestReset(send: (email: string) => Promise<void>, email: string): Promise<void> {
  try { await send(email.trim()); }
  catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : null;
    if (code === "auth/user-not-found") return;
    throw error;
  }
}