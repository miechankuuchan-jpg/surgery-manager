import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";

const APP_ID = "bf995411-c2b4-4541-a292-955b6682cbb6";
const APP_URL = "https://miechankuuchan-jpg.github.io/surgery-manager/surgery-manager.html";
const ICON_URL = "https://miechankuuchan-jpg.github.io/surgery-manager/icon-192.png";
const ALLOWED_ORIGIN = "https://miechankuuchan-jpg.github.io";
const KINDS = ["prev_day", "op_morning", "pending_tasks", "checklist"];

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Headers": "authorization, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders() });
    }

    const input = await req.json();
    const subscriptionId = String(input.subscription_id || "");
    const jobs = Array.isArray(input.jobs) ? input.jobs : [];
    const userId = String(ctx.userClaims?.sub || "");
    const apiKey = Deno.env.get("ONESIGNAL_REST_API_KEY");

    if (!userId || !apiKey || !subscriptionId || jobs.length > 300) {
      return Response.json({ error: "invalid_request" }, { status: 400, headers: corsHeaders() });
    }

    const { data: existing } = await ctx.supabaseAdmin
      .from("notification_jobs")
      .select("*")
      .eq("user_id", userId)
      .eq("subscription_id", subscriptionId);

    for (const oldJob of existing || []) {
      if (!oldJob.onesignal_message_id) continue;
      await fetch(
        `https://api.onesignal.com/notifications/${oldJob.onesignal_message_id}?app_id=${APP_ID}`,
        { method: "DELETE", headers: { Authorization: `Key ${apiKey}` } },
      );
    }

    await ctx.supabaseAdmin
      .from("notification_jobs")
      .delete()
      .eq("user_id", userId)
      .eq("subscription_id", subscriptionId);

    const titles: Record<string, string> = {
      prev_day: "手術前日の確認",
      op_morning: "手術当日の確認",
      pending_tasks: "未完了タスク",
      checklist: "チェックリスト",
    };
    const bodies: Record<string, string> = {
      prev_day: "明日の手術予定と未完了項目を確認してください",
      op_morning: "本日の手術予定とチェック項目を確認してください",
      pending_tasks: "未完了の確認事項があります",
      checklist: "設定した確認時刻になりました",
    };

    const now = Date.now();
    let scheduled = 0;
    for (const job of jobs) {
      const clientKey = String(job.client_key || "");
      const kind = String(job.kind || "");
      const notifyAt = new Date(String(job.notify_at || ""));
      const delay = notifyAt.getTime() - now;
      if (!clientKey || clientKey.length > 180 || !KINDS.includes(kind)) continue;
      if (!Number.isFinite(notifyAt.getTime()) || delay < 60000 || delay > 2592000000) continue;

      const response = await fetch("https://api.onesignal.com/notifications", {
        method: "POST",
        headers: { Authorization: `Key ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          app_id: APP_ID,
          include_subscription_ids: [subscriptionId],
          target_channel: "push",
          headings: { ja: titles[kind], en: titles[kind] },
          contents: { ja: bodies[kind], en: bodies[kind] },
          send_after: notifyAt.toISOString(),
          web_url: APP_URL,
          chrome_web_icon: ICON_URL,
        }),
      });
      const message = await response.json();
      if (!response.ok || !message.id) continue;

      const { error } = await ctx.supabaseAdmin.from("notification_jobs").insert({
        user_id: userId,
        subscription_id: subscriptionId,
        client_key: clientKey,
        kind,
        notify_at: notifyAt.toISOString(),
        onesignal_message_id: message.id,
        status: "scheduled",
      });
      if (!error) scheduled += 1;
    }

    return Response.json({ ok: true, scheduled }, { headers: corsHeaders() });
  }),
};
