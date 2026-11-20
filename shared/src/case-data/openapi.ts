import { OpenAPIRegistry, OpenApiGeneratorV31 } from "@asteasolutions/zod-to-openapi";
import { z } from "../zod.ts";
import { CaseAssetDownloadTicketSchema, CaseAssetLinkBodySchema, CaseAssetLinkViewSchema, CaseAssetListQuerySchema, CaseAssetListSchema,
  CaseAssetMediaStateSchema, CaseAssetPatchBodySchema, CaseAssetPreviewTicketSchema, CaseAssetSummarySchema,
  CaseAssetVersionListSchema, CaseAssetVersionViewSchema, CaseCompleteUploadBodySchema, CaseCreateUploadBodySchema,
  CaseSaveAssetMediaBodySchema, CaseUploadedPartsSchema, CaseUploadPartNumberSchema, CaseUploadSessionSchema,
  CaseUploadTargetSchema } from "./asset-requests.ts";
import { CaseAuthoringViewSchema, CaseCreateBodySchema, CaseListPageSchema, CaseListQuerySchema,
  CaseOperationIdSchema, CaseOperationResultSchema, CasePatchBodySchema, CaseRestoreVersionBodySchema,
  CaseTranslationsSchema, CaseUuidSchema, CaseVersionListQuerySchema, CaseVersionPageSchema,
  CaseVersionSchema } from "./case-requests.ts";
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
  registry.registerPath({
    method: "get", path: "/api/v1/projects/{projectId}", operationId: "getCaseProject", security,
    summary: "按 ID 读取可选项目目录项",
    description: "本地 Scope 为 case-data:projects:read。返回项与 GET /api/v1/projects 列表项逐字段一致；核心投影和本地项目走同一合并口径，删除或源缺失项目返回 404。",
    request: { params: z.object({ projectId: CaseUuidSchema }) },
    responses: { 200: { description: "与项目目录列表完全一致的项目项", content: json(CaseProjectCatalogItemSchema) },
      401: errors[401], 403: errors[403], 404: errors[404], 422: errors[422], 429: errors[429], 503: errors[503] },
  });
  const projectCasePath = "/api/v1/projects/{projectId}/cases";
  const projectCaseParams = z.object({ projectId: CaseUuidSchema });
  registry.registerPath({
    method: "get", path: projectCasePath, operationId: "listCaseProjectCases", security,
    summary: "分页查询项目下案例",
    description: "本地 Scope 为 case-data:cases:read。支持 status、keyword、updatedAfter 和 limit/cursor；默认排除已软删除案例，状态由删除、归档、active release 与 reviewStatus 依次派生。",
    request: { params: projectCaseParams, query: CaseListQuerySchema },
    responses: { 200: { description: "项目案例分页", content: json(CaseListPageSchema) },
      401: errors[401], 403: errors[403], 404: errors[404], 422: error("路径、筛选或游标无效"),
      429: errors[429], 503: errors[503] },
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
    method: "post", path: projectCasePath, operationId: "createCase", security,
    summary: "创建案例",
    description: "本地 Scope 为 case-data:cases:write。可预生成 caseId；同一语言的多个案例通过 translationGroupId 聚合，每个 locale 独立编辑、审核和发布。请求必须匹配项目当前 sourceVersion，创建时写入不可变 v1 版本快照。",
    request: { params: projectCaseParams, body: { required: true, content: json(CaseCreateBodySchema) } },
    responses: { 201: response, ...writeErrors },
  });
  registry.registerPath({
    method: "get", path: "/api/v1/cases/{caseId}", operationId: "getCase", security,
    summary: "读取案例",
    description: "本地 Scope 为 case-data:cases:read。返回当前可编辑正文、版本号、语言组、审核镜像字段、派生状态和 active release ID。",
    request: { params: caseParams }, responses: { 200: response, ...errors },
  });
  registry.registerPath({
    method: "patch", path: "/api/v1/cases/{caseId}", operationId: "patchCase", security,
    summary: "更新、归档、软删除或恢复案例",
    description: "本地 Scope 为 case-data:cases:write。content/solutionParameters/outcomes/confidentiality 为整列替换；archived/deleted 切换软状态，删除不影响历史 release。仅实际变化时 rowVersion 递增并写入新版本；locale 和 translationGroupId 不可改。",
    request: { params: caseParams, body: { required: true, content: json(CasePatchBodySchema) } },
    responses: { 200: response, ...writeErrors },
  });
  const caseVersionPath = "/api/v1/cases/{caseId}/versions";
  const caseVersionParams = z.object({ caseId: CaseUuidSchema, versionId: CaseUuidSchema });
  registry.registerPath({
    method: "get", path: caseVersionPath, operationId: "listCaseVersions", security,
    summary: "分页读取案例版本历史",
    description: "本地 Scope 为 case-data:cases:read。每项包含不可变标题、摘要、正文、方案参数、成果、保密设置和变更摘要；按 versionNo 倒序分页。",
    request: { params: caseParams, query: CaseVersionListQuerySchema },
    responses: { 200: { description: "案例版本快照分页", content: json(CaseVersionPageSchema) },
      401: errors[401], 403: errors[403], 404: errors[404], 422: error("游标无效"), 429: errors[429], 503: errors[503] },
  });
  registry.registerPath({
    method: "get", path: `${caseVersionPath}/{versionId}`, operationId: "getCaseVersion", security,
    summary: "读取指定案例版本",
    description: "本地 Scope 为 case-data:cases:read。按案例和版本双主键读取，不能跨案例取版本。",
    request: { params: caseVersionParams },
    responses: { 200: { description: "不可变版本快照", content: json(CaseVersionSchema) },
      401: errors[401], 403: errors[403], 404: errors[404], 422: errors[422], 429: errors[429], 503: errors[503] },
  });
  registry.registerPath({
    method: "post", path: `${caseVersionPath}/{versionId}/restore`, operationId: "restoreCaseVersion", security,
    summary: "从历史版本恢复案例",
    description: "本地 Scope 为 case-data:cases:write。以 expectedVersion 做乐观并发控制，把历史快照写回当前正文并生成新的 rowVersion/版本，不修改历史版本；locale 与 translationGroupId 保持不变。",
    request: { params: caseVersionParams, body: { required: true, content: json(CaseRestoreVersionBodySchema) } },
    responses: { 200: response, ...writeErrors },
  });
  registry.registerPath({
    method: "get", path: "/api/v1/cases/{caseId}/translations", operationId: "listCaseTranslations", security,
    summary: "读取同语言组案例",
    description: "本地 Scope 为 case-data:cases:read。translationGroupId 相同、locale 不同的案例仍各自拥有独立 caseId、rowVersion、审核与发布状态。",
    request: { params: caseParams },
    responses: { 200: { description: "语言组和组内案例摘要", content: json(CaseTranslationsSchema) },
      401: errors[401], 403: errors[403], 404: errors[404], 422: errors[422], 429: errors[429], 503: errors[503] },
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
  const projectAssetParams = z.object({ projectId: CaseUuidSchema });
  const assetListPage = { description: "项目级素材及每项当前版本", content: json(CaseAssetListSchema) };
  registry.registerPath({
    method: "post", path: "/api/v1/projects/{projectId}/uploads", operationId: "createProjectUpload", security,
    summary: "创建项目级素材上传会话",
    description: "本地 Scope 为 case-data:assets:write。素材先归属项目，可完成上传后挂接到同项目多个案例；提供 assetId 时创建该素材的新版本。上传格式支持 PNG、JPEG、WebP、AVIF、MP4 和 PDF。",
    request: { params: projectAssetParams, body: { required: true, content: json(CaseCreateUploadBodySchema) } },
    responses: { ...assetErrors, 413: writeErrors[413],
      201: { description: "新建的项目级上传会话", content: json(CaseUploadSessionSchema) } },
  });
  registry.registerPath({
    method: "get", path: "/api/v1/projects/{projectId}/assets", operationId: "listCaseProjectAssets", security,
    summary: "分页查询项目素材库",
    description: "本地 Scope 为 case-data:assets:read。返回项目素材、caseIds 挂接关系和当前版本；默认排除归档与软删除素材，可显式包含归档。",
    request: { params: projectAssetParams, query: CaseAssetListQuerySchema },
    responses: { 200: assetListPage, 401: errors[401], 403: errors[403], 404: errors[404],
      422: error("筛选或游标无效"), 429: errors[429], 503: assetErrors[503] },
  });
  const assetParams = z.object({ assetId: CaseUuidSchema });
  registry.registerPath({
    method: "get", path: "/api/v1/cases/{caseId}/assets", operationId: "listCaseAssets", security,
    summary: "查询案例已挂接素材",
    description: "本地 Scope 为 case-data:assets:read。素材仍以项目为归属；同一素材版本可同时服务同项目多个案例。",
    request: { params: caseParams, query: CaseAssetListQuerySchema },
    responses: { 200: assetListPage, 401: errors[401], 403: errors[403], 404: errors[404],
      422: error("筛选或游标无效"), 429: errors[429], 503: assetErrors[503] },
  });
  registry.registerPath({
    method: "get", path: "/api/v1/assets/{assetId}", operationId: "getCaseAsset", security,
    summary: "读取素材详情",
    description: "本地 Scope 为 case-data:assets:read。返回业务元数据、挂接案例、当前版本与处理状态。",
    request: { params: assetParams },
    responses: { 200: { description: "项目级素材视图", content: json(CaseAssetSummarySchema) }, ...assetErrors },
  });
  registry.registerPath({
    method: "patch", path: "/api/v1/assets/{assetId}", operationId: "patchCaseAsset", security,
    summary: "更新、归档、软删除或恢复素材",
    description: "本地 Scope 为 case-data:assets:write。expectedVersion 匹配素材 rowVersion；archived/deleted 可逆。已被任何 release 引用的素材禁止删除（409 ASSET_REFERENCED），但可归档。",
    request: { params: assetParams, body: { required: true, content: json(CaseAssetPatchBodySchema) } },
    responses: { 200: { description: "更新后的素材视图", content: json(CaseAssetSummarySchema) }, ...assetErrors, 413: writeErrors[413] },
  });
  registry.registerPath({
    method: "get", path: "/api/v1/assets/{assetId}/versions", operationId: "listCaseAssetVersions", security,
    summary: "读取素材全部版本",
    description: "本地 Scope 为 case-data:assets:read。版本按 versionNo 倒序；每项绑定唯一 objectVersionId 和处理状态。",
    request: { params: assetParams },
    responses: { 200: { description: "素材版本列表", content: json(CaseAssetVersionListSchema) }, ...assetErrors },
  });
  const assetCaseParams = z.object({ assetId: CaseUuidSchema, caseId: CaseUuidSchema });
  registry.registerPath({
    method: "put", path: "/api/v1/assets/{assetId}/cases/{caseId}", operationId: "linkCaseAsset", security,
    summary: "把素材挂接到案例",
    description: "本地 Scope 为 case-data:assets:write。素材与案例必须属于同一项目；归档或删除对象不可挂接。重复挂接幂等。",
    request: { params: assetCaseParams, body: { required: true, content: json(CaseAssetLinkBodySchema) } },
    responses: { 200: { description: "挂接结果", content: json(CaseAssetLinkViewSchema) }, ...assetErrors, 413: writeErrors[413] },
  });
  registry.registerPath({
    method: "delete", path: "/api/v1/assets/{assetId}/cases/{caseId}", operationId: "unlinkCaseAsset", security,
    summary: "解除素材与案例挂接",
    description: "本地 Scope 为 case-data:assets:write。解除挂接不删除素材版本，也不改写已有 release 的冻结素材引用。",
    request: { params: assetCaseParams, body: { required: true, content: json(CaseAssetLinkBodySchema) } },
    responses: { 200: { description: "解除挂接结果", content: json(CaseAssetLinkViewSchema) }, ...assetErrors, 413: writeErrors[413] },
  });
  const uploadParams = z.object({ uploadId: CaseUuidSchema });
  registry.registerPath({
    method: "post", path: "/api/v1/cases/{caseId}/uploads", operationId: "createCaseUpload", security,
    summary: "创建素材上传会话",
    description: "本地 Scope 为 case-data:assets:write。提供 assetId 时创建同一素材的新版本。大于 32 MiB 自动进入分片模式；完成上传后自动挂接当前案例。",
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
    description: "本地 Scope 为 case-data:assets:write。单次 PUT 可提交对象版本 ID，丢失 PUT 回执时可省略，由网关按会话键查验唯一版本。分片模式省略该字段，由网关检查与合并分片。两种模式均校验精确版本的大小、MIME 和 SHA-256。支持 image/png、image/jpeg、image/webp、image/avif、video/mp4、application/pdf，完成响应含 scanStatus、transcodeStatus、previewStatus 与 objectVersionId。",
    request: { params: uploadParams, body: { required: true, content: json(CaseCompleteUploadBodySchema) } },
    responses: { ...assetErrors, 413: writeErrors[413],
      200: { description: "已持久化的素材版本，扫描状态初始为 pending", content: json(CaseAssetVersionViewSchema) } },
  });
  registry.registerPath({
    method: "get", path: "/api/v1/assets/{assetId}/versions/{assetVersionId}/preview-ticket",
    operationId: "getCaseAssetPreviewTicket", security,
    summary: "签发作者侧素材内联预览票据",
    description: "本地 Scope 为 case-data:assets:read。图片与 PDF 返回最长 60 秒 inline URL 和 contentType；不暴露对象 key、桶名或永久凭据。扫描失败的素材返回 409 PREVIEW_NOT_AVAILABLE。",
    request: { params: z.object({ assetId: CaseUuidSchema, assetVersionId: CaseUuidSchema }) },
    responses: { ...assetErrors, 200: { description: "最长 60 秒的内联预览票据", content: json(CaseAssetPreviewTicketSchema) } },
  });
  registry.registerPath({
    method: "get", path: "/api/v1/assets/{assetId}/versions/{assetVersionId}/download-ticket",
    operationId: "getCaseAssetDownloadTicket", security,
    summary: "签发作者素材下载票据",
    description: "本地 Scope 为 case-data:assets:read。下载票据绑定已登记的对象版本，使用 attachment 和 octet-stream，返回 objectVersionId 与 contentType。",
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
  const document = new OpenApiGeneratorV31(registry.definitions).generateDocument({
    openapi: "3.1.0",
    info: { title: "LibiaoLink 案例数据网关", version: "1.8.0",
      description: "项目、案例和素材以 libiaolink_case 与独立素材桶为唯一主存。写成功即在同一事务提交，项目目录投影常驻 watch 约 1 秒刷新，客户端可在提交响应后立即读回。" },
  });
  return {
    ...document,
    "x-endpoint-scopes": {
      listCaseProjects: "case-data:projects:read", registerLocalCaseProject: "case-data:projects:write",
      getCaseProject: "case-data:projects:read", patchLocalCaseProject: "case-data:projects:write",
      getCaseProjectProfile: "case-data:project-data:read", saveCaseProjectProfile: "case-data:project-data:write",
      getCaseSubject: "case-data:project-data:read", saveCaseSubject: "case-data:project-data:write",
      listCaseProjectCases: "case-data:cases:read", createCase: "case-data:cases:write",
      getCase: "case-data:cases:read", patchCase: "case-data:cases:write",
      listCaseVersions: "case-data:cases:read", getCaseVersion: "case-data:cases:read",
      restoreCaseVersion: "case-data:cases:write", listCaseTranslations: "case-data:cases:read",
      createProjectUpload: "case-data:assets:write", createCaseUpload: "case-data:assets:write",
      listCaseProjectAssets: "case-data:assets:read", listCaseAssets: "case-data:assets:read",
      getCaseAsset: "case-data:assets:read", patchCaseAsset: "case-data:assets:write",
      listCaseAssetVersions: "case-data:assets:read", linkCaseAsset: "case-data:assets:write",
      unlinkCaseAsset: "case-data:assets:write", getCaseUploadTarget: "case-data:assets:write",
      listCaseUploadedParts: "case-data:assets:write", getCaseUploadPartTarget: "case-data:assets:write",
      completeCaseUpload: "case-data:assets:write", getCaseAssetPreviewTicket: "case-data:assets:read",
      getCaseAssetDownloadTicket: "case-data:assets:read", getCaseMediaInput: "case-data:assets:process",
      getCaseMediaState: "case-data:assets:process", saveCaseMediaResult: "case-data:assets:process",
      stageRelease: "case-data:releases:write", activateRelease: "case-data:releases:write",
      deactivateRelease: "case-data:releases:write", getCaseReleaseHistory: "case-data:releases:history:read",
      getPublishedCaseRelease: "case-data:releases:read", getPublishedCaseAsset: "case-data:releases:read",
      getOperationResult: "case-data:operations:read",
    },
    "x-scopes": ["case-data:projects:read", "case-data:projects:write", "case-data:project-data:read",
      "case-data:project-data:write", "case-data:cases:read", "case-data:cases:write", "case-data:assets:read",
      "case-data:assets:write", "case-data:assets:process", "case-data:releases:read",
      "case-data:releases:write", "case-data:releases:history:read", "case-data:operations:read"],
    "x-field-dictionaries": {
      project: {
        externalProjectId: "uuid, required, immutable; globally unique across core history and local projects",
        projectCode: "string 1..50, required; cross-source unique among available core/local directory entries; PATCH increments sourceVersion",
        projectName: "string 1..200, required", customerText: "string <=200, nullable",
        region: "string 1..100, default 未分类", projectType: "string 1..100, default 未分类",
        managerIds: "uuid[], default []; same length as managerNames",
        managerNames: "string|null[], default []; same length as managerIds",
        status: "active|paused|done|archived; archived sets archivedAt, another status clears it",
        sourceKind: "core|local, read-only", sourceVersion: "integer >=1; local create=1, PATCH +1",
        archivedAt: "timestamp|null, derived from status", deletedAt: "timestamp|null, soft delete/restore",
        updatedAt: "timestamp", syncedAt: "timestamp",
      },
      profile: {
        sourceVersion: "project directory sourceVersion; must equal current project version",
        expectedVersion: "profile rowVersion; first save uses 0, success returns 201 then +1",
        attributes: "deliveryYear, customerSubjectId, customerDisplayName, customerAliases, customerLogoAssetId, partnerType, partnerKey, partnerDisplayName, threePlKey, threePlDisplayName, relationshipType, regions, regionCodes, country, countryCode, industry, industryCode, scenarioCode, businessScenario, solutionTypes, canVisit",
        subjects: "subjectId+subjectType relations; isPrimary required",
        members: "operatorUserKey+roleCode; manager and source fields; optional leftAt",
      },
      case: {
        caseId: "uuid, caller may pre-generate; immutable", sourceProjectId: "uuid, immutable",
        translationGroupId: "uuid, default caseId; same value links independently editable locales",
        locale: "BCP-47-like, immutable after create", title: "string 1..300", summary: "string <=5000|null",
        reviewStatus: "not_submitted|reviewing|approved|rejected; caller-owned review mirror, gateway has no review state machine",
        reviewRef: "string 1..256|null; caller-owned review reference",
        status: "derived: deleted > archived > active release published > reviewing > draft",
        activeReleaseId: "uuid|null, active release lookup", rowVersion: "integer >=1; increments only on actual change",
        archivedAt: "timestamp|null", deletedAt: "timestamp|null", changeSummary: "string 1..1000|null",
        content: "schemaVersion=1 fields[] using registered text/highlights keys", 
        solutionParameters: "schemaVersion=1 groups[] unique solutionType and registered parameter names",
        outcomes: "schemaVersion=1 metrics[] label/value/unit",
        confidentiality: "schemaVersion=1 mode/customerIdentity/contentVisibility/mediaPermission/internalScope",
      },
      asset: {
        assetId: "uuid; stable project-level asset identity", projectId: "uuid; asset library owner",
        caseIds: "uuid[]; zero or more links within the same project", assetType: "logo|cover|image|video|document|other",
        title: "string 1..300|null", description: "string <=2000|null", locale: "locale|null", tags: "unique string[] <=30",
        classification: "L1|L2|L3", customerVisible: "boolean", customerPresentationAllowed: "boolean", shareAllowed: "boolean",
        assetVersionId: "uuid; immutable version identity", versionNo: "integer >=1",
        objectVersionId: "exact object-store version; no permanent key or credential is exposed",
        mimeType: "image/png|image/jpeg|image/webp|image/avif|video/mp4|application/pdf",
        sizeBytes: "1..268435456", sha256: "64 lowercase hex", scanStatus: "pending|passed|failed",
        transcodeStatus: "not_required|pending|ready|failed", previewStatus: "pending|ready|failed",
        dimensions: "{width,height}|null", durationMs: "integer|null", mediaVersion: "integer >=1",
        thumbnailAvailable: "boolean; image or PDF preview capability", rowVersion: "asset metadata concurrency version",
        archivedAt: "timestamp|null", deletedAt: "timestamp|null",
      },
    },
    "x-write-semantics": {
      idempotency: "Every write uses body operationId UUIDv7. The first committed result is retained 30 days; same hash returns the original status/body, different hash returns 409 IDEMPOTENCY_CONFLICT.",
      immediateRead: "Writes and reads use the same case database; after 2xx the committed row is immediately readable. Project core projection uses a resident watch at CASE_PROJECTION_WATCH_MS=1000 by default (250..60000), not a five-minute cycle.",
      optimisticConcurrency: "Cases and assets use expectedVersion/rowVersion; local projects use expectedVersion/sourceVersion; conflicts return 409 and never overwrite the newer row.",
      noChange: "A PATCH with no actual field change succeeds without incrementing rowVersion or creating a case version.",
      deleteSemantics: "Project and case deletes are soft; deleted IDs remain stable. Asset delete is soft and is rejected with 409 ASSET_REFERENCED if any release references the asset; archive remains available. Historical releases are frozen and are not rewritten by later edits, archive, delete, or unlink.",
      upload: "Upload sessions expire after 15 minutes; signed PUT targets last at most 120 seconds; parts are 8 MiB; complete re-checks exact objectVersionId, size, MIME signature and SHA-256. Single PUT is used through 32 MiB; multipart up to 256 MiB. Reusing assetId creates a new asset version.",
      mediaResponsibility: "External media processor owns scanning, transcoding and thumbnail generation, and writes results only through the assets:process media-state endpoint. Authors can preview images/PDF while scan is pending; scan failure disables preview.",
      errorBody: "{code,message,details,traceId}; 409 is recoverable by reading current version/state; 429 and 503 include Retry-After where applicable.",
    },
    "x-error-codes": {
      "401": ["AUTH_REQUIRED"], "403": ["FORBIDDEN"], "404": ["NOT_FOUND"], "405": ["METHOD_NOT_ALLOWED"],
      "409": ["IDEMPOTENCY_IN_PROGRESS", "IDEMPOTENCY_CONFLICT", "VERSION_CONFLICT", "PROJECT_VERSION_CONFLICT",
        "PROJECT_CODE_EXISTS", "PROJECT_ID_EXISTS", "PROJECT_SOURCE_READ_ONLY", "CASE_ID_CONFLICT",
        "UPLOAD_ALREADY_COMPLETED", "UPLOAD_OBJECT_MISSING", "UPLOAD_VERSION_AMBIGUOUS",
        "RELEASE_STATE_CONFLICT", "RELEASE_ASSET_MISMATCH", "RELEASE_ASSET_NOT_READY", "ACTIVE_RELEASE_MISMATCH",
        "MEDIA_STATE_CONFLICT", "PREVIEW_NOT_AVAILABLE", "ASSET_REFERENCED", "ASSET_NOT_AVAILABLE",
        "RELEASE_SWITCH_IN_PROGRESS"],
      "410": ["UPLOAD_SESSION_EXPIRED"], "413": ["PAYLOAD_TOO_LARGE"], "422": ["VALIDATION_FAILED", "ASSET_OBJECT_MISMATCH"],
      "429": ["RATE_LIMITED", "CLIENT_CONCURRENCY_LIMIT"],
      "503": ["CASE_DATABASE_BUSY", "GATEWAY_BUSY", "PROJECT_CATALOG_UNAVAILABLE", "ASSET_STORAGE_UNAVAILABLE",
        "PUBLIC_RELEASE_UNAVAILABLE", "CAPACITY_UNAVAILABLE", "CAPACITY_READ_ONLY", "CAPACITY_UPLOAD_PAUSED"],
    },
    "x-migration": { current: "0014_remote_primary_projects_cases_assets.sql", previous: ["0012_local_projects.sql", "0013_fix_local_project_claim_trigger.sql"], notes: "Historical migrations are immutable. See the frozen contract report for SHA-256 values and schema diff." },
  };
}
