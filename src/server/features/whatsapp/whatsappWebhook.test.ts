import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleWhatsappWebhook } from "./whatsappWebhook";
import { WhatsappService } from "./WhatsappService";
import { getOptionalEnvValue } from "@/server/lib/runtime-env";

vi.mock("@/server/lib/runtime-env", () => ({
  getOptionalEnvValue: vi.fn(),
}));
vi.mock("./WhatsappService", () => ({
  WhatsappService: {
    recordInbound: vi.fn(),
    recordDeliveryStatus: vi.fn(),
  },
}));

const TOKEN = "s3cret-token";

function post(fields: Record<string, string>, token = TOKEN) {
  return new Request(
    `https://seo.deepinsights.space/api/whatsapp/inbound?token=${token}`,
    { method: "POST", body: new URLSearchParams(fields) },
  );
}

beforeEach(() => {
  vi.mocked(getOptionalEnvValue).mockResolvedValue(TOKEN);
  vi.mocked(WhatsappService.recordInbound).mockResolvedValue({ matched: 1 });
});

describe("handleWhatsappWebhook", () => {
  it("refuses a wrong token and records nothing", async () => {
    const response = await handleWhatsappWebhook(
      post({ From: "whatsapp:+971501234567", Body: "hi" }, "wrong"),
    );
    expect(response.status).toBe(403);
    expect(WhatsappService.recordInbound).not.toHaveBeenCalled();
  });

  it("refuses everything while no token is configured", async () => {
    vi.mocked(getOptionalEnvValue).mockResolvedValue(undefined);
    const response = await handleWhatsappWebhook(post({ From: "x" }));
    expect(response.status).toBe(403);
  });

  it("records an inbound message and answers empty TwiML", async () => {
    const response = await handleWhatsappWebhook(
      post({
        From: "whatsapp:+971501234567",
        To: "whatsapp:+14155238886",
        Body: "Go ahead with the Wacom refresh",
        MessageSid: "SM1",
        NumMedia: "0",
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/xml");
    expect(await response.text()).toContain("<Response></Response>");
    expect(WhatsappService.recordInbound).toHaveBeenCalledWith({
      from: "whatsapp:+971501234567",
      to: "whatsapp:+14155238886",
      body: "Go ahead with the Wacom refresh",
      mediaUrl: null,
      messageSid: "SM1",
    });
  });

  it("treats a StatusCallback as a delivery receipt, not a message", async () => {
    await handleWhatsappWebhook(
      post({ MessageSid: "SM1", MessageStatus: "delivered" }),
    );
    expect(WhatsappService.recordDeliveryStatus).toHaveBeenCalledWith({
      messageSid: "SM1",
      status: "delivered",
      errorCode: null,
      errorMessage: null,
    });
    expect(WhatsappService.recordInbound).not.toHaveBeenCalled();
  });

  it("still answers 200 when recording fails, so Twilio does not retry", async () => {
    vi.mocked(WhatsappService.recordInbound).mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await handleWhatsappWebhook(
      post({ From: "whatsapp:+971501234567", Body: "hi" }),
    );
    expect(response.status).toBe(200);
  });
});
