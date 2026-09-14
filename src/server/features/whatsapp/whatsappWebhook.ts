import { getOptionalEnvValue } from "@/server/lib/runtime-env";
import { WhatsappService } from "./WhatsappService";

/**
 * Twilio's webhook for the WhatsApp number, serving two kinds of call on one URL:
 *
 *   inbound message    From, To, Body, MessageSid, NumMedia, MediaUrl0…
 *   delivery status    MessageSid, MessageStatus, ErrorCode (from StatusCallback)
 *
 * Auth is the ?token= query value, compared in constant time against
 * WHATSAPP_INBOUND_TOKEN. A wrong token is refused; everything after that
 * answers 200 with empty TwiML, including our own failures, because a non-200
 * makes Twilio retry and log errors against the number, and a retry cannot fix
 * a bug on this side.
 */

const EMPTY_TWIML =
  '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

const twiml = () =>
  new Response(EMPTY_TWIML, {
    status: 200,
    headers: { "content-type": "text/xml" },
  });

function tokensEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  let diff = left.length ^ right.length;
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return diff === 0;
}

export async function handleWhatsappWebhook(request: Request): Promise<Response> {
  const expected = (await getOptionalEnvValue("WHATSAPP_INBOUND_TOKEN"))?.trim();
  const presented = new URL(request.url).searchParams.get("token") ?? "";
  if (!expected || !tokensEqual(presented, expected)) {
    return new Response("Forbidden", { status: 403 });
  }

  try {
    const form = await request.formData();
    const field = (name: string) => {
      const value = form.get(name);
      return typeof value === "string" && value.trim() ? value.trim() : null;
    };

    const messageSid = field("MessageSid");
    const deliveryStatus = field("MessageStatus");

    if (deliveryStatus && messageSid) {
      await WhatsappService.recordDeliveryStatus({
        messageSid,
        status: deliveryStatus,
        errorCode: field("ErrorCode"),
        errorMessage: field("ErrorMessage"),
      });
      return twiml();
    }

    const from = field("From");
    if (!from) return twiml();

    const mediaCount = Number(field("NumMedia") ?? "0");
    const { matched } = await WhatsappService.recordInbound({
      from,
      to: field("To") ?? "",
      body: field("Body") ?? (mediaCount > 0 ? "[media]" : ""),
      mediaUrl: mediaCount > 0 ? field("MediaUrl0") : null,
      messageSid,
    });
    if (matched === 0) {
      console.warn("[whatsapp] inbound from a number that is not a recipient; ignored");
    }
  } catch (error) {
    console.error("[whatsapp] inbound webhook failed:", error);
  }

  return twiml();
}
