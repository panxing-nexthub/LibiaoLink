/**
 * 本文件由 shared/scripts/generate-case-data.mjs 生成，禁止手改（CONTRIBUTING 第 14 节）。
 * 源：shared/src 下的 Zod schema → generated/case-data-openapi.json → 本文件。
 */
export interface paths {
    "/api/v1/projects": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 查询可选项目目录
         * @description 本地 Scope 为 case-data:projects:read。合并核心只读投影与本地注册项目，包含归档项目；分页游标只能与原筛选条件一起使用。
         */
        get: operations["listCaseProjects"];
        put?: never;
        /**
         * 注册本地项目
         * @description 本地 Scope 为 case-data:projects:write。项目仅写入 libiaolink_case，不进入核心库；项目编号在目录可用项范围内跨来源唯一，项目 ID 跨全部核心历史摘要与本地项目唯一。
         */
        post: operations["registerLocalCaseProject"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/projects/{projectId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 按 ID 读取可选项目目录项
         * @description 本地 Scope 为 case-data:projects:read。返回项与 GET /api/v1/projects 列表项逐字段一致；核心投影和本地项目走同一合并口径，删除或源缺失项目返回 404。
         */
        get: operations["getCaseProject"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * 更新或归档本地项目
         * @description 本地 Scope 为 case-data:projects:write。仅能更新 libiaolink_case 中的本地项目，核心投影项目只读。expectedVersion 必须匹配当前 sourceVersion；status=archived 时归档，改回其它状态时解档。
         */
        patch: operations["patchLocalCaseProject"];
        trace?: never;
    };
    "/api/v1/projects/{projectId}/cases": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 分页查询项目下案例
         * @description 本地 Scope 为 case-data:cases:read。支持 status、keyword、updatedAfter 和 limit/cursor；默认排除已软删除案例，状态由删除、归档、active release 与 reviewStatus 依次派生。
         */
        get: operations["listCaseProjectCases"];
        put?: never;
        /**
         * 创建案例
         * @description 本地 Scope 为 case-data:cases:write。可预生成 caseId；同一语言的多个案例通过 translationGroupId 聚合，每个 locale 独立编辑、审核和发布。请求必须匹配项目当前 sourceVersion，创建时写入不可变 v1 版本快照。
         */
        post: operations["createCase"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/projects/{projectId}/profile": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 读取案例侧项目资料
         * @description 本地 Scope 为 case-data:project-data:read。
         */
        get: operations["getCaseProjectProfile"];
        /**
         * 保存案例侧项目资料
         * @description 本地 Scope 为 case-data:project-data:write。核对来源项目版本和案例侧资料版本，按完整清单替换。
         */
        put: operations["saveCaseProjectProfile"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/subjects": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 按类型和稳定键保存案例主体
         * @description 本地 Scope 为 case-data:project-data:write。新建传 expectedVersion=0，别名按完整清单替换。
         */
        post: operations["saveCaseSubject"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/subjects/{subjectId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 按主体 ID 读取案例主体
         * @description 本地 Scope 为 case-data:project-data:read。
         */
        get: operations["getCaseSubject"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/cases/{caseId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 读取案例
         * @description 本地 Scope 为 case-data:cases:read。返回当前可编辑正文、版本号、语言组、审核镜像字段、派生状态和 active release ID。
         */
        get: operations["getCase"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * 更新、归档、软删除或恢复案例
         * @description 本地 Scope 为 case-data:cases:write。content/solutionParameters/outcomes/confidentiality 为整列替换；archived/deleted 切换软状态，删除不影响历史 release。仅实际变化时 rowVersion 递增并写入新版本；locale 和 translationGroupId 不可改。
         */
        patch: operations["patchCase"];
        trace?: never;
    };
    "/api/v1/cases/{caseId}/versions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 分页读取案例版本历史
         * @description 本地 Scope 为 case-data:cases:read。每项包含不可变标题、摘要、正文、方案参数、成果、保密设置和变更摘要；按 versionNo 倒序分页。
         */
        get: operations["listCaseVersions"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/cases/{caseId}/versions/{versionId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 读取指定案例版本
         * @description 本地 Scope 为 case-data:cases:read。按案例和版本双主键读取，不能跨案例取版本。
         */
        get: operations["getCaseVersion"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/cases/{caseId}/versions/{versionId}/restore": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 从历史版本恢复案例
         * @description 本地 Scope 为 case-data:cases:write。以 expectedVersion 做乐观并发控制，把历史快照写回当前正文并生成新的 rowVersion/版本，不修改历史版本；locale 与 translationGroupId 保持不变。
         */
        post: operations["restoreCaseVersion"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/cases/{caseId}/translations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 读取同语言组案例
         * @description 本地 Scope 为 case-data:cases:read。translationGroupId 相同、locale 不同的案例仍各自拥有独立 caseId、rowVersion、审核与发布状态。
         */
        get: operations["listCaseTranslations"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/operations/{operationId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 查询已提交的操作结果
         * @description 本地 Scope 为 case-data:operations:read。只返回当前服务身份的记录。原写入 HTTP 状态放在 statusCode。
         */
        get: operations["getOperationResult"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/projects/{projectId}/uploads": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 创建项目级素材上传会话
         * @description 本地 Scope 为 case-data:assets:write。素材先归属项目，可完成上传后挂接到同项目多个案例；提供 assetId 时创建该素材的新版本。上传格式支持 PNG、JPEG、WebP、AVIF、MP4 和 PDF。
         */
        post: operations["createProjectUpload"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/projects/{projectId}/assets": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 分页查询项目素材库
         * @description 本地 Scope 为 case-data:assets:read。返回项目素材、caseIds 挂接关系和当前版本；默认排除归档与软删除素材，可显式包含归档。
         */
        get: operations["listCaseProjectAssets"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/cases/{caseId}/assets": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 查询案例已挂接素材
         * @description 本地 Scope 为 case-data:assets:read。素材仍以项目为归属；同一素材版本可同时服务同项目多个案例。
         */
        get: operations["listCaseAssets"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/assets/{assetId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 读取素材详情
         * @description 本地 Scope 为 case-data:assets:read。返回业务元数据、挂接案例、当前版本与处理状态。
         */
        get: operations["getCaseAsset"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * 更新、归档、软删除或恢复素材
         * @description 本地 Scope 为 case-data:assets:write。expectedVersion 匹配素材 rowVersion；archived/deleted 可逆。已被任何 release 引用的素材禁止删除（409 ASSET_REFERENCED），但可归档。
         */
        patch: operations["patchCaseAsset"];
        trace?: never;
    };
    "/api/v1/assets/{assetId}/versions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 读取素材全部版本
         * @description 本地 Scope 为 case-data:assets:read。版本按 versionNo 倒序；每项绑定唯一 objectVersionId 和处理状态。
         */
        get: operations["listCaseAssetVersions"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/assets/{assetId}/cases/{caseId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * 把素材挂接到案例
         * @description 本地 Scope 为 case-data:assets:write。素材与案例必须属于同一项目；归档或删除对象不可挂接。重复挂接幂等。
         */
        put: operations["linkCaseAsset"];
        post?: never;
        /**
         * 解除素材与案例挂接
         * @description 本地 Scope 为 case-data:assets:write。解除挂接不删除素材版本，也不改写已有 release 的冻结素材引用。
         */
        delete: operations["unlinkCaseAsset"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/cases/{caseId}/uploads": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 创建素材上传会话
         * @description 本地 Scope 为 case-data:assets:write。提供 assetId 时创建同一素材的新版本。大于 32 MiB 自动进入分片模式；完成上传后自动挂接当前案例。
         */
        post: operations["createCaseUpload"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/uploads/{uploadId}/target": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 签发素材上传目标
         * @description 本地 Scope 为 case-data:assets:write。单次 PUT 模式按签名请求头上传并保存 x-amz-version-id。
         */
        get: operations["getCaseUploadTarget"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/uploads/{uploadId}/parts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 查询可续传分片
         * @description 本地 Scope 为 case-data:assets:write。由对象存储返回已成功上传的分片。
         */
        get: operations["listCaseUploadedParts"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/uploads/{uploadId}/parts/{partNumber}/target": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 签发指定分片上传目标
         * @description 本地 Scope 为 case-data:assets:write。分片大小固定，尾片按总大小计算，签名最长 120 秒。
         */
        get: operations["getCaseUploadPartTarget"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/uploads/{uploadId}/complete": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 校验实际对象版本并完成上传
         * @description 本地 Scope 为 case-data:assets:write。单次 PUT 可提交对象版本 ID，丢失 PUT 回执时可省略，由网关按会话键查验唯一版本。分片模式省略该字段，由网关检查与合并分片。两种模式均校验精确版本的大小、MIME 和 SHA-256。支持 image/png、image/jpeg、image/webp、image/avif、video/mp4、application/pdf，完成响应含 scanStatus、transcodeStatus、previewStatus 与 objectVersionId。
         */
        post: operations["completeCaseUpload"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/assets/{assetId}/versions/{assetVersionId}/preview-ticket": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 签发作者侧素材内联预览票据
         * @description 本地 Scope 为 case-data:assets:read。图片与 PDF 返回最长 60 秒 inline URL 和 contentType；不暴露对象 key、桶名或永久凭据。扫描失败的素材返回 409 PREVIEW_NOT_AVAILABLE。
         */
        get: operations["getCaseAssetPreviewTicket"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/assets/{assetId}/versions/{assetVersionId}/download-ticket": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 签发作者素材下载票据
         * @description 本地 Scope 为 case-data:assets:read。下载票据绑定已登记的对象版本，使用 attachment 和 octet-stream，返回 objectVersionId 与 contentType。
         */
        get: operations["getCaseAssetDownloadTicket"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/assets/{assetId}/versions/{assetVersionId}/media-input": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 签发媒体处理输入票据
         * @description 仅受信媒体服务的 case-data:assets:process Scope 可调用。
         */
        get: operations["getCaseMediaInput"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/assets/{assetId}/versions/{assetVersionId}/media-state": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 读取媒体处理状态
         * @description 仅受信媒体服务的 case-data:assets:process Scope 可调用。
         */
        get: operations["getCaseMediaState"];
        /**
         * 回传媒体处理结果
         * @description 仅受信媒体服务的 case-data:assets:process Scope 可调用。校验媒体版本、对象版本与 SHA-256。
         */
        put: operations["saveCaseMediaResult"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/cases/{caseId}/releases": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 固化待发布版本
         * @description 本地 Scope 为 case-data:releases:write。提交已准备好的对外快照与精确素材版本。
         */
        post: operations["stageRelease"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/cases/{caseId}/releases/{releaseId}/activate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 激活待发布版本
         * @description 本地 Scope 为 case-data:releases:write。显式提交 expectedActiveReleaseId 和 approvalRef。
         */
        post: operations["activateRelease"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/cases/{caseId}/releases/{releaseId}/deactivate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 撤回当前 active 版本
         * @description 本地 Scope 为 case-data:releases:write。撤回后历史快照和素材引用继续保留。
         */
        post: operations["deactivateRelease"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/cases/{caseId}/releases/{releaseId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 读取作者发布历史
         * @description 本地 Scope 为 case-data:releases:history:read。
         */
        get: operations["getCaseReleaseHistory"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/public/cases/{caseId}/releases/{releaseId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 读取 active 发布快照
         * @description 本地 Scope 为 case-data:releases:read。按案例和发布 ID 精确查找。
         */
        get: operations["getPublishedCaseRelease"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/public/cases/{caseId}/releases/{releaseId}/assets/{assetVersionId}/content": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 读取 active 发布的锁定素材
         * @description 本地 Scope 为 case-data:releases:read。每次请求重新核对发布状态。
         */
        get: operations["getPublishedCaseAsset"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        CaseProjectCatalogPage: {
            items: components["schemas"]["CaseProjectCatalogItem"][];
            nextCursor: string | null;
        };
        CaseProjectCatalogItem: {
            /** Format: uuid */
            externalProjectId: string;
            projectCode: string;
            projectName: string;
            customerText: string | null;
            region: string;
            projectType: string;
            managerIds: string[];
            managerNames: (string | null)[];
            /** @enum {string} */
            status: "active" | "paused" | "done" | "archived";
            /** @enum {string} */
            sourceKind: "core" | "local";
            sourceVersion: number;
            /** Format: date-time */
            updatedAt: string;
            /** Format: date-time */
            archivedAt: string | null;
            /** Format: date-time */
            deletedAt: string | null;
            /** Format: date-time */
            syncedAt: string;
        };
        CaseDataGatewayError: {
            code: string;
            message: string;
            traceId: string;
            details: {
                code: string;
                message: string;
                path: string;
            }[];
        };
        RegisterLocalCaseProjectBody: {
            /** Format: uuid */
            operationId: string;
            traceId?: string;
            operatorUserKey: string;
            /**
             * Format: uuid
             * @description 可选的本地项目 UUID；省略时由案例库生成 UUIDv7，跨核心投影与本地项目全局唯一
             */
            externalProjectId?: string;
            /** @description 项目编号：与核心目录可用项跨来源唯一；软删除或源缺失的历史摘要不占编号，归档项仍占用 */
            projectCode: string;
            projectName: string;
            /** @default null */
            customerText: string | null;
            /** @default 未分类 */
            region: string;
            /** @default 未分类 */
            projectType: string;
            /** @default [] */
            managerIds: string[];
            /** @default [] */
            managerNames: (string | null)[];
            /**
             * @default active
             * @enum {string}
             */
            status: "active" | "paused" | "done" | "archived";
        };
        PatchLocalCaseProjectBody: {
            /** Format: uuid */
            operationId: string;
            traceId?: string;
            operatorUserKey: string;
            expectedVersion: number;
            /** @description 项目编号：与核心目录可用项跨来源唯一；软删除或源缺失的历史摘要不占编号，归档项仍占用 */
            projectCode?: string;
            projectName?: string;
            customerText?: string | null;
            region?: string;
            projectType?: string;
            managerIds?: string[];
            managerNames?: (string | null)[];
            /** @enum {string} */
            status?: "active" | "paused" | "done" | "archived";
            deleted?: boolean;
        };
        CaseListPage: {
            items: components["schemas"]["CaseListItem"][];
            nextCursor: string | null;
        };
        CaseListItem: {
            /** Format: uuid */
            caseId: string;
            /** Format: uuid */
            sourceProjectId: string;
            /** Format: uuid */
            translationGroupId: string;
            locale: string;
            title: string;
            /** @enum {string} */
            status: "draft" | "reviewing" | "published" | "archived" | "deleted";
            /** @enum {string} */
            reviewStatus: "not_submitted" | "reviewing" | "approved" | "rejected";
            /** Format: uuid */
            activeReleaseId: string | null;
            changeSummary: string | null;
            rowVersion: number;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
            /** Format: date-time */
            archivedAt: string | null;
            /** Format: date-time */
            deletedAt: string | null;
        };
        CaseProjectProfileView: {
            /** Format: uuid */
            externalProjectId: string;
            sourceVersion: number;
            rowVersion: number;
            /** Format: date-time */
            updatedAt: string;
            attributes: {
                [key: string]: unknown;
            };
            subjects: {
                /** Format: uuid */
                subjectId: string;
                /** @enum {string} */
                subjectType: "customer" | "partner" | "three_pl";
                /** @default false */
                isPrimary: boolean;
            }[];
            members: {
                operatorUserKey: string;
                roleCode: string;
                /** @default null */
                source: string | null;
                /** @default false */
                isPrimary: boolean;
                /**
                 * Format: date-time
                 * @default null
                 */
                leftAt: string | null;
            }[];
        };
        SaveCaseProjectProfileBody: {
            /** Format: uuid */
            operationId: string;
            traceId?: string;
            operatorUserKey: string;
            expectedVersion: number;
            sourceVersion: number;
            attributes: {
                deliveryYear?: number;
                /** Format: uuid */
                customerSubjectId?: string;
                customerDisplayName?: string;
                customerAliases?: string[];
                /** Format: uuid */
                customerLogoAssetId?: string;
                partnerType?: string;
                partnerKey?: string;
                partnerDisplayName?: string;
                threePlKey?: string;
                threePlDisplayName?: string;
                relationshipType?: string;
                regions?: string[];
                regionCodes?: string[];
                country?: string;
                countryCode?: string;
                industry?: string;
                industryCode?: string;
                scenarioCode?: string;
                businessScenario?: string;
                solutionTypes?: ("airrob" | "airrob_pro" | "airrob_plus" | "t_sort" | "t_carry" | "3d" | "grabot")[];
                canVisit?: boolean;
            };
            subjects: {
                /** Format: uuid */
                subjectId: string;
                /** @enum {string} */
                subjectType: "customer" | "partner" | "three_pl";
                /** @default false */
                isPrimary: boolean;
            }[];
            members: {
                operatorUserKey: string;
                roleCode: string;
                /** @default null */
                source: string | null;
                /** @default false */
                isPrimary: boolean;
                /**
                 * Format: date-time
                 * @default null
                 */
                leftAt: string | null;
            }[];
        };
        CaseSubjectView: {
            /** Format: uuid */
            subjectId: string;
            /** @enum {string} */
            subjectType: "customer" | "partner" | "three_pl";
            stableKey: string;
            displayName: string;
            /**
             * @default active
             * @enum {string}
             */
            status: "active" | "inactive";
            /** @default case_library */
            sourceSystem: string;
            /** @default null */
            sourceRef: string | null;
            aliases: {
                alias: string;
                /** @default zh-CN */
                locale: string;
                /** @default null */
                source: string | null;
            }[];
            rowVersion: number;
            /** Format: date-time */
            updatedAt: string;
        };
        SaveCaseSubjectBody: {
            /** Format: uuid */
            operationId: string;
            traceId?: string;
            operatorUserKey: string;
            expectedVersion: number;
            /** @enum {string} */
            subjectType: "customer" | "partner" | "three_pl";
            stableKey: string;
            displayName: string;
            /**
             * @default active
             * @enum {string}
             */
            status: "active" | "inactive";
            /** @default case_library */
            sourceSystem: string;
            /** @default null */
            sourceRef: string | null;
            aliases: {
                alias: string;
                /** @default zh-CN */
                locale: string;
                /** @default null */
                source: string | null;
            }[];
        };
        CaseAuthoringView: {
            /** Format: uuid */
            caseId: string;
            /** Format: uuid */
            sourceProjectId: string;
            /** Format: uuid */
            translationGroupId: string;
            locale: string;
            title: string;
            summary: string | null;
            changeSummary: string | null;
            content: {
                [key: string]: unknown;
            };
            solutionParameters: {
                [key: string]: unknown;
            };
            outcomes: {
                [key: string]: unknown;
            };
            confidentiality: {
                [key: string]: unknown;
            };
            /** @enum {string} */
            reviewStatus: "not_submitted" | "reviewing" | "approved" | "rejected";
            reviewRef: string | null;
            /** @enum {string} */
            status: "draft" | "reviewing" | "published" | "archived" | "deleted";
            /** Format: uuid */
            activeReleaseId: string | null;
            /** Format: date-time */
            archivedAt: string | null;
            /** Format: date-time */
            deletedAt: string | null;
            createdBy: string;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
            rowVersion: number;
        };
        CaseCreateBody: {
            /** Format: uuid */
            operationId: string;
            traceId?: string;
            operatorUserKey: string;
            /** Format: uuid */
            caseId?: string;
            /** Format: uuid */
            externalProjectId: string;
            /**
             * Format: uuid
             * @description 同组案例共享此 ID；省略时使用案例 ID，服务端生成案例时使用新的 UUIDv7
             */
            translationGroupId?: string;
            sourceVersion: number;
            locale: string;
            title: string;
            summary?: string | null;
            changeSummary?: string | null;
            /**
             * @default not_submitted
             * @enum {string}
             */
            reviewStatus: "not_submitted" | "reviewing" | "approved" | "rejected";
            reviewRef?: string | null;
            /**
             * @default {
             *       "schemaVersion": 1,
             *       "fields": []
             *     }
             */
            content: {
                /** @enum {number} */
                schemaVersion: 1;
                fields: ({
                    /**
                     * @default L1
                     * @enum {string}
                     */
                    classification: "L1" | "L2" | "L3";
                    customerShareAllowed: boolean;
                    customerPresentationAllowed: boolean;
                    /** @enum {boolean} */
                    aiAllowed: false;
                    sortOrder: number;
                    /** @enum {string} */
                    key: "pain_points" | "automation_reason" | "background" | "before_process" | "after_process" | "timeline" | "solution_description_zh" | "solution_description_en";
                    /** @enum {string} */
                    fieldType: "text";
                    valueText: string;
                } | {
                    /**
                     * @default L1
                     * @enum {string}
                     */
                    classification: "L1" | "L2" | "L3";
                    customerShareAllowed: boolean;
                    customerPresentationAllowed: boolean;
                    /** @enum {boolean} */
                    aiAllowed: false;
                    sortOrder: number;
                    /** @enum {string} */
                    key: "highlights";
                    /** @enum {string} */
                    fieldType: "highlights";
                    highlights: string[];
                })[];
            };
            /**
             * @description 方案组按 solutionType 去重。每组参数名须在对应方案字典内，非空方案组须属于该案例来源项目。
             * @default {
             *       "schemaVersion": 1,
             *       "groups": []
             *     }
             */
            solutionParameters: {
                /** @enum {number} */
                schemaVersion: 1;
                groups: {
                    /** @enum {string} */
                    solutionType: "airrob" | "airrob_pro" | "airrob_plus" | "t_sort" | "t_carry" | "3d" | "grabot";
                    parameters: {
                        [key: string]: string | number | boolean | null;
                    };
                }[];
            };
            /**
             * @default {
             *       "schemaVersion": 1,
             *       "metrics": []
             *     }
             */
            outcomes: {
                /** @enum {number} */
                schemaVersion: 1;
                metrics: {
                    label: string;
                    value: string | number;
                    unit?: string | null;
                }[];
            };
            confidentiality: {
                /** @enum {number} */
                schemaVersion: 1;
                /** @enum {string} */
                mode: "public" | "partial" | "private";
                /** @enum {string} */
                customerIdentity: "secret" | "internal" | "public";
                /** @enum {string} */
                contentVisibility: "secret" | "internal" | "public";
                /** @enum {string} */
                mediaPermission: "secret" | "internal" | "public";
                internalScope?: string | null;
            };
        };
        CasePatchBody: {
            /** Format: uuid */
            operationId: string;
            traceId?: string;
            operatorUserKey: string;
            expectedVersion: number;
            title?: string;
            summary?: string | null;
            changeSummary?: string | null;
            content?: {
                /** @enum {number} */
                schemaVersion: 1;
                fields: ({
                    /**
                     * @default L1
                     * @enum {string}
                     */
                    classification: "L1" | "L2" | "L3";
                    customerShareAllowed: boolean;
                    customerPresentationAllowed: boolean;
                    /** @enum {boolean} */
                    aiAllowed: false;
                    sortOrder: number;
                    /** @enum {string} */
                    key: "pain_points" | "automation_reason" | "background" | "before_process" | "after_process" | "timeline" | "solution_description_zh" | "solution_description_en";
                    /** @enum {string} */
                    fieldType: "text";
                    valueText: string;
                } | {
                    /**
                     * @default L1
                     * @enum {string}
                     */
                    classification: "L1" | "L2" | "L3";
                    customerShareAllowed: boolean;
                    customerPresentationAllowed: boolean;
                    /** @enum {boolean} */
                    aiAllowed: false;
                    sortOrder: number;
                    /** @enum {string} */
                    key: "highlights";
                    /** @enum {string} */
                    fieldType: "highlights";
                    highlights: string[];
                })[];
            };
            /** @description 方案组按 solutionType 去重。每组参数名须在对应方案字典内，非空方案组须属于该案例来源项目。 */
            solutionParameters?: {
                /** @enum {number} */
                schemaVersion: 1;
                groups: {
                    /** @enum {string} */
                    solutionType: "airrob" | "airrob_pro" | "airrob_plus" | "t_sort" | "t_carry" | "3d" | "grabot";
                    parameters: {
                        [key: string]: string | number | boolean | null;
                    };
                }[];
            };
            outcomes?: {
                /** @enum {number} */
                schemaVersion: 1;
                metrics: {
                    label: string;
                    value: string | number;
                    unit?: string | null;
                }[];
            };
            confidentiality?: {
                /** @enum {number} */
                schemaVersion: 1;
                /** @enum {string} */
                mode: "public" | "partial" | "private";
                /** @enum {string} */
                customerIdentity: "secret" | "internal" | "public";
                /** @enum {string} */
                contentVisibility: "secret" | "internal" | "public";
                /** @enum {string} */
                mediaPermission: "secret" | "internal" | "public";
                internalScope?: string | null;
            };
            /** @enum {string} */
            reviewStatus?: "not_submitted" | "reviewing" | "approved" | "rejected";
            reviewRef?: string | null;
            archived?: boolean;
            deleted?: boolean;
        };
        CaseVersionPage: {
            items: components["schemas"]["CaseVersion"][];
            nextCursor: string | null;
        };
        CaseVersion: {
            /** Format: uuid */
            caseId: string;
            /** Format: uuid */
            caseVersionId: string;
            versionNo: number;
            changeSummary: string | null;
            /** Format: uuid */
            restoredFromVersionId: string | null;
            createdBy: string;
            /** Format: date-time */
            createdAt: string;
            snapshot: components["schemas"]["CaseVersionSnapshot"];
        };
        CaseVersionSnapshot: {
            locale: string;
            /** Format: uuid */
            translationGroupId: string;
            title: string;
            summary: string | null;
            changeSummary: string | null;
            content: {
                [key: string]: unknown;
            };
            solutionParameters: {
                [key: string]: unknown;
            };
            outcomes: {
                [key: string]: unknown;
            };
            confidentiality: {
                [key: string]: unknown;
            };
        };
        CaseRestoreVersionBody: {
            /** Format: uuid */
            operationId: string;
            traceId?: string;
            operatorUserKey: string;
            expectedVersion: number;
            changeSummary?: string | null;
        };
        CaseTranslations: {
            /** Format: uuid */
            translationGroupId: string;
            items: components["schemas"]["CaseTranslationSummary"][];
        };
        CaseTranslationSummary: {
            /** Format: uuid */
            caseId: string;
            /** Format: uuid */
            translationGroupId: string;
            locale: string;
            title: string;
            /** @enum {string} */
            status: "draft" | "reviewing" | "published" | "archived" | "deleted";
            rowVersion: number;
            /** Format: date-time */
            updatedAt: string;
            /** Format: uuid */
            activeReleaseId: string | null;
        };
        CaseOperationResult: {
            /** Format: uuid */
            operationId: string;
            statusCode: number;
            response: {
                [key: string]: unknown;
            };
            /** Format: uuid */
            resourceId: string | null;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            expiresAt: string;
        };
        CaseUploadSession: {
            /** Format: uuid */
            uploadId: string;
            /** Format: uuid */
            assetId: string;
            /** Format: uuid */
            assetVersionId: string;
            /** Format: date-time */
            expiresAt: string;
            multipart?: {
                /** @enum {number} */
                partSize: 8388608;
                partCount: number;
            };
        };
        CaseCreateUploadBody: {
            /** Format: uuid */
            operationId: string;
            traceId?: string;
            operatorUserKey: string;
            /** Format: uuid */
            assetId?: string;
            fileName: string;
            /** @enum {string} */
            mimeType: "image/png" | "image/jpeg" | "image/webp" | "image/avif" | "video/mp4" | "application/pdf";
            sizeBytes: number;
            sha256: string;
            /**
             * @default other
             * @enum {string}
             */
            assetType: "logo" | "cover" | "image" | "video" | "document" | "other";
            title?: string | null;
            description?: string | null;
            locale?: string | null;
            /** @default [] */
            tags: string[];
            /**
             * @default L1
             * @enum {string}
             */
            classification: "L1" | "L2" | "L3";
            /** @default false */
            customerVisible: boolean;
            /** @default false */
            customerPresentationAllowed: boolean;
            /** @default false */
            shareAllowed: boolean;
        };
        CaseAssetList: {
            items: components["schemas"]["CaseAssetSummary"][];
            nextCursor: string | null;
        };
        CaseAssetSummary: {
            /** Format: uuid */
            assetId: string;
            /** Format: uuid */
            projectId: string;
            caseIds: string[];
            /** @enum {string} */
            assetType: "logo" | "cover" | "image" | "video" | "document" | "other";
            title: string | null;
            description: string | null;
            locale: string | null;
            tags: string[];
            /** @enum {string} */
            classification: "L1" | "L2" | "L3";
            customerVisible: boolean;
            customerPresentationAllowed: boolean;
            shareAllowed: boolean;
            rowVersion: number;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
            /** Format: date-time */
            archivedAt: string | null;
            /** Format: date-time */
            deletedAt: string | null;
            currentVersion: components["schemas"]["CaseAssetVersionView"];
        };
        CaseAssetVersionView: {
            /** Format: uuid */
            projectId: string;
            /** Format: uuid */
            caseId: string | null;
            /** Format: uuid */
            assetId: string;
            /** Format: uuid */
            assetVersionId: string;
            versionNo: number;
            objectVersionId: string;
            /** @enum {string} */
            assetType: "logo" | "cover" | "image" | "video" | "document" | "other";
            title: string | null;
            description: string | null;
            locale: string | null;
            tags: string[];
            /** @enum {string} */
            classification: "L1" | "L2" | "L3";
            customerVisible: boolean;
            customerPresentationAllowed: boolean;
            shareAllowed: boolean;
            fileName: string;
            /** @enum {string} */
            mimeType: "image/png" | "image/jpeg" | "image/webp" | "image/avif" | "video/mp4" | "application/pdf";
            sizeBytes: number;
            sha256: string;
            /** @enum {string} */
            scanStatus: "pending" | "passed" | "failed";
            /** @enum {string} */
            transcodeStatus: "not_required" | "pending" | "ready" | "failed";
            /** @enum {string} */
            previewStatus: "pending" | "ready" | "failed";
            dimensions: {
                width: number;
                height: number;
            } | null;
            durationMs: number | null;
            mediaVersion: number;
            thumbnailAvailable: boolean;
            createdBy: string;
            /** Format: date-time */
            createdAt: string;
            rowVersion: number;
            /** Format: date-time */
            archivedAt: string | null;
            /** Format: date-time */
            deletedAt: string | null;
        };
        CaseAssetPatchBody: {
            /** Format: uuid */
            operationId: string;
            traceId?: string;
            operatorUserKey: string;
            expectedVersion: number;
            /** @enum {string} */
            assetType?: "logo" | "cover" | "image" | "video" | "document" | "other";
            title?: string | null;
            description?: string | null;
            locale?: string | null;
            tags?: string[];
            /** @enum {string} */
            classification?: "L1" | "L2" | "L3";
            customerVisible?: boolean;
            customerPresentationAllowed?: boolean;
            shareAllowed?: boolean;
            archived?: boolean;
            deleted?: boolean;
        };
        CaseAssetVersionList: {
            /** Format: uuid */
            assetId: string;
            items: components["schemas"]["CaseAssetVersionView"][];
        };
        CaseAssetLinkView: {
            /** Format: uuid */
            assetId: string;
            /** Format: uuid */
            caseId: string;
            linked: boolean;
        };
        CaseAssetLinkBody: {
            /** Format: uuid */
            operationId: string;
            traceId?: string;
            operatorUserKey: string;
        };
        CaseUploadTarget: {
            /** Format: uri */
            url: string;
            /** Format: date-time */
            expiresAt: string;
            /** @enum {string} */
            method: "PUT";
            headers: {
                [key: string]: string;
            };
        };
        CaseUploadedParts: {
            /** @enum {number} */
            partSize: 8388608;
            partCount: number;
            uploadedParts: {
                partNumber: number;
                sizeBytes: number;
            }[];
            merged: boolean;
        };
        CaseCompleteUploadBody: {
            /** Format: uuid */
            operationId: string;
            traceId?: string;
            operatorUserKey: string;
            objectVersionId?: string;
        };
        CaseAssetPreviewTicket: {
            /** @enum {string} */
            method: "GET";
            /** Format: uri */
            url: string;
            /** Format: date-time */
            expiresAt: string;
            objectVersionId: string;
            contentType: string;
        };
        CaseAssetDownloadTicket: {
            /** @enum {string} */
            method: "GET";
            /** Format: uri */
            url: string;
            /** Format: date-time */
            expiresAt: string;
            objectVersionId: string;
            contentType: string;
        };
        CaseAssetMediaState: {
            /** Format: uuid */
            assetId: string;
            /** Format: uuid */
            assetVersionId: string;
            objectVersionId: string;
            sha256: string;
            mediaVersion: number;
            /** @enum {string} */
            scanStatus: "pending" | "passed" | "failed";
            /** @enum {string} */
            transcodeStatus: "not_required" | "pending" | "ready" | "failed";
            /** @enum {string} */
            previewStatus: "pending" | "ready" | "failed";
            dimensions: {
                width: number;
                height: number;
            } | null;
            durationMs: number | null;
        };
        CaseSaveAssetMediaBody: {
            /** Format: uuid */
            operationId: string;
            traceId?: string;
            operatorUserKey: string;
            expectedVersion: number;
            objectVersionId: string;
            sha256: string;
            result: {
                /** @enum {string} */
                scanStatus?: "passed" | "failed";
                /** @enum {string} */
                transcodeStatus?: "ready" | "failed";
                /** @enum {string} */
                previewStatus?: "ready" | "failed";
                dimensions?: {
                    width: number;
                    height: number;
                };
                durationMs?: number;
            };
        };
        CaseReleaseReceipt: {
            /** Format: uuid */
            releaseId: string;
            /** Format: uuid */
            caseId: string;
            versionNo: number;
            /** @enum {string} */
            status: "staged" | "active" | "superseded" | "withdrawn";
            sourceVersion: number;
            caseContentHash: string;
            projectSnapshotHash: string;
            releaseHash: string;
            /** Format: date-time */
            stagedAt: string;
            /** Format: date-time */
            activatedAt: string | null;
            /** Format: date-time */
            supersededAt: string | null;
            /** Format: date-time */
            withdrawnAt: string | null;
        };
        StageCaseReleaseBody: {
            /** Format: uuid */
            operationId: string;
            traceId?: string;
            operatorUserKey: string;
            /** Format: uuid */
            externalProjectId: string;
            sourceVersion: number;
            caseSnapshot: components["schemas"]["PublishedCaseSnapshot"];
            assets: {
                /** Format: uuid */
                assetId: string;
                /** Format: uuid */
                assetVersionId: string;
                objectVersionId: string;
            }[];
        };
        PublishedCaseSnapshot: {
            /** @enum {number} */
            schemaVersion: 1;
            locale: string;
            title: string;
            /** @default null */
            summary: string | null;
            /** @default [] */
            sections: {
                heading: string;
                text: string;
            }[];
        };
        ActivateCaseReleaseBody: {
            /** Format: uuid */
            operationId: string;
            traceId?: string;
            operatorUserKey: string;
            /** Format: uuid */
            expectedActiveReleaseId: string | null;
            approvalRef: string;
        };
        DeactivateCaseReleaseBody: {
            /** Format: uuid */
            operationId: string;
            traceId?: string;
            operatorUserKey: string;
            /** Format: uuid */
            expectedActiveReleaseId: string | null;
        };
        CaseReleaseHistory: {
            /** Format: uuid */
            releaseId: string;
            /** Format: uuid */
            caseId: string;
            versionNo: number;
            /** @enum {string} */
            status: "staged" | "active" | "superseded" | "withdrawn";
            sourceVersion: number;
            caseContentHash: string;
            projectSnapshotHash: string;
            releaseHash: string;
            /** Format: date-time */
            stagedAt: string;
            /** Format: date-time */
            activatedAt: string | null;
            /** Format: date-time */
            supersededAt: string | null;
            /** Format: date-time */
            withdrawnAt: string | null;
            approvalRef: string | null;
            caseSnapshot: components["schemas"]["PublishedCaseSnapshot"];
            projectSnapshot: {
                [key: string]: unknown;
            };
            assets: {
                /** Format: uuid */
                assetId: string;
                /** Format: uuid */
                assetVersionId: string;
                objectVersionId: string;
            }[];
        };
        PublishedCaseRelease: {
            /** Format: uuid */
            releaseId: string;
            /** Format: uuid */
            caseId: string;
            versionNo: number;
            caseSnapshot: components["schemas"]["PublishedCaseSnapshot"];
            /** Format: date-time */
            activatedAt: string;
            assets: {
                /** Format: uuid */
                assetId: string;
                /** Format: uuid */
                assetVersionId: string;
                mimeType: string;
                sizeBytes: number;
            }[];
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    listCaseProjects: {
        parameters: {
            query?: {
                limit?: number;
                cursor?: string;
                status?: "active" | "paused" | "done" | "archived";
                region?: string;
                projectType?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 核心与本地项目合并的目录分页 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseProjectCatalogPage"];
                };
            };
            /** @description 服务令牌无效 */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 缺少所需 Scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 查询参数或游标无效 */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 超过本地请求频率或并发限额 */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 网关、案例数据库或其他依赖暂不可用，或案例写入受容量限制 */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
        };
    };
    registerLocalCaseProject: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RegisterLocalCaseProjectBody"];
            };
        };
        responses: {
            /** @description 已注册的本地项目目录项 */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseProjectCatalogItem"];
                };
            };
            /** @description 服务令牌无效 */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 缺少所需 Scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 案例或可选项目不存在 */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 项目编号或项目 ID 已由其他来源占用 */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 请求体过大 */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 请求参数或案例字段非法 */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 超过本地请求频率或并发限额 */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 案例请求处理失败 */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 网关、案例数据库或其他依赖暂不可用，或案例写入受容量限制 */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
        };
    };
    getCaseProject: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                projectId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 与项目目录列表完全一致的项目项 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseProjectCatalogItem"];
                };
            };
            /** @description 服务令牌无效 */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 缺少所需 Scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 案例或可选项目不存在 */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 请求参数或案例字段非法 */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 超过本地请求频率或并发限额 */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 网关、案例数据库或其他依赖暂不可用，或案例写入受容量限制 */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
        };
    };
    patchLocalCaseProject: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                projectId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PatchLocalCaseProjectBody"];
            };
        };
        responses: {
            /** @description 更新后的本地项目目录项 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseProjectCatalogItem"];
                };
            };
            /** @description 服务令牌无效 */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 缺少所需 Scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 本地项目不存在 */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 项目版本冲突、项目编号冲突、幂等冲突或核心项目只读 */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 请求体过大 */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 请求参数或案例字段非法 */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 超过本地请求频率或并发限额 */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 案例请求处理失败 */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 网关、案例数据库或其他依赖暂不可用，或案例写入受容量限制 */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
        };
    };
    listCaseProjectCases: {
        parameters: {
            query?: {
                limit?: number;
                cursor?: string;
                status?: "draft" | "reviewing" | "published" | "archived" | "deleted";
                keyword?: string;
                updatedAfter?: string;
            };
            header?: never;
            path: {
                projectId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 项目案例分页 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseListPage"];
                };
            };
            /** @description 服务令牌无效 */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 缺少所需 Scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 案例或可选项目不存在 */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 路径、筛选或游标无效 */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 超过本地请求频率或并发限额 */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 网关、案例数据库或其他依赖暂不可用，或案例写入受容量限制 */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
        };
    };
    createCase: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                projectId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CaseCreateBody"];
            };
        };
        responses: {
            /** @description 案例作者视图 */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseAuthoringView"];
                };
            };
            /** @description 服务令牌无效 */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 缺少所需 Scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 案例或可选项目不存在 */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 操作标识、项目版本或案例版本冲突 */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 请求体过大 */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 请求参数或案例字段非法 */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 超过本地请求频率或并发限额 */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 案例请求处理失败 */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 网关、案例数据库或其他依赖暂不可用，或案例写入受容量限制 */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
        };
    };
    getCaseProjectProfile: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                projectId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 案例侧项目补充信息、主体关系和项目成员 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseProjectProfileView"];
                };
            };
            /** @description 服务令牌无效 */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 缺少所需 Scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 案例或可选项目不存在 */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 请求参数或案例字段非法 */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 超过本地请求频率或并发限额 */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 案例请求处理失败 */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 网关、案例数据库或其他依赖暂不可用，或案例写入受容量限制 */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
        };
    };
    saveCaseProjectProfile: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                projectId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SaveCaseProjectProfileBody"];
            };
        };
        responses: {
            /** @description 案例侧项目补充信息、主体关系和项目成员 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseProjectProfileView"];
                };
            };
            /** @description 案例侧项目补充信息、主体关系和项目成员 */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseProjectProfileView"];
                };
            };
            /** @description 服务令牌无效 */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 缺少所需 Scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 案例或可选项目不存在 */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 操作标识、项目版本或案例版本冲突 */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 请求体过大 */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 请求参数或案例字段非法 */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 超过本地请求频率或并发限额 */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 案例请求处理失败 */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 网关、案例数据库或其他依赖暂不可用，或案例写入受容量限制 */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
        };
    };
    saveCaseSubject: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SaveCaseSubjectBody"];
            };
        };
        responses: {
            /** @description 主体及其别名 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseSubjectView"];
                };
            };
            /** @description 主体及其别名 */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseSubjectView"];
                };
            };
            /** @description 服务令牌无效 */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 缺少所需 Scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 案例或可选项目不存在 */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 操作标识、项目版本或案例版本冲突 */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 请求体过大 */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 请求参数或案例字段非法 */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 超过本地请求频率或并发限额 */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 案例请求处理失败 */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 网关、案例数据库或其他依赖暂不可用，或案例写入受容量限制 */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
        };
    };
    getCaseSubject: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                subjectId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 主体及其别名 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseSubjectView"];
                };
            };
            /** @description 服务令牌无效 */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 缺少所需 Scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 案例或可选项目不存在 */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 请求参数或案例字段非法 */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 超过本地请求频率或并发限额 */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 案例请求处理失败 */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 网关、案例数据库或其他依赖暂不可用，或案例写入受容量限制 */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
        };
    };
    getCase: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                caseId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 案例作者视图 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseAuthoringView"];
                };
            };
            /** @description 服务令牌无效 */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 缺少所需 Scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 案例或可选项目不存在 */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 请求参数或案例字段非法 */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 超过本地请求频率或并发限额 */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 案例请求处理失败 */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 网关、案例数据库或其他依赖暂不可用，或案例写入受容量限制 */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
        };
    };
    patchCase: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                caseId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CasePatchBody"];
            };
        };
        responses: {
            /** @description 案例作者视图 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseAuthoringView"];
                };
            };
            /** @description 服务令牌无效 */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 缺少所需 Scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 案例或可选项目不存在 */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 操作标识、项目版本或案例版本冲突 */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 请求体过大 */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 请求参数或案例字段非法 */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 超过本地请求频率或并发限额 */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 案例请求处理失败 */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 网关、案例数据库或其他依赖暂不可用，或案例写入受容量限制 */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
        };
    };
    listCaseVersions: {
        parameters: {
            query?: {
                limit?: number;
                cursor?: string;
            };
            header?: never;
            path: {
                caseId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 案例版本快照分页 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseVersionPage"];
                };
            };
            /** @description 服务令牌无效 */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 缺少所需 Scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 案例或可选项目不存在 */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 游标无效 */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 超过本地请求频率或并发限额 */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 网关、案例数据库或其他依赖暂不可用，或案例写入受容量限制 */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
        };
    };
    getCaseVersion: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                caseId: string;
                versionId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 不可变版本快照 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseVersion"];
                };
            };
            /** @description 服务令牌无效 */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 缺少所需 Scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 案例或可选项目不存在 */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 请求参数或案例字段非法 */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 超过本地请求频率或并发限额 */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 网关、案例数据库或其他依赖暂不可用，或案例写入受容量限制 */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
        };
    };
    restoreCaseVersion: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                caseId: string;
                versionId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CaseRestoreVersionBody"];
            };
        };
        responses: {
            /** @description 案例作者视图 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseAuthoringView"];
                };
            };
            /** @description 服务令牌无效 */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 缺少所需 Scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 案例或可选项目不存在 */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 操作标识、项目版本或案例版本冲突 */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 请求体过大 */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 请求参数或案例字段非法 */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 超过本地请求频率或并发限额 */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 案例请求处理失败 */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 网关、案例数据库或其他依赖暂不可用，或案例写入受容量限制 */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
        };
    };
    listCaseTranslations: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                caseId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 语言组和组内案例摘要 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseTranslations"];
                };
            };
            /** @description 服务令牌无效 */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 缺少所需 Scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 案例或可选项目不存在 */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 请求参数或案例字段非法 */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 超过本地请求频率或并发限额 */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 网关、案例数据库或其他依赖暂不可用，或案例写入受容量限制 */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
        };
    };
    getOperationResult: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                operationId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 已提交的原写入结果 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseOperationResult"];
                };
            };
            /** @description 服务令牌无效 */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 缺少所需 Scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 当前调用方没有已提交的操作结果 */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 操作 ID 或查询参数无效 */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 超过本地请求频率或并发限额 */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 案例请求处理失败 */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 网关、案例数据库或其他依赖暂不可用，或案例写入受容量限制 */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
        };
    };
    createProjectUpload: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                projectId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CaseCreateUploadBody"];
            };
        };
        responses: {
            /** @description 新建的项目级上传会话 */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseUploadSession"];
                };
            };
            /** @description 服务令牌无效 */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 缺少所需 Scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 当前调用方没有此资源或对象版本不存在 */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 操作冲突、上传尚未就绪或会话已完成 */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 上传会话已过期 */
            410: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 请求体过大 */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 请求参数或案例字段非法 */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 超过本地请求频率或并发限额 */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 案例请求处理失败 */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 网关、案例数据库或对象存储暂不可用，或素材处理受容量限制 */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
        };
    };
    listCaseProjectAssets: {
        parameters: {
            query?: {
                limit?: number;
                cursor?: string;
                assetType?: "logo" | "cover" | "image" | "video" | "document" | "other";
                includeArchived?: "true" | "false";
            };
            header?: never;
            path: {
                projectId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 项目级素材及每项当前版本 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseAssetList"];
                };
            };
            /** @description 服务令牌无效 */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 缺少所需 Scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 案例或可选项目不存在 */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 筛选或游标无效 */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 超过本地请求频率或并发限额 */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 网关、案例数据库或对象存储暂不可用，或素材处理受容量限制 */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
        };
    };
    listCaseAssets: {
        parameters: {
            query?: {
                limit?: number;
                cursor?: string;
                assetType?: "logo" | "cover" | "image" | "video" | "document" | "other";
                includeArchived?: "true" | "false";
            };
            header?: never;
            path: {
                caseId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 项目级素材及每项当前版本 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseAssetList"];
                };
            };
            /** @description 服务令牌无效 */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 缺少所需 Scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 案例或可选项目不存在 */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 筛选或游标无效 */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 超过本地请求频率或并发限额 */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 网关、案例数据库或对象存储暂不可用，或素材处理受容量限制 */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
        };
    };
    getCaseAsset: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                assetId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 项目级素材视图 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseAssetSummary"];
                };
            };
            /** @description 服务令牌无效 */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 缺少所需 Scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 当前调用方没有此资源或对象版本不存在 */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 操作冲突、上传尚未就绪或会话已完成 */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 上传会话已过期 */
            410: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 请求参数或案例字段非法 */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 超过本地请求频率或并发限额 */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 案例请求处理失败 */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 网关、案例数据库或对象存储暂不可用，或素材处理受容量限制 */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
        };
    };
    patchCaseAsset: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                assetId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CaseAssetPatchBody"];
            };
        };
        responses: {
            /** @description 更新后的素材视图 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseAssetSummary"];
                };
            };
            /** @description 服务令牌无效 */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 缺少所需 Scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 当前调用方没有此资源或对象版本不存在 */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 操作冲突、上传尚未就绪或会话已完成 */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 上传会话已过期 */
            410: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 请求体过大 */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 请求参数或案例字段非法 */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 超过本地请求频率或并发限额 */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 案例请求处理失败 */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 网关、案例数据库或对象存储暂不可用，或素材处理受容量限制 */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
        };
    };
    listCaseAssetVersions: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                assetId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 素材版本列表 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseAssetVersionList"];
                };
            };
            /** @description 服务令牌无效 */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 缺少所需 Scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 当前调用方没有此资源或对象版本不存在 */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 操作冲突、上传尚未就绪或会话已完成 */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 上传会话已过期 */
            410: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 请求参数或案例字段非法 */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 超过本地请求频率或并发限额 */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 案例请求处理失败 */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 网关、案例数据库或对象存储暂不可用，或素材处理受容量限制 */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
        };
    };
    linkCaseAsset: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                assetId: string;
                caseId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CaseAssetLinkBody"];
            };
        };
        responses: {
            /** @description 挂接结果 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseAssetLinkView"];
                };
            };
            /** @description 服务令牌无效 */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 缺少所需 Scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 当前调用方没有此资源或对象版本不存在 */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 操作冲突、上传尚未就绪或会话已完成 */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 上传会话已过期 */
            410: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 请求体过大 */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 请求参数或案例字段非法 */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 超过本地请求频率或并发限额 */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 案例请求处理失败 */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 网关、案例数据库或对象存储暂不可用，或素材处理受容量限制 */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
        };
    };
    unlinkCaseAsset: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                assetId: string;
                caseId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CaseAssetLinkBody"];
            };
        };
        responses: {
            /** @description 解除挂接结果 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseAssetLinkView"];
                };
            };
            /** @description 服务令牌无效 */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 缺少所需 Scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 当前调用方没有此资源或对象版本不存在 */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 操作冲突、上传尚未就绪或会话已完成 */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 上传会话已过期 */
            410: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 请求体过大 */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 请求参数或案例字段非法 */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 超过本地请求频率或并发限额 */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 案例请求处理失败 */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 网关、案例数据库或对象存储暂不可用，或素材处理受容量限制 */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
        };
    };
    createCaseUpload: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                caseId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CaseCreateUploadBody"];
            };
        };
        responses: {
            /** @description 新建的上传会话，后续单独签发上传目标 */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseUploadSession"];
                };
            };
            /** @description 服务令牌无效 */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 缺少所需 Scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 当前调用方没有此资源或对象版本不存在 */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 操作冲突、上传尚未就绪或会话已完成 */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 上传会话已过期 */
            410: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 请求体过大 */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 请求参数或案例字段非法 */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 超过本地请求频率或并发限额 */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 案例请求处理失败 */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 网关、案例数据库或对象存储暂不可用，或素材处理受容量限制 */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
        };
    };
    getCaseUploadTarget: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                uploadId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 最长 120 秒的上传目标 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseUploadTarget"];
                };
            };
            /** @description 服务令牌无效 */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 缺少所需 Scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 当前调用方没有此资源或对象版本不存在 */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 操作冲突、上传尚未就绪或会话已完成 */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 上传会话已过期 */
            410: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 请求参数或案例字段非法 */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 超过本地请求频率或并发限额 */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 案例请求处理失败 */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 网关、案例数据库或对象存储暂不可用，或素材处理受容量限制 */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
        };
    };
    listCaseUploadedParts: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                uploadId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 分片计划与当前上传进度 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseUploadedParts"];
                };
            };
            /** @description 服务令牌无效 */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 缺少所需 Scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 当前调用方没有此资源或对象版本不存在 */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 操作冲突、上传尚未就绪或会话已完成 */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 上传会话已过期 */
            410: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 请求参数或案例字段非法 */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 超过本地请求频率或并发限额 */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 案例请求处理失败 */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 网关、案例数据库或对象存储暂不可用，或素材处理受容量限制 */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
        };
    };
    getCaseUploadPartTarget: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                uploadId: string;
                partNumber: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 指定分片的上传地址和请求头 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseUploadTarget"];
                };
            };
            /** @description 服务令牌无效 */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 缺少所需 Scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 当前调用方没有此资源或对象版本不存在 */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 操作冲突、上传尚未就绪或会话已完成 */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 上传会话已过期 */
            410: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 请求参数或案例字段非法 */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 超过本地请求频率或并发限额 */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 案例请求处理失败 */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 网关、案例数据库或对象存储暂不可用，或素材处理受容量限制 */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
        };
    };
    completeCaseUpload: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                uploadId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CaseCompleteUploadBody"];
            };
        };
        responses: {
            /** @description 已持久化的素材版本，扫描状态初始为 pending */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseAssetVersionView"];
                };
            };
            /** @description 服务令牌无效 */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 缺少所需 Scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 当前调用方没有此资源或对象版本不存在 */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 操作冲突、上传尚未就绪或会话已完成 */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 上传会话已过期 */
            410: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 请求体过大 */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 请求参数或案例字段非法 */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 超过本地请求频率或并发限额 */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 案例请求处理失败 */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 网关、案例数据库或对象存储暂不可用，或素材处理受容量限制 */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
        };
    };
    getCaseAssetPreviewTicket: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                assetId: string;
                assetVersionId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 最长 60 秒的内联预览票据 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseAssetPreviewTicket"];
                };
            };
            /** @description 服务令牌无效 */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 缺少所需 Scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 当前调用方没有此资源或对象版本不存在 */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 操作冲突、上传尚未就绪或会话已完成 */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 上传会话已过期 */
            410: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 请求参数或案例字段非法 */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 超过本地请求频率或并发限额 */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 案例请求处理失败 */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 网关、案例数据库或对象存储暂不可用，或素材处理受容量限制 */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
        };
    };
    getCaseAssetDownloadTicket: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                assetId: string;
                assetVersionId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 最长 60 秒的私有版本下载票据 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseAssetDownloadTicket"];
                };
            };
            /** @description 服务令牌无效 */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 缺少所需 Scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 当前调用方没有此资源或对象版本不存在 */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 操作冲突、上传尚未就绪或会话已完成 */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 上传会话已过期 */
            410: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 请求参数或案例字段非法 */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 超过本地请求频率或并发限额 */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 案例请求处理失败 */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 网关、案例数据库或对象存储暂不可用，或素材处理受容量限制 */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
        };
    };
    getCaseMediaInput: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                assetId: string;
                assetVersionId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 固定对象版本的短时票据 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseAssetDownloadTicket"];
                };
            };
            /** @description 服务令牌无效 */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 缺少所需 Scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 当前调用方没有此资源或对象版本不存在 */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 操作冲突、上传尚未就绪或会话已完成 */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 上传会话已过期 */
            410: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 请求参数或案例字段非法 */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 超过本地请求频率或并发限额 */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 案例请求处理失败 */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 网关、案例数据库或对象存储暂不可用，或素材处理受容量限制 */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
        };
    };
    getCaseMediaState: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                assetId: string;
                assetVersionId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 绑定精确对象版本的媒体处理状态 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseAssetMediaState"];
                };
            };
            /** @description 服务令牌无效 */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 缺少所需 Scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 当前调用方没有此资源或对象版本不存在 */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 操作冲突、上传尚未就绪或会话已完成 */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 上传会话已过期 */
            410: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 请求参数或案例字段非法 */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 超过本地请求频率或并发限额 */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 案例请求处理失败 */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 网关、案例数据库或对象存储暂不可用，或素材处理受容量限制 */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
        };
    };
    saveCaseMediaResult: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                assetId: string;
                assetVersionId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CaseSaveAssetMediaBody"];
            };
        };
        responses: {
            /** @description 绑定精确对象版本的媒体处理状态 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseAssetMediaState"];
                };
            };
            /** @description 服务令牌无效 */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 缺少所需 Scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 当前调用方没有此资源或对象版本不存在 */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 操作冲突、上传尚未就绪或会话已完成 */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 上传会话已过期 */
            410: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 请求体过大 */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 请求参数或案例字段非法 */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 超过本地请求频率或并发限额 */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 案例请求处理失败 */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 网关、案例数据库或对象存储暂不可用，或素材处理受容量限制 */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
        };
    };
    stageRelease: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                caseId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["StageCaseReleaseBody"];
            };
        };
        responses: {
            /** @description 发布版本的技术状态和快照哈希 */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseReleaseReceipt"];
                };
            };
            /** @description 服务令牌无效 */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 缺少所需 Scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 案例或发布版本不存在 */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 项目版本、当前发布、状态、素材完整性或操作标识冲突 */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 请求体过大 */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 请求参数或案例字段非法 */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 超过本地请求频率或并发限额 */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 案例请求处理失败 */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 网关、公开读面或对象存储暂不可用，或案例写入受容量限制 */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
        };
    };
    activateRelease: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                caseId: string;
                releaseId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ActivateCaseReleaseBody"];
            };
        };
        responses: {
            /** @description 发布版本的技术状态和快照哈希 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseReleaseReceipt"];
                };
            };
            /** @description 服务令牌无效 */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 缺少所需 Scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 案例或发布版本不存在 */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 项目版本、当前发布、状态、素材完整性或操作标识冲突 */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 请求体过大 */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 请求参数或案例字段非法 */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 超过本地请求频率或并发限额 */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 案例请求处理失败 */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 网关、公开读面或对象存储暂不可用，或案例写入受容量限制 */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
        };
    };
    deactivateRelease: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                caseId: string;
                releaseId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["DeactivateCaseReleaseBody"];
            };
        };
        responses: {
            /** @description 发布版本的技术状态和快照哈希 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseReleaseReceipt"];
                };
            };
            /** @description 服务令牌无效 */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 缺少所需 Scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 案例或发布版本不存在 */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 项目版本、当前发布、状态、素材完整性或操作标识冲突 */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 请求体过大 */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 请求参数或案例字段非法 */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 超过本地请求频率或并发限额 */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 案例请求处理失败 */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 网关、公开读面或对象存储暂不可用，或案例写入受容量限制 */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
        };
    };
    getCaseReleaseHistory: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                caseId: string;
                releaseId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 冻结快照和原始素材引用 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseReleaseHistory"];
                };
            };
            /** @description 服务令牌无效 */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 缺少所需 Scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 案例或发布版本不存在 */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 请求参数或案例字段非法 */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 超过本地请求频率或并发限额 */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 案例请求处理失败 */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 网关、公开读面或对象存储暂不可用，或案例写入受容量限制 */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
        };
    };
    getPublishedCaseRelease: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                caseId: string;
                releaseId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description active 快照和已锁定素材版本 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublishedCaseRelease"];
                };
            };
            /** @description 服务令牌无效 */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 缺少所需 Scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 当前没有对应的 active 版本或素材 */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 请求参数或案例字段非法 */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 超过本地请求频率或并发限额 */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 案例请求处理失败 */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 网关、公开读面或对象存储暂不可用，或案例写入受容量限制 */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
        };
    };
    getPublishedCaseAsset: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                caseId: string;
                releaseId: string;
                assetVersionId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 精确对象版本的文件流 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/octet-stream": string;
                };
            };
            /** @description 服务令牌无效 */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 缺少所需 Scope */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 当前没有对应的 active 版本或素材 */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 请求参数或案例字段非法 */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 超过本地请求频率或并发限额 */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 案例请求处理失败 */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
            /** @description 网关、公开读面或对象存储暂不可用，或案例写入受容量限制 */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CaseDataGatewayError"];
                };
            };
        };
    };
}
