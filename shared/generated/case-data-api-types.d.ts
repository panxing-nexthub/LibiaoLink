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
        get?: never;
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
    "/api/v1/projects/{projectId}/cases": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 创建案例
         * @description 本地 Scope 为 case-data:cases:write。业务 operationId 通过请求体传递。
         */
        post: operations["createCase"];
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
         * @description 本地 Scope 为 case-data:cases:read。
         */
        get: operations["getCase"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * 更新案例
         * @description 本地 Scope 为 case-data:cases:write。JSON 对象整列替换。
         */
        patch: operations["patchCase"];
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
         * @description 本地 Scope 为 case-data:assets:write。提供 assetId 时创建同一素材的新版本。大于 32 MiB 自动进入分片模式。
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
         * @description 本地 Scope 为 case-data:assets:write。单次 PUT 可提交对象版本 ID，丢失 PUT 回执时可省略，由网关按会话键查验唯一版本。分片模式省略该字段，由网关检查与合并分片。两种模式均校验精确版本的大小、MIME 和 SHA-256。
         */
        post: operations["completeCaseUpload"];
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
         * @description 本地 Scope 为 case-data:assets:read。票据绑定已登记的对象版本，供当前服务调用方下载。
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
            sourceVersion: number;
            /** Format: date-time */
            updatedAt: string;
            /** Format: date-time */
            archivedAt: string | null;
            deletedAt: null;
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
                regions?: string[];
                country?: string;
                industry?: string;
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
            sourceVersion: number;
            locale: string;
            title: string;
            summary?: string | null;
            changeSummary?: string | null;
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
            mimeType: "image/png" | "image/jpeg" | "image/webp" | "video/mp4" | "application/pdf";
            sizeBytes: number;
            sha256: string;
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
        CaseAssetVersion: {
            /** Format: uuid */
            caseId: string;
            /** Format: uuid */
            assetId: string;
            /** Format: uuid */
            assetVersionId: string;
            objectVersionId: string;
            fileName: string;
            /** @enum {string} */
            mimeType: "image/png" | "image/jpeg" | "image/webp" | "video/mp4" | "application/pdf";
            sizeBytes: number;
            sha256: string;
            /** @enum {string} */
            scanStatus: "pending" | "passed" | "failed";
            /** @enum {string} */
            transcodeStatus: "not_required" | "pending" | "ready" | "failed";
        };
        CaseCompleteUploadBody: {
            /** Format: uuid */
            operationId: string;
            traceId?: string;
            operatorUserKey: string;
            objectVersionId?: string;
        };
        CaseAssetDownloadTicket: {
            /** @enum {string} */
            method: "GET";
            /** Format: uri */
            url: string;
            /** Format: date-time */
            expiresAt: string;
            objectVersionId: string;
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
                    "application/json": components["schemas"]["CaseAssetVersion"];
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
