import { describe, expect, it } from "vitest";
import {
  formatBaseUnitsToUsdc,
  formatLamportsToSol,
  parseSolToLamports,
  parseUsdcToBaseUnits,
  MoneyParseError,
  formatAmountWithSymbol,
} from "./money";

describe("SOL <-> lamports", () => {
  it("parses whole and fractional SOL without float error", () => {
    expect(parseSolToLamports("1")).toBe(1_000_000_000n);
    expect(parseSolToLamports("0.1")).toBe(100_000_000n);
    expect(parseSolToLamports("0.000000001")).toBe(1n);
    expect(parseSolToLamports("1.5")).toBe(1_500_000_000n);
  });

  it("round-trips", () => {
    expect(formatLamportsToSol(1_500_000_000n)).toBe("1.5");
    expect(formatLamportsToSol(1n)).toBe("0.000000001");
    expect(formatLamportsToSol(1_000_000_000n)).toBe("1");
    expect(formatLamportsToSol(0n)).toBe("0");
  });

  it("rejects too many decimals", () => {
    expect(() => parseSolToLamports("0.0000000001")).toThrow(MoneyParseError);
  });

  it("rejects garbage", () => {
    expect(() => parseSolToLamports("abc")).toThrow(MoneyParseError);
    expect(() => parseSolToLamports("")).toThrow(MoneyParseError);
    expect(() => parseSolToLamports("-1")).toThrow(MoneyParseError);
  });
});

describe("USDC <-> base units", () => {
  it("parses 6-decimal USDC", () => {
    expect(parseUsdcToBaseUnits("1")).toBe(1_000_000n);
    expect(parseUsdcToBaseUnits("25.5")).toBe(25_500_000n);
    expect(parseUsdcToBaseUnits("0.000001")).toBe(1n);
  });

  it("formats base units", () => {
    expect(formatBaseUnitsToUsdc(25_500_000n)).toBe("25.5");
    expect(formatBaseUnitsToUsdc(1_000_000n)).toBe("1");
  });

  it("rejects > 6 decimals", () => {
    expect(() => parseUsdcToBaseUnits("0.0000001")).toThrow(MoneyParseError);
  });
});

describe("display helpers", () => {
  it("adds symbol", () => {
    expect(formatAmountWithSymbol("SOL", 1_500_000_000n)).toBe("1.5 SOL");
    expect(formatAmountWithSymbol("USDC", 25_000_000n)).toBe("25 USDC");
  });
});

describe("no float anywhere", () => {
  it("0.1 + 0.2 style sums are exact via bigint", () => {
    const a = parseSolToLamports("0.1");
    const b = parseSolToLamports("0.2");
    expect(formatLamportsToSol(a + b)).toBe("0.3");
  });
});
