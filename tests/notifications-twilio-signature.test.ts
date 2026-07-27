import { describe, expect, it } from "vitest";
import {
  computeTwilioSignature,
  validateTwilioSignature,
} from "@/lib/notifications/twilio-signature";

// Twilio's own documented worked example (from their validation docs), which
// pins the exact algorithm: URL + sorted key/value concatenation, HMAC-SHA1,
// base64.
const AUTH_TOKEN = "12345";
const URL = "https://mycompany.com/myapp.php?foo=1&bar=2";
const PARAMS = {
  Digits: "1234",
  To: "+18005551212",
  From: "+14158675309",
  Caller: "+14158675309",
  CallSid: "CA1234567890ABCDE",
};
const EXPECTED = "RSOYDt4T1cUTdK1PDd93/VVr8B8=";

describe("Twilio signature", () => {
  it("computes the documented reference signature", () => {
    expect(computeTwilioSignature(AUTH_TOKEN, URL, PARAMS)).toBe(EXPECTED);
  });

  it("accepts a correctly signed request", () => {
    expect(validateTwilioSignature(AUTH_TOKEN, URL, PARAMS, EXPECTED)).toBe(true);
  });

  it("rejects a tampered body (a changed param value)", () => {
    const tampered = { ...PARAMS, To: "+19998887777" };
    expect(validateTwilioSignature(AUTH_TOKEN, URL, tampered, EXPECTED)).toBe(false);
  });

  it("rejects a missing or malformed signature", () => {
    expect(validateTwilioSignature(AUTH_TOKEN, URL, PARAMS, null)).toBe(false);
    expect(validateTwilioSignature(AUTH_TOKEN, URL, PARAMS, "not-base64!!")).toBe(false);
  });

  it("rejects when the auth token is wrong", () => {
    expect(validateTwilioSignature("wrong-token", URL, PARAMS, EXPECTED)).toBe(false);
  });
});
