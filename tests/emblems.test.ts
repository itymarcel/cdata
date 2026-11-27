import { describe, expect, test } from "bun:test";
import { iso3ToIso2 } from "../src/shared/iso.ts";
import { baseName, nameVariants } from "../src/server/sources/producer-identity.ts";
import { initials } from "../src/client/features/industry/ProducerLogo.tsx";

describe("iso3ToIso2", () => {
  test("maps countries, including ones whose codes differ", () => {
    expect(iso3ToIso2("USA")).toBe("us");
    expect(iso3ToIso2("GBR")).toBe("gb");
    expect(iso3ToIso2("DEU")).toBe("de");
    expect(iso3ToIso2("XKX")).toBe("xk");
  });
  test("returns null for aggregates", () => {
    expect(iso3ToIso2("WLD")).toBeNull();
    expect(iso3ToIso2("OWID_EU27")).toBeNull();
  });
});

describe("producer names", () => {
  test("baseName drops the period and commodity suffix", () => {
    expect(baseName("China (Coal, 1945-2004)")).toBe("China");
    expect(baseName("Rio Tinto (1959-2018)")).toBe("Rio Tinto");
    expect(baseName("Polska Grupa Gornicza (PGG)")).toBe("Polska Grupa Gornicza");
  });
  test("nameVariants tries the full corporate name", () => {
    expect(nameVariants("Chevron")).toEqual(["Chevron", "Chevron Corporation"]);
    expect(nameVariants("Kuwait Petroleum Corp.")).toEqual(["Kuwait Petroleum Corp.", "Kuwait Petroleum Corporation"]);
    expect(nameVariants("Inner Mongolia Yitai Group")).toEqual(["Inner Mongolia Yitai Group"]);
  });
  test("initials for the fallback badge", () => {
    expect(initials("Saudi Aramco")).toBe("SA");
    expect(initials("BP")).toBe("BP");
    expect(initials("Gazprom")).toBe("G");
    expect(initials("Former Soviet Union (1900-1991)")).toBe("FS");
  });
});
