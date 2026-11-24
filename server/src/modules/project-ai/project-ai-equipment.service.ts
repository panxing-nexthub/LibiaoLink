import { Injectable, Logger } from "@nestjs/common";
import { and, desc, eq, inArray, isNull, like, or, sql } from "drizzle-orm";
import type { ProjectAiEquipment } from "@libiaolink/contracts";
import { DatabaseService } from "../../db/database.service.js";
import { files, fileVersions } from "../../db/schema/files.js";
import { ObjectStorage } from "../../storage/index.js";
import { parseEquipmentWorkbook } from "./project-ai-equipment.parser.js";

/** 设备清单文件上限：Excel 原文件通常很小，超过 50MB 直接判未识别，避免把 API 堆内存打满。 */
const MAX_EQUIPMENT_FILE_BYTES = 50 * 1024 * 1024;
/** 缓存时长：同一文件版本 10 分钟内不重复下载解析。 */
const CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_CACHE_ENTRIES = 50;

/**
 * 设备清单 Excel 结构化解析（P2）。
 *
 * 只读当前版本的「设备清单」文件：优先 doc_type = 设备清单，其次文件名含设备清单 / 物料清单。
 * 按「分类名称」列聚合，不做二次归并；数量按单位分别汇总。
 * 解析结果按 fileVersionId 缓存 10 分钟；不写库、不调用模型。
 */
@Injectable()
export class ProjectAiEquipmentService {
  private readonly logger = new Logger(ProjectAiEquipmentService.name);
  private readonly cache = new Map<string, { expiresAt: number; value: ProjectAiEquipment | null }>();

  constructor(
    private readonly database: DatabaseService,
    private readonly storage: ObjectStorage,
  ) {}

  async load(projectId: string): Promise<ProjectAiEquipment | null> {
    const rows = await this.database.db
      .select({
        fileName: files.name,
        objectKey: fileVersions.objectKey,
        versionId: fileVersions.id,
        sizeBytes: fileVersions.sizeBytes,
      })
      .from(files)
      .innerJoin(fileVersions, eq(fileVersions.id, files.currentVersionId))
      .where(
        and(
          eq(files.projectId, projectId),
          inArray(files.status, ["draft", "final", "changed", "archived"]),
          isNull(files.recycledAt),
          or(
            eq(files.docType, "设备清单"),
            eq(files.docType, "物料总清单"),
            like(files.name, "%设备清单%"),
            like(files.name, "%物料清单%"),
            like(files.name, "%物料总清单%"),
          ),
        ),
      )
      .orderBy(
        desc(sql`case when ${files.docType} = '设备清单' then 2 when ${files.docType} = '物料总清单' then 1 else 0 end`),
        desc(files.updatedAt),
      )
      .limit(5);

    for (const row of rows) {
      if (row.sizeBytes > MAX_EQUIPMENT_FILE_BYTES) continue;
      if (!/\.(xlsx|xlsm)$/i.test(row.fileName)) continue;
      const cached = this.cached(row.versionId);
      if (cached !== undefined) return cached;
      const value = await this.parse(row.fileName, row.objectKey, row.versionId);
      this.remember(row.versionId, value);
      return value;
    }
    return null;
  }

  private cached(versionId: string): ProjectAiEquipment | null | undefined {
    const entry = this.cache.get(versionId);
    if (entry === undefined) return undefined;
    if (entry.expiresAt < Date.now()) {
      this.cache.delete(versionId);
      return undefined;
    }
    return entry.value;
  }

  private remember(versionId: string, value: ProjectAiEquipment | null): void {
    if (this.cache.size >= MAX_CACHE_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(versionId, { expiresAt: Date.now() + CACHE_TTL_MS, value });
  }

  private async parse(fileName: string, objectKey: string, versionId: string): Promise<ProjectAiEquipment | null> {
    try {
      const object = await this.storage.getObject(objectKey);
      if (object === null) return null;
      const categories = await parseEquipmentWorkbook(object.bytes);
      if (categories.length === 0) return null;
      return { sourceFileName: fileName, categories };
    } catch (error) {
      this.logger.warn(
        "设备清单解析失败：file=" + fileName + " version=" + versionId + " error=" +
          (error instanceof Error ? error.message : String(error)),
      );
      return null;
    }
  }
}
