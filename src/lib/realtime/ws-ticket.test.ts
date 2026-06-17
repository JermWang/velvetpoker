import { describe, it, expect } from "vitest";
import { signWsTicket, verifyWsTicket } from "./ws-ticket";

describe("ws ticket", () => {
  it("round-trips the bound userId", () => {
    const t = signWsTicket("cuid_alice_123");
    expect(verifyWsTicket(t)).toBe("cuid_alice_123");
  });

  it("rejects an expired ticket", () => {
    const t = signWsTicket("cuid_alice_123", -1); // already expired
    expect(verifyWsTicket(t)).toBeNull();
  });

  it("rejects a tampered signature", () => {
    const t = signWsTicket("cuid_alice_123");
    const tampered = t.slice(0, -3) + (t.slice(-3) === "AAA" ? "BBB" : "AAA");
    expect(verifyWsTicket(tampered)).toBeNull();
  });

  it("cannot be re-pointed to a different userId without re-signing", () => {
    const t = signWsTicket("alice");
    const [, exp, sig] = Buffer.from(t, "base64url").toString("utf8").split(":");
    const forged = Buffer.from(`bob:${exp}:${sig}`, "utf8").toString("base64url");
    expect(verifyWsTicket(forged)).toBeNull();
  });

  it("rejects garbage", () => {
    expect(verifyWsTicket("")).toBeNull();
    expect(verifyWsTicket("not-a-ticket")).toBeNull();
  });
});
