import { getOptionalEnvValue } from "@/server/lib/runtime-env";

/**
 * Twilio's WhatsApp API, reduced to the one call this app makes.
 *
 * Every credential is optional. The module is built to run with none of them —
 * alerts are still recorded in the app — and to light up when they are added
 * on Railway, with no code change on the day.
 */

export type TwilioConfig = {
  accountSid: string;
  authToken: string;
  /** Digits only, e.g. 14155238886. */
  from: string;
  /** Content Template SID (HX...) for messages outside WhatsApp's 24-hour window. */
  templateSid: string | null;
  inboundToken: string | null;
  /** Public origin of this app, for status callbacks and deep links. */
  publicBaseUrl: string | null;
};

export const REQUIRED_SECRETS = [
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_WHATSAPP_FROM",
] as const;

export async function readTwilioConfig(): Promise<
  { ok: true; config: TwilioConfig } | { ok: false; missing: string[] }
> {
  const [accountSid, authToken, fromRaw, templateSid, inboundToken, baseUrl] =
    await Promise.all([
      getOptionalEnvValue("TWILIO_ACCOUNT_SID"),
      getOptionalEnvValue("TWILIO_AUTH_TOKEN"),
      getOptionalEnvValue("TWILIO_WHATSAPP_FROM"),
      getOptionalEnvValue("TWILIO_ALERT_TEMPLATE_SID"),
      getOptionalEnvValue("WHATSAPP_INBOUND_TOKEN"),
      getOptionalEnvValue("BETTER_AUTH_URL"),
    ]);

  const from = fromRaw?.replace(/\D/g, "") ?? "";
  const missing = [
    accountSid ? null : "TWILIO_ACCOUNT_SID",
    authToken ? null : "TWILIO_AUTH_TOKEN",
    from ? null : "TWILIO_WHATSAPP_FROM",
  ].filter((name): name is string => name !== null);

  if (!accountSid || !authToken || !from) return { ok: false, missing };

  return {
    ok: true,
    config: {
      accountSid,
      authToken,
      from,
      templateSid: templateSid?.trim() || null,
      inboundToken: inboundToken?.trim() || null,
      publicBaseUrl: baseUrl?.trim().replace(/\/+$/, "") || null,
    },
  };
}

/** Public app origin for deep links in alerts, independent of Twilio being set up. */
export async function publicBaseUrl(): Promise<string | null> {
  const value = await getOptionalEnvValue("BETTER_AUTH_URL");
  return value?.trim().replace(/\/+$/, "") || null;
}

export type TwilioSendResult =
  | { ok: true; sid: string; status: string }
  | { ok: false; error: string };

export async function sendWhatsapp(
  config: TwilioConfig,
  input: { to: string; body: string; mode: "freeform" | "template" },
): Promise<TwilioSendResult> {
  const form = new URLSearchParams({
    From: `whatsapp:+${config.from}`,
    To: `whatsapp:+${input.to}`,
  });

  if (input.mode === "template" && config.templateSid) {
    // The alert template carries one variable: the whole alert text.
    form.set("ContentSid", config.templateSid);
    form.set("ContentVariables", JSON.stringify({ "1": input.body }));
  } else {
    form.set("Body", input.body);
  }

  // Delivery receipts come back to the same token-guarded webhook.
  if (config.publicBaseUrl && config.inboundToken) {
    form.set(
      "StatusCallback",
      `${config.publicBaseUrl}/api/whatsapp/inbound?token=${encodeURIComponent(config.inboundToken)}`,
    );
  }

  let response: Response;
  try {
    response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(config.accountSid)}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${btoa(`${config.accountSid}:${config.authToken}`)}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: form,
        signal: AbortSignal.timeout(20_000),
      },
    );
  } catch {
    return { ok: false, error: "Could not reach Twilio." };
  }

  const payload = (await response.json().catch(() => ({}))) as {
    sid?: string;
    status?: string;
    message?: string;
    code?: number;
  };

  if (!response.ok || !payload.sid) {
    // Twilio's own sentence is the useful part; 63016 is the one people hit.
    const hint =
      payload.code === 63016
        ? " The person has not messaged this number in the last 24 hours, so WhatsApp needs an approved template (set TWILIO_ALERT_TEMPLATE_SID) or a message from them first."
        : "";
    return {
      ok: false,
      error: `${payload.message ?? `Twilio returned ${response.status}.`}${hint}`,
    };
  }

  return { ok: true, sid: payload.sid, status: payload.status ?? "queued" };
}
