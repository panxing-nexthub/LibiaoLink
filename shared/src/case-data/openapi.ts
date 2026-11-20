import { OpenAPIRegistry, OpenApiGeneratorV31 } from "@asteasolutions/zod-to-openapi";
import { z } from "../zod.ts";
import { CaseAssetDownloadTicketSchema, CaseAssetMediaStateSchema, CaseAssetVersionSchema, CaseCompleteUploadBodySchema,
  CaseCreateUploadBodySchema, CaseSaveAssetMediaBodySchema, CaseUploadedPartsSchema, CaseUploadPartNumberSchema,
  CaseUploadSessionSchema, CaseUploadTargetSchema } from "./asset-requests.ts";
import { CaseAuthoringViewSchema, CaseCreateBodySchema, CaseOperationIdSchema, CaseOperationResultSchema,
  CasePatchBodySchema, CaseUuidSchema } from "./case-requests.ts";
import { ActivateCaseReleaseBodySchema, CaseReleaseHistorySchema, CaseReleaseReceiptSchema, DeactivateCaseReleaseBodySchema,
  PublishedCaseReleaseSchema, StageCaseReleaseBodySchema } from "./release-requests.ts";
import { CaseProjectCatalogPageSchema, CaseProjectCatalogQuerySchema, CaseProjectCatalogItemSchema,
  PatchLocalCaseProjectBodySchema, RegisterLocalCaseProjectBodySchema } from "./project-catalog.ts";
import { CaseProjectProfileViewSchema, CaseSubjectViewSchema, SaveCaseProjectProfileBodySchema,
  SaveCaseSubjectBodySchema } from "./project-data.ts";

export function buildCaseDataOpenApiDocument() {
  const registry = new OpenAPIRegistry();
  registry.registerComponent("securitySchemes", "serviceToken", { type: "http", scheme: "bearer", bearerFormat: "JWT" });
  const gatewayError = z.strictObject({
    code: z.string(), message: z.string(), traceId: z.string(),
    details: z.array(z.object({ code: z.string(), message: z.string(), path: z.string() })),
  }).openapi("CaseDataGatewayError");
  const json = <T extends z.ZodType>(schema: T) => ({ "application/json": { schema } });
  const response = { description: "案例作者视图", content: json(CaseAuthoringViewSchema) };
  const error = (description: string) => ({ description, content: json(gatewayError) });
  const errors = {
    401: error("服务令牌无效"), 403: error("缺少所需 Scope"), 404: error("案例或可选项目不存在"),
    422: error("请求参数或案例字段非法"), 429: error("超过本地请求频率或并发限额"), 500: error("案例请求处理失败"),
    503: error("网关、案例数据库或其他依赖暂不可用，或案例写入受容量限制"),
  };
  const writeErrors = { ...errors, 409: error("操作标识、项目版本或案例版本冲突"), 413: error("请求体过大") };
  const security = [{ serviceToken: [] }];
  const caseParams = z.object({ caseId: CaseUuidSchema });
  registry.registerPath({
    method: "get", path: "/api/v1/projects", operationId: "listCaseProjects", security,
    summary: "查询可选项目目录",
    description: "本地 Scope 为 case-data:projects:read。合并核心只读投影与本地注册项目，包含归档项目；分页游标只能与原筛选条件一起使用。",
    request: { query: CaseProjectCatalogQuerySchema },
    responses: { 200: { description: "核心与本地项目合并的目录分页", content: json(CaseProjectCatalogPageSchema) },
      401: errors[401], 403: errors[403], 422: error("查询参数或游标无效"), 429: errors[429], 503: errors[503] },
  });
  registry.registerPath({
    method: "post", path: "/api/v1/projects", operationId: "registerLocalCaseProject", security,
    summary: "注册本地项目",
    description: "本地 Scope 为 case-data:projects:write。项目仅写入 libiaolink_case，不进入核心库；项目编号在目录可用项范围内跨来源唯一，项目 ID 跨全部核心历史摘要与本地项目唯一。",
    request: { body: { required: true, content: json(RegisterLocalCaseProjectBodySchema) } },
    responses: { 201: { description: "已注册的本地项目目录项", content: json(CaseProjectCatalogItemSchema) },
      ...writeErrors, 409: error("项目编号或项目 ID 已由其他来源占用") },
  });
  registry.registerPath({
    method: "patch", path: "/api/v1/projects/{projectId}", operationId: "patchLocalCaseProject", security,
    summary: "更新或归档本地项目",
    description: "本地 Scope 为 case-data:projects:write。仅能更新 libiaolink_case 中的本地项目，核心投影项目只读。expectedVersion 必须匹配当前 sourceVersion；status=archived 时归档，改回其它状态时解档。",
    request: {
      params: z.object({ projectId: CaseUuidSchema }),
      body: { required: true, content: json(PatchLocalCaseProjectBodySchema) },
    },
    responses: { 200: { description: "更新后的本地项目目录项", content: json(CaseProjectCatalogItemSchema) },
      ...writeErrors, 404: error("本地项目不存在"),
      409: error("项目版本冲突、项目编号冲突、幂等冲突或核心项目只读"),
    },
  });
  const profilePath = "/api/v1/projects/{projectId}/profile";
  const profileParams = z.object({ projectId: CaseUuidSchema });
  const profileView = { description: "案例侧项目补充信息、主体关系和项目成员", content: json(CaseProjectProfileViewSchema) };
  const subjectView = { description: "主体及其别名", content: json(CaseSubjectViewSchema) };
  registry.registerPath({
    method: "get", path: profilePath, operationId: "getCaseProjectProfile", security,
    summary: "读取案例侧项目资料", description: "本地 Scope 为 case-data:project-data:read。",
    request: { params: profileParams }, responses: { 200: profileView, ...errors },
  });
  registry.registerPath({
    method: "put", path: profilePath, operationId: "saveCaseProjectProfile", security,
    summary: "保存案例侧项目资料",
    description: "本地 Scope 为 case-data:project-data:write。核对来源项目版本和案例侧资料版本，按完整清单替换。",
    request: { params: profileParams, body: { required: true, content: json(SaveCaseProjectProfileBodySchema) } },
    responses: { 200: profileView, 201: profileView, ...writeErrors },
  });
  registry.registerPath({
    method: "post", path: "/api/v1/subjects", operationId: "saveCaseSubject", security,
    summary: "按类型和稳定键保存案例主体",
    description: "本地 Scope 为 case-data:project-data:write。新建传 expectedVersion=0，别名按完整清单替换。",
    request: { body: { required: true, content: json(SaveCaseSubjectBodySchema) } },
    responses: { 200: subjectView, 201: subjectView, ...writeErrors },
  });
  registry.registerPath({
    method: "get", path: "/api/v1/subjects/{subjectId}", operationId: "getCaseSubject", security,
    summary: "按主体 ID 读取案例主体", description: "本地 Scope 为 case-data:project-data:read。",
    request: { params: z.object({ subjectId: CaseUuidSchema }) }, responses: { 200: subjectView, ...errors },
  });
  registry.registerPath({
    method: "post", path: "/api/v1/projects/{projectId}/cases", operationId: "createCase", security,
    summary: "创建案例", description: "本地 Scope 为 case-data:cases:write。业务 operationId 通过请求体传递。",
    request: { params: z.object({ projectId: CaseUuidSchema }), body: { required: true, content: json(CaseCreateBodySchema) } },
    responses: { 201: response, ...writeErrors },
  });
  registry.registerPath({
    method: "get", path: "/api/v1/cases/{caseId}", operationId: "getCase", security,
    summary: "读取案例", description: "本地 Scope 为 case-data:cases:read。",
    request: { params: caseParams }, responses: { 200: response, ...errors },
  });
  registry.registerPath({
    method: "patch", path: "/api/v1/cases/{caseId}", operationId: "patchCase", security,
    summary: "更新案例", description: "本地 Scope 为 case-data:cases:write。JSON 对象整列替换。",
    request: { params: caseParams, body: { required: true, content: json(CasePatchBodySchema) } },
    responses: { 200: response, ...writeErrors },
  });
  registry.registerPath({
    method: "get", path: "/api/v1/operations/{operationId}", operationId: "getOperationResult", security,
    summary: "查询已提交的操作结果",
    description: "本地 Scope 为 case-data:operations:read。只返回当前服务身份的记录。原写入 HTTP 状态放在 statusCode。",
    request: { params: z.object({ operationId: CaseOperationIdSchema }) },
    responses: { ...errors, 200: { description: "已提交的原写入结果", content: json(CaseOperationResultSchema) },
      404: error("当前调用方没有已提交的操作结果"), 422: error("操作 ID 或查询参数无效") },
  });
  const assetErrors = { ...errors, 404: error("当前调用方没有此资源或对象版本不存在"),
    409: error("操作冲突、上传尚未就绪或会话已完成"), 410: error("上传会话已过期"),
    503: error("网关、案例数据库或对象存储暂不可用，或素材处理受容量限制") };
  const uploadParams = z.object({ uploadId: CaseUuidSchema });
  registry.registerPath({
    method: "post", path: "/api/v1/cases/{caseId}/uploads", operationId: "createCaseUpload", security,
    summary: "创建素材上传会话",
    description: "本地 Scope 为 case-data:assets:write。提供 assetId 时创建同一素材的新版本。大于 32 MiB 自动进入分片模式。",
    request: { params: caseParams, body: { required: true, content: json(CaseCreateUploadBodySchema) } },
    responses: { ...assetErrors, 413: writeErrors[413],
      201: { description: "新建的上传会话，后续单独签发上传目标", content: json(CaseUploadSessionSchema) } },
  });
  registry.registerPath({
    method: "get", path: "/api/v1/uploads/{uploadId}/target", operationId: "getCaseUploadTarget", security,
    summary: "签发素材上传目标",
    description: "本地 Scope 为 case-data:assets:write。单次 PUT 模式按签名请求头上传并保存 x-amz-version-id。",
    request: { params: uploadParams },
    responses: { ...assetErrors, 200: { description: "最长 120 秒的上传目标", content: json(CaseUploadTargetSchema) } },
  });
  registry.registerPath({
    method: "get", path: "/api/v1/uploads/{uploadId}/parts", operationId: "listCaseUploadedParts", security,
    summary: "查询可续传分片", description: "本地 Scope 为 case-data:assets:write。由对象存储返回已成功上传的分片。",
    request: { params: uploadParams },
    responses: { ...assetErrors, 200: { description: "分片计划与当前上传进度", content: json(CaseUploadedPartsSchema) } },
  });
  registry.registerPath({
    method: "get", path: "/api/v1/uploads/{uploadId}/parts/{partNumber}/target", operationId: "getCaseUploadPartTarget", security,
    summary: "签发指定分片上传目标",
    description: "本地 Scope 为 case-data:assets:write。分片大小固定，尾片按总大小计算，签名最长 120 秒。",
    request: { params: uploadParams.extend({ partNumber: CaseUploadPartNumberSchema }) },
    responses: { ...assetErrors, 200: { description: "指定分片的上传地址和请求头", content: json(CaseUploadTargetSchema) } },
  });
  registry.registerPath({
    method: "post", path: "/api/v1/uploads/{uploadId}/complete", operationId: "completeCaseUpload", security,
    summary: "校验实际对象版本并完成上传",
    description: "本地 Scope 为 case-data:assets:write。单次 PUT 可提交对象版本 ID，丢失 PUT 回执时可省略，由网关按会话键查验唯一版本。分片模式省略该字段，由网关检查与合并分片。两种模式均校验精确版本的大小、MIME 和 SHA-256。",
    request: { params: uploadParams, body: { required: true, content: json(CaseCompleteUploadBodySchema) } },
    responses: { ...assetErrors, 413: writeErrors[413],
      200: { description: "已持久化的素材版本，扫描状态初始为 pending", content: json(CaseAssetVersionSchema) } },
  });
  registry.registerPath({
    method: "get", path: "/api/v1/assets/{assetId}/versions/{assetVersionId}/download-ticket",
    operationId: "getCaseAssetDownloadTicket", security,
    summary: "签发作者素材下载票据",
    description: "本地 Scope 为 case-data:assets:read。票据绑定已登记的对象版本，供当前服务调用方下载。",
    request: { params: z.object({ assetId: CaseUuidSchema, assetVersionId: CaseUuidSchema }) },
    responses: { ...assetErrors, 200: { description: "最长 60 秒的私有版本下载票据", content: json(CaseAssetDownloadTicketSchema) } },
  });
  const mediaPath = "/api/v1/assets/{assetId}/versions/{assetVersionId}";
  const mediaParams = z.object({ assetId: CaseUuidSchema, assetVersionId: CaseUuidSchema });
  const mediaState = { description: "绑定精确对象版本的媒体处理状态", content: json(CaseAssetMediaStateSchema) };
  registry.registerPath({
    method: "get", path: `${mediaPath}/media-input`, operationId: "getCaseMediaInput", security,
    summary: "签发媒体处理输入票据", description: "仅受信媒体服务的 case-data:assets:process Scope 可调用。",
    request: { params: mediaParams },
    responses: { ...assetErrors, 200: { description: "固定对象版本的短时票据", content: json(CaseAssetDownloadTicketSchema) } },
  });
  registry.registerPath({
    method: "get", path: `${mediaPath}/media-state`, operationId: "getCaseMediaState", security,
    summary: "读取媒体处理状态", description: "仅受信媒体服务的 case-data:assets:process Scope 可调用。",
    request: { params: mediaParams }, responses: { ...assetErrors, 200: mediaState },
  });
  registry.registerPath({
    method: "put", path: `${mediaPath}/media-state`, operationId: "saveCaseMediaResult", security,
    summary: "回传媒体处理结果",
    description: "仅受信媒体服务的 case-data:assets:process Scope 可调用。校验媒体版本、对象版本与 SHA-256。",
    request: { params: mediaParams, body: { required: true, content: json(CaseSaveAssetMediaBodySchema) } },
    responses: { ...assetErrors, 413: writeErrors[413], 200: mediaState },
  });
  const releasePath = "/api/v1/cases/{caseId}/releases";
  const releaseParams = z.object({ caseId: CaseUuidSchema, releaseId: CaseUuidSchema });
  const releaseErrors = { ...errors, 404: error("案例或发布版本不存在"),
    503: error("网关、公开读面或对象存储暂不可用，或案例写入受容量限制") };
  const releaseWriteErrors = { ...releaseErrors, 409: error("项目版本、当前发布、状态、素材完整性或操作标识冲突"),
    413: writeErrors[413] };
  const releaseReceipt = { description: "发布版本的技术状态和快照哈希", content: json(CaseReleaseReceiptSchema) };
  registry.registerPath({
    method: "post", path: releasePath, operationId: "stageRelease", security,
    summary: "固化待发布版本", description: "本地 Scope 为 case-data:releases:write。提交已准备好的对外快照与精确素材版本。",
    request: { params: caseParams, body: { required: true, content: json(StageCaseReleaseBodySchema) } },
    responses: { 201: releaseReceipt, ...releaseWriteErrors },
  });
  registry.registerPath({
    method: "post", path: `${releasePath}/{releaseId}/activate`, operationId: "activateRelease", security,
    summary: "激活待发布版本", description: "本地 Scope 为 case-data:releases:write。显式提交 expectedActiveReleaseId 和 approvalRef。",
    request: { params: releaseParams, body: { required: true, content: json(ActivateCaseReleaseBodySchema) } },
    responses: { 200: releaseReceipt, ...releaseWriteErrors },
  });
  registry.registerPath({
    method: "post", path: `${releasePath}/{releaseId}/deactivate`, operationId: "deactivateRelease", security,
    summary: "撤回当前 active 版本", description: "本地 Scope 为 case-data:releases:write。撤回后历史快照和素材引用继续保留。",
    request: { params: releaseParams, body: { required: true, content: json(DeactivateCaseReleaseBodySchema) } },
    responses: { 200: releaseReceipt, ...releaseWriteErrors },
  });
  registry.registerPath({
    method: "get", path: `${releasePath}/{releaseId}`, operationId: "getCaseReleaseHistory", security,
    summary: "读取作者发布历史", description: "本地 Scope 为 case-data:releases:history:read。",
    request: { params: releaseParams },
    responses: { 200: { description: "冻结快照和原始素材引用", content: json(CaseReleaseHistorySchema) }, ...releaseErrors },
  });
  const publishedPath = "/api/v1/public/cases/{caseId}/releases/{releaseId}";
  const publishedErrors = { ...releaseErrors, 404: error("当前没有对应的 active 版本或素材") };
  registry.registerPath({
    method: "get", path: publishedPath, operationId: "getPublishedCaseRelease", security,
    summary: "读取 active 发布快照", description: "本地 Scope 为 case-data:releases:read。按案例和发布 ID 精确查找。",
    request: { params: releaseParams },
    responses: { 200: { description: "active 快照和已锁定素材版本", content: json(PublishedCaseReleaseSchema) },
      ...publishedErrors },
  });
  registry.registerPath({
    method: "get", path: `${publishedPath}/assets/{assetVersionId}/content`, operationId: "getPublishedCaseAsset", security,
    summary: "读取 active 发布的锁定素材", description: "本地 Scope 为 case-data:releases:read。每次请求重新核对发布状态。",
    request: { params: releaseParams.extend({ assetVersionId: CaseUuidSchema }) },
    responses: { 200: { description: "精确对象版本的文件流",
      content: { "application/octet-stream": { schema: { type: "string", format: "binary" } } } }, ...publishedErrors },
  });
  return new OpenApiGeneratorV31(registry.definitions).generateDocument({
    openapi: "3.1.0", info: { title: "LibiaoLink 案例数据网关本地联调", version: "1.6.0" },
  });
}
