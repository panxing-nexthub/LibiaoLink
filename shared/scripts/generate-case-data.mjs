import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { buildCaseDataOpenApiDocument } from "../src/case-data/openapi.ts";
import { renderArtifacts } from "./lib.mjs";

const directory = new URL("../generated/", import.meta.url);
const openapiFile = "case-data-openapi.json";
const { openapiJson, clientTypes } = await renderArtifacts(
  buildCaseDataOpenApiDocument(), "generate-case-data.mjs", `generated/${openapiFile}`,
);
const artifacts = [[openapiFile, openapiJson], ["case-data-api-types.d.ts", clientTypes]];
if (!process.argv.includes("--check")) mkdirSync(directory, { recursive: true });
for (const [filename, content] of artifacts) {
  const path = new URL(filename, directory);
  if (process.argv.includes("--check")) {
    if (readFileSync(path, "utf8") !== content) throw new Error(`案例数据契约产物漂移：${filename}`);
  } else {
    writeFileSync(path, content, "utf8");
  }
  console.log(filename);
}
