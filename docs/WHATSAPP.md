# WhatsApp — team alerts and approvals

Deep Insights messages the people who run the sites, not customers. It pushes
SEO alerts from every project to one team channel; the team replies; Grok reads
the thread over MCP, plans, files work in Optimize and asks for approval there.

Page: **Content → WhatsApp** in any project (owners and admins only). The
channel is organization-wide; the page toggles between *All projects* and
*This project*.

## What sends a message

One message per event. Minor movements send nothing.

| Alert | When |
|---|---|
| Keyword drop | A rank check finds a top-20 keyword that left the results, fell off page one, or lost 3+ places since the previous check |
| Audit | A site audit finishes with critical issues (warnings stay in the app) |
| Needs approval | An agent submits or resubmits an Optimize recommendation |
| Published / Publish failed | Approved work is published, or publishing fails |

Every alert has a dedupe key, so retries and re-runs never send twice. Grok can
also send a message with `send_whatsapp_message` (progress, a plan, an approval
link) and read replies with `list_whatsapp_messages`. Approval itself only
happens in the app.

## Going live

Works with nothing configured: alerts are kept on the page with status
`not_sent`. To connect, add these on Railway (service **optimize** → Variables):

| Variable | Value |
|---|---|
| `TWILIO_ACCOUNT_SID` | From the Twilio console |
| `TWILIO_AUTH_TOKEN` | From the Twilio console |
| `TWILIO_WHATSAPP_FROM` | The WhatsApp sender, e.g. `+14155238886` |
| `WHATSAPP_INBOUND_TOKEN` | Any long random string |
| `TWILIO_ALERT_TEMPLATE_SID` | Optional. An approved Content Template (`HX…`) with one variable `{{1}}` |

Then in Twilio, set the number's **When a message comes in** webhook (POST) to:

```
https://seo.deepinsights.space/api/whatsapp/inbound?token=<WHATSAPP_INBOUND_TOKEN>
```

Delivery receipts come back to the same URL automatically.

Add yourself and your manager on the WhatsApp page (Manage → name + number with
country code).

## The 24-hour rule

WhatsApp only lets a business send free-form text to someone who messaged it in
the last 24 hours. Replying to any alert reopens that window. Outside it, alerts
need `TWILIO_ALERT_TEMPLATE_SID`; without one, Twilio rejects the message and the
reason (error 63016) is shown on that message in the app. With the Twilio
sandbox, each person must first send the sandbox join code.
