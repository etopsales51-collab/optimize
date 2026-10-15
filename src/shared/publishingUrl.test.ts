import { describe, expect, it } from "vitest";
import { isHttpsPublishingUrl } from "./publishingUrl";

describe("publishing site URL", () => {
  it("accepts an HTTPS WordPress site", () => {
    expect(isHttpsPublishingUrl("https://timeattendance.ae")).toBe(true);
  });

  it("rejects an HTTP URL that would redirect and lose Basic auth", () => {
    expect(isHttpsPublishingUrl("http://timeattendance.ae")).toBe(false);
  });

  it("rejects malformed and non-HTTP URLs", () => {
    expect(isHttpsPublishingUrl("not-a-url")).toBe(false);
    expect(isHttpsPublishingUrl("ftp://timeattendance.ae")).toBe(false);
  });
});
