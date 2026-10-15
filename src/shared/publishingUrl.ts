/** Basic-auth publishing credentials must never be sent to an HTTP endpoint. */
export const HTTPS_PUBLISHING_URL_MESSAGE =
  "Use an https:// site URL for publishing. An http:// URL redirects to HTTPS and can drop the WordPress and WooCommerce Authorization header, making valid credentials appear rejected.";

export function isHttpsPublishingUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}
