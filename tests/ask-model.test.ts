import { describe, expect, test } from "bun:test";
import { modelLibURLPrefix, prebuiltAppConfig } from "@mlc-ai/web-llm";
import { LOCAL_MODELS, coerceIntent, compactPrompt, intentSchema, localQuestion, resolveCountries } from "../src/shared/nl/model.ts";
import { emptyIntent } from "../src/shared/query.ts";
import { upstreamFor } from "../src/server/routes/llm.ts";
import { catalog } from "./ask-parse.test.ts";

const YEAR = 2026;

describe("in-browser model prompt", () => {
  const prompt = compactPrompt(catalog, YEAR);

  test("names every measure but no country list", () => {
    for (const m of catalog.measures) expect(prompt).toContain(`- ${m.id}:`);
    expect(prompt).not.toContain("PAK");
    expect(prompt).not.toContain("Pakistan");
  });

  test("fits a 4,096-token context with room for a session of questions", () => {
    // ~3.5 characters per token for this text; the real catalog's labels are about as long.
    expect(prompt.length / 3.5).toBeLessThan(2_600);
  });

  test("its examples only use measures and fields that exist", () => {
    const fields = new Set(Object.keys(intentSchema(catalog).properties));
    const examples = [...prompt.matchAll(/→ (\{.*\})$/gm)].map((m) => JSON.parse(m[1]!) as Record<string, unknown>);
    expect(examples.length).toBeGreaterThan(5);
    for (const e of examples) {
      for (const k of Object.keys(e)) expect(fields.has(k)).toBe(true);
      for (const k of intentSchema(catalog, { brief: true }).required) expect(k in e).toBe(true);
      for (const id of (e.measures as string[]) ?? []) expect(catalog.measures.some((m) => m.id === id)).toBe(true);
    }
  });

  test("the question's turn names the countries the parser recognised", () => {
    expect(localQuestion("floods in Pakistan", catalog, YEAR)).toContain("Countries recognised in it: PAK Pakistan.");
    expect(localQuestion("global temperature", catalog, YEAR)).toContain("Countries recognised in it: none.");
  });
});

describe("in-browser model reply", () => {
  test("the brief schema requires the five fields nearly every question uses; the full one everything", () => {
    expect(intentSchema(catalog, { brief: true }).required).toEqual(["kind", "measures", "countries", "from", "to"]);
    const full = intentSchema(catalog);
    expect(new Set(full.required)).toEqual(new Set(Object.keys(full.properties)));
  });

  test("a brief reply is filled in with the defaults", () => {
    expect(coerceIntent({ kind: "map", measures: ["action.solar"] })).toEqual({ ...emptyIntent(), kind: "map", measures: ["action.solar"] });
  });

  test("country codes are checked against the catalog; names are read by the parser", () => {
    const i = resolveCountries({ ...emptyIntent(), countries: ["DEU", "PAKISTAN", "XYZ", "DEU", "WLD"] }, catalog, YEAR);
    expect(i.countries).toEqual(["DEU", "PAK", "WLD"]);
  });
});

describe("model file proxy", () => {
  const id = LOCAL_MODELS[0].id;

  test("only the offered models' files, one level deep", () => {
    expect(upstreamFor("hf", `mlc-ai/${id}/resolve/main/tensor-cache.json`)).toBe(`https://huggingface.co/mlc-ai/${id}/resolve/main/tensor-cache.json`);
    expect(upstreamFor("hf", `mlc-ai/${id}/resolve/main/params_shard_3.bin`)).not.toBeNull();
    expect(upstreamFor("hf", "mlc-ai/Some-Other-Model-MLC/resolve/main/tensor-cache.json")).toBeNull();
    expect(upstreamFor("hf", `someone/${id}/resolve/main/tensor-cache.json`)).toBeNull();
    expect(upstreamFor("hf", `mlc-ai/${id}/resolve/main/../../x`)).toBeNull();
    expect(upstreamFor("hf", `mlc-ai/${id}/resolve/main/..`)).toBeNull();
    expect(upstreamFor("hf", `mlc-ai/${id}/resolve/other/tensor-cache.json`)).toBeNull();
  });

  test("only WebGPU kernels from the model-library repo", () => {
    expect(upstreamFor("lib", "v0_2_87/base/Qwen2-1.5B-Instruct-q4f16_1_cs1k-webgpu.wasm")).toBe(`${modelLibURLPrefix}v0_2_87/base/Qwen2-1.5B-Instruct-q4f16_1_cs1k-webgpu.wasm`);
    expect(upstreamFor("lib", "v0_2_87/base/x.js")).toBeNull();
    expect(upstreamFor("lib", "v0_2_87/../../x-webgpu.wasm")).toBeNull();
  });

  test("every offered model is in this WebLLM version, at the URLs the proxy allows", () => {
    for (const { id } of LOCAL_MODELS) {
      const record = prebuiltAppConfig.model_list.find((m) => m.model_id === id);
      expect(record?.model).toBe(`https://huggingface.co/mlc-ai/${id}`);
      expect(record!.model_lib.startsWith(modelLibURLPrefix)).toBe(true);
      expect(upstreamFor("lib", record!.model_lib.slice(modelLibURLPrefix.length))).not.toBeNull();
    }
  });
});
