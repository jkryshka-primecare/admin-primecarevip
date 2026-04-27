// Sends notifications when a hr_performance_reviews row changes status.
// - Inserts an in-app row in hr_notifications for the relevant party.
// - Triggers a transactional email via send-transactional-email.
//
// Routing per new status:
//   in_progress     -> notify reviewer  ("you can start writing the review")
//   employee_review -> notify employee  ("ready for your input")
//   completed       -> notify employee  ("your review is complete")
//
// Idempotency: callers should pass an idempotencyKey derived from
// `${reviewId}-${newStatus}` to avoid duplicate emails on re-saves.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type Stage = "in_progress" | "employee_review" | "completed";

interface Payload {
  reviewId: string;
  previousStatus?: string | null;
  newStatus: Stage;
}

const APP_URL = "https://admin.primecarevip.com/hr/performance";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = (await req.json()) as Payload;
    if (!body?.reviewId || !body?.newStatus) {
      return json({ error: "reviewId and newStatus required" }, 400);
    }

    // No-op if status didn't actually change to a notify-worthy stage.
    const NOTIFY_STAGES: Stage[] = ["in_progress", "employee_review", "completed"];
    if (!NOTIFY_STAGES.includes(body.newStatus)) {
      return json({ skipped: true, reason: "stage not notifiable" });
    }
    if (body.previousStatus === body.newStatus) {
      return json({ skipped: true, reason: "no status change" });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: review, error } = await supabase
      .from("hr_performance_reviews")
      .select(
        `id, status, overall_rating,
         cycle:hr_review_cycles!hr_performance_reviews_cycle_id_fkey(id, name),
         employee:hr_employees!hr_performance_reviews_employee_id_fkey(id, first_name, last_name, email, user_id),
         reviewer:hr_employees!hr_performance_reviews_reviewer_id_fkey(id, first_name, last_name, email, user_id)`,
      )
      .eq("id", body.reviewId)
      .maybeSingle();

    if (error) return json({ error: error.message }, 500);
    if (!review) return json({ error: "review not found" }, 404);

    const employee = review.employee as any;
    const reviewer = review.reviewer as any;
    const cycle = review.cycle as any;
    const cycleName = cycle?.name ?? "Performance review";
    const employeeName = employee
      ? `${employee.first_name} ${employee.last_name}`.trim()
      : "Employee";
    const reviewerName = reviewer
      ? `${reviewer.first_name} ${reviewer.last_name}`.trim()
      : null;

    // Pick recipient
    const recipient =
      body.newStatus === "in_progress" ? reviewer : employee;
    if (!recipient?.email) {
      return json({ skipped: true, reason: "no recipient email" });
    }
    const recipientName =
      `${recipient.first_name ?? ""} ${recipient.last_name ?? ""}`.trim() ||
      "there";

    // 1. In-app notification (best-effort)
    if (recipient.user_id) {
      const titleByStage: Record<Stage, string> = {
        in_progress: `Review assigned: ${employeeName}`,
        employee_review: `Your review is ready for your input`,
        completed: `Your performance review is complete`,
      };
      const messageByStage: Record<Stage, string> = {
        in_progress: `${cycleName} — please open and start ${employeeName}'s review.`,
        employee_review: `${reviewerName ?? "Your manager"} finished writing your ${cycleName} review.`,
        completed: `Your ${cycleName} review has been finalized.`,
      };
      await supabase.from("hr_notifications").insert({
        user_id: recipient.user_id,
        title: titleByStage[body.newStatus],
        message: messageByStage[body.newStatus],
        link: "/hr/performance",
      });
    }

    // 2. Transactional email
    const { error: emailErr } = await supabase.functions.invoke(
      "send-transactional-email",
      {
        body: {
          templateName: "performance-review-status",
          recipientEmail: recipient.email,
          idempotencyKey: `perf-review-${body.reviewId}-${body.newStatus}`,
          templateData: {
            recipientName,
            cycleName,
            employeeName,
            reviewerName,
            newStatus: body.newStatus,
            appUrl: APP_URL,
            overallRating: review.overall_rating,
          },
        },
      },
    );

    if (emailErr) {
      return json({ ok: true, in_app: true, email_error: emailErr.message });
    }

    return json({ ok: true, in_app: !!recipient.user_id, email: true });
  } catch (e: any) {
    return json({ error: e?.message ?? "unknown error" }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
