import { describe, expect, it } from "vitest";
import {
  findSensitive,
  ibanValid,
  luhnValid,
  type SensitiveKind,
} from "../../src/features/redact/sensitive-patterns";

const VISA = "4111 1111 1111 1111";
const ALL: SensitiveKind[] = ["email", "phone", "ssn", "card", "iban", "date"];
const found = (text: string, kinds: SensitiveKind[] = ALL) =>
  findSensitive(text, kinds).map((match) => [match.kind, match.text]);

describe("sensitive data patterns", () => {
  it("finds each kind with its exact extent", () => {
    expect(
      found(
        "Write to jane.doe+x@example.co.uk. Call +44 20 7946 0958 or (555) 123-4567. " +
          "SSN 123-45-6789. Card 5555-5555-5555-4444. IBAN DE89 3704 0044 0532 0130 00. " +
          "Due 2026-10-06, 6/10/26, October 6th, 2026 and 6 Oct 2026.",
      ),
    ).toEqual([
      ["email", "jane.doe+x@example.co.uk"],
      ["phone", "+44 20 7946 0958"],
      ["phone", "(555) 123-4567"],
      ["ssn", "123-45-6789"],
      ["card", "5555-5555-5555-4444"],
      ["iban", "DE89 3704 0044 0532 0130 00"],
      ["date", "2026-10-06"],
      ["date", "6/10/26"],
      ["date", "October 6th, 2026"],
      ["date", "6 Oct 2026"],
    ]);
  });

  it("rejects look-alikes that fail checksums or ranges", () => {
    expect(found("Order 4111111111111112, SSN 000-12-3456 and 666-12-3456")).toEqual([]);
    expect(found("IBAN GB82 WEST 1234 5698 7654 33")).toEqual([]);
    expect(found("user@localhost and @handle and a@b")).toEqual([]);
    expect(found("Invoice 5551234567, part 12345")).toEqual([]);
    expect(found("(12345678901 not a phone", ["phone"])).toEqual([]);
  });

  it("prefers the more specific kind where matches overlap and honors the chosen kinds", () => {
    expect(found(VISA)).toEqual([["card", VISA]]);
    expect(found(VISA, ["phone"])).toEqual([]);
    expect(found("mail a@example.com on 2026-01-02", ["date"])).toEqual([["date", "2026-01-02"]]);
  });

  it("validates Luhn and IBAN checksums", () => {
    expect(luhnValid("79927398713")).toBe(true);
    expect(luhnValid("79927398710")).toBe(false);
    expect(luhnValid("")).toBe(false);
    expect(ibanValid("GB82WEST12345698765432")).toBe(true);
    expect(ibanValid("gb82 west 1234 5698 7654 32")).toBe(true);
    expect(ibanValid("GB82WEST1234569876543X")).toBe(false);
    expect(ibanValid("GB82")).toBe(false);
  });
});
