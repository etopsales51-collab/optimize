import { parse } from "@wordpress/block-serialization-default-parser";
import { describe, expect, it } from "vitest";
import { emptyOptimizePageDocument } from "@/shared/pageEditor";
import {
  countHeadings,
  serializePageDocument,
  validatePageDocument,
} from "./gutenberg";

function validDocument() {
  const document = emptyOptimizePageDocument();
  document.title = "ZKTeco attendance systems";
  document.slug = "zkteco-attendance-systems";
  document.h1 = "ZKTeco Attendance Systems";
  document.intro =
    '<p>Choose the <a href="https://timeattendance.ae/products">right device</a> for your team.</p>';
  document.summary = ["Fast setup", "Clear reports", "Local support"];
  for (let index = 0; index < 4; index += 1) {
    document.sections[index] = {
      heading: `Capability ${index + 1}`,
      body: `<p>Details for capability <strong>${index + 1}</strong>.</p>`,
      image: null,
    };
  }
  return document;
}

describe("Optimize Page v1 Gutenberg document", () => {
  it("serializes independent core blocks with one H1 and unique slot metadata", () => {
    const first = validDocument();
    const second = validDocument();
    second.h1 = "A Different Page";
    second.sections[0].heading = "Different capability";
    const one = serializePageDocument(first, "https://timeattendance.ae");
    const two = serializePageDocument(second, "https://timeattendance.ae");

    expect(one).not.toContain("wp:block");
    expect(two).not.toContain(first.h1);
    expect(countHeadings(one)).toMatchObject({ h1: 1 });
    expect(
      parse(one)
        .filter((block) => block.blockName)
        .every((block) => block.blockName === "core/group"),
    ).toBe(true);
    expect(one).toContain('"anchor":"slot-h1"');
    expect(one).toContain('"name":"slot-section-4-body-content"');
  });

  it("omits empty optional slots and materializes populated optional content", () => {
    const document = validDocument();
    const empty = serializePageDocument(document);
    expect(empty).not.toContain("slot-hero-image");
    expect(empty).not.toContain("slot-section-5");
    expect(empty).not.toContain("slot-table");
    expect(empty).not.toContain("slot-faq");
    expect(empty).not.toContain("slot-cta");

    document.sections[4] = {
      heading: "Deployment options",
      body: "<p>Cloud and on-premise options.</p>",
      image: null,
    };
    expect(serializePageDocument(document)).toContain('id="slot-section-5"');
  });

  it("uses WordPress media IDs and preserves inline spaces", () => {
    const document = validDocument();
    document.heroImage = {
      id: 134,
      url: "https://timeattendance.ae/wp-content/uploads/speedface.jpg",
      alt: "ZKTeco SpeedFace V5 terminal",
      caption: "SpeedFace V5",
    };
    const content = serializePageDocument(
      document,
      "https://timeattendance.ae",
    );
    expect(content).toContain('"id":134');
    expect(content).toContain("wp-image-134");
    expect(content).toContain("Choose the <a");
    expect(content).toContain("</a> for your team.");
  });

  it("rejects repeated H2s, headings in bodies, incomplete FAQs, and missing required sections", () => {
    const document = validDocument();
    document.sections[1].heading = document.sections[0].heading;
    document.sections[2].body = "<h3>Not allowed</h3><p>Body</p>";
    document.sections[3].body = "";
    document.faqHeading = "Questions";
    document.faqs = [{ question: "Which device?", answer: "" }];
    const result = validatePageDocument(document);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        "Section H2 headings must be unique.",
        "Section 3 body cannot contain headings.",
        "Section 4 needs an H2 and body.",
        "Every FAQ question needs an answer and every answer needs a question.",
      ]),
    );
  });
});
