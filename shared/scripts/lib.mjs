import openapiTS, { astToString } from "openapi-typescript";
import { buildOpenApiDocument } from "../src/openapi.ts";

export const OPENAPI_FILE = "generated/openapi.json";
export const CLIENT_FILE = "generated/api-types.d.ts";

const clientHeader = (generator, openapiFile) => [
  "/**",
  ` * 本文件由 shared/scripts/${generator} 生成，禁止手改（CONTRIBUTING 第 14 节）。`,
  ` * 源：shared/src 下的 Zod schema → ${openapiFile} → 本文件。`,
  " */",
  "",
].join("\n");

export async function renderArtifacts(doc = buildOpenApiDocument(), generator = "generate.mjs", openapiFile = OPENAPI_FILE) {
  const openapiJson = JSON.stringify(doc, null, 2) + "\n";
  const ast = await openapiTS(doc);
  const clientTypes = clientHeader(generator, openapiFile) + astToString(ast);
  return { doc, openapiJson, clientTypes };
}
