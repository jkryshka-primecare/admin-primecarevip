import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Loader2, MailX, CheckCircle2, AlertCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

type Status =
  | "validating"
  | "valid"
  | "already"
  | "invalid"
  | "submitting"
  | "success"
  | "error";

export default function Unsubscribe() {
  const [params] = useSearchParams();
  const token = params.get("token");
  const [status, setStatus] = useState<Status>("validating");
  const [errorMsg, setErrorMsg] = useState<string>("");

  useEffect(() => {
    if (!token) {
      setStatus("invalid");
      setErrorMsg("Missing unsubscribe token.");
      return;
    }
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
    const supabaseAnonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
    fetch(
      `${supabaseUrl}/functions/v1/handle-email-unsubscribe?token=${encodeURIComponent(token)}`,
      { headers: { apikey: supabaseAnonKey } },
    )
      .then((r) => r.json())
      .then((data) => {
        if (data?.valid === true) setStatus("valid");
        else if (data?.reason === "already_unsubscribed") setStatus("already");
        else {
          setStatus("invalid");
          setErrorMsg(data?.error ?? "Invalid or expired link.");
        }
      })
      .catch((err) => {
        setStatus("error");
        setErrorMsg(err?.message ?? "Failed to validate link.");
      });
  }, [token]);

  async function confirm() {
    if (!token) return;
    setStatus("submitting");
    const { data, error } = await supabase.functions.invoke(
      "handle-email-unsubscribe",
      { body: { token } },
    );
    if (error) {
      setStatus("error");
      setErrorMsg(error.message);
      return;
    }
    if (data?.success) setStatus("success");
    else if (data?.reason === "already_unsubscribed") setStatus("already");
    else {
      setStatus("error");
      setErrorMsg(data?.error ?? "Could not process unsubscribe.");
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md p-8 space-y-6 text-center">
        <div className="flex justify-center">
          {(status === "validating" || status === "submitting") && (
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
          )}
          {status === "valid" && <MailX className="h-10 w-10 text-primary" />}
          {(status === "success" || status === "already") && (
            <CheckCircle2 className="h-10 w-10 text-success" />
          )}
          {(status === "invalid" || status === "error") && (
            <AlertCircle className="h-10 w-10 text-destructive" />
          )}
        </div>

        {status === "validating" && (
          <p className="text-muted-foreground">Validating your link…</p>
        )}

        {status === "valid" && (
          <>
            <h1 className="text-2xl font-serif text-foreground">Unsubscribe?</h1>
            <p className="text-muted-foreground">
              Click below to stop receiving non-essential emails from Prime Care VIP.
              You will still receive critical account and security messages.
            </p>
            <Button onClick={confirm} className="w-full">
              Confirm unsubscribe
            </Button>
          </>
        )}

        {status === "submitting" && (
          <p className="text-muted-foreground">Processing…</p>
        )}

        {status === "success" && (
          <>
            <h1 className="text-2xl font-serif text-foreground">You're unsubscribed</h1>
            <p className="text-muted-foreground">
              You won't receive further notification emails at this address.
            </p>
          </>
        )}

        {status === "already" && (
          <>
            <h1 className="text-2xl font-serif text-foreground">Already unsubscribed</h1>
            <p className="text-muted-foreground">
              This email address has already been removed from our list.
            </p>
          </>
        )}

        {(status === "invalid" || status === "error") && (
          <>
            <h1 className="text-2xl font-serif text-foreground">
              Couldn't process request
            </h1>
            <p className="text-muted-foreground">{errorMsg}</p>
          </>
        )}
      </Card>
    </main>
  );
}
