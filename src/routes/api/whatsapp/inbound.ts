import { createFileRoute } from "@tanstack/react-router";
import { handleWhatsappWebhook } from "@/server/features/whatsapp/whatsappWebhook";

// Twilio posts inbound WhatsApp messages and delivery receipts here. Point the
// number's "When a message comes in" webhook at
// https://seo.deepinsights.space/api/whatsapp/inbound?token=<WHATSAPP_INBOUND_TOKEN>
export const Route = createFileRoute("/api/whatsapp/inbound")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) =>
        handleWhatsappWebhook(request),
    },
  },
});
