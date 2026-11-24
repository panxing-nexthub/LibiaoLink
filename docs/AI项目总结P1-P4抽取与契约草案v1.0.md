# AI 项目总结 P1–P4 抽取与契约草案 v1.0

> 状态：待实现（P1–P4 由项目组自行实现）。
> 配套内容口径：`docs/AI项目总结内容字段清单v1.0.md`。
> 本文只给数据结构、算法边界与验收点，不替代正式 OpenAPI / Zod 契约。

## 0. 总原则

1. 所有抽取字段统一输出「值 + 证据 + 页码 + 置信度 + 状态」；
2. 状态不是 `found` 的一律在页面显示「未识别」；
3. 抽取失败不阻断其他章节；
4. 人工值单独存储，AI 重新生成不覆盖；
5. 所有数字、日期、阶段由系统算好，模型只引用。

## 1. P1 技术协议定向抽取

### 1.1 输入

- 项目 id；
- 最新版技术协议文件（类型 =「技术协议」；无类型标记时按文件名含「技术协议 / 技术规格书」识别）；
- 文件版本 id 与原始文件名。

### 1.2 输出结构（建议）

```ts
type ExtractionStatus = "found" | "not_found" | "conflict" | "failed";

interface ExtractedField<T> {
  status: ExtractionStatus;
  value: T | null;
  evidence: string | null;   // 原文短句，≤ 600 字
  sourcePage: number | null; // 渲染页序号
  confidence: number;        // 0–1
}

interface TechnicalAgreementExtraction {
  fileId: string;
  fileVersionId: string;
  fileName: string;
  pageCount: number;
  partyA: ExtractedField<string>;
  customer: ExtractedField<string>;
  projectAddress: ExtractedField<string>;
  backgroundText: ExtractedField<string>; // 200–400 字摘要
  siteInfo: ExtractedField<string>;
  layoutPage: ExtractedField<number>;
  threeDPage: ExtractedField<number>;
  generatedAt: string;
}
```

### 1.3 字段识别

| 字段 | 识别写法 | 取值规则 |
|---|---|---|
| partyA | 甲方名称 / 甲方 / 委托方 / 买方 / 发包方 | 单位全称；优先封面、合同信息页 |
| customer | 客户 / 最终用户 / 使用单位 / 业主 | 单位全称；**不与甲方自动同值** |
| projectAddress | 项目地址 / 实施地点 / 建设地点 / 场地地址 | 项目地址，不取甲方注册地址 |
| backgroundText | 项目背景 / 需求 / 建设目标 / 项目概述 | 200–400 字摘要，只整理原文 |
| siteInfo | 场地信息 / 场地条件 | 段落摘要，可并入背景 |
| layoutPage | 布局图 / 平面布置图 / CAD 图 | 返回页序号 |
| threeDPage | 三维图 / 效果图 / 渲染图 | 返回页序号 |

### 1.4 边界

- 乙方（立镖）字段不抽取；
- 同一字段多个不同值 → `conflict`，value 置空，evidence 记录冲突值来源页；
- 甲方与客户文本相同：仍分别返回，是否同值由展示层决定（本口径：客户不自动等同甲方，但原文相同则如实返回）；
- 技术协议不存在 → 整份 extraction 为 `not_found`；
- 文件分析失败 → `failed`，保留失败原因供排查；
- 布局图页与三维图页不得相同；若模型返回同页，判定为 `conflict`。

### 1.5 页图

- 优先提取选中页的**内嵌位图**：按页面显示面积取最大一张（忽略小于页面积 5% 的图标 / 水印；1-bit 蒙版排在彩色图之后），长边限制 1600px，统一转 PNG；
- 页面没有可用内嵌位图（如纯矢量 CAD）时回退整页渲染 PNG，保留原始比例；
- 输出图需可被前端预览接口读取（受控端点，不直出对象存储）；
- 人工替换后记录 `source = "manual"`，AI 重生成不覆盖。

## 2. P2 设备清单 Excel 结构化解析

### 2.1 输入

- 最新版设备清单文件（类型 =「设备清单」；无类型标记按文件名含「设备清单 / 物料清单」）；
- 文件版本 id。

### 2.2 输出结构（建议）

```ts
interface EquipmentQuantity {
  value: number;
  unit: string;
}

interface EquipmentCategory {
  name: string;                  // Excel「分类名称」
  itemCount: number;             // 条目数
  quantities: EquipmentQuantity[]; // 按单位分别汇总
  representativeItems: string[]; // 前 3 个物料名称 / 规格
}

interface EquipmentListExtraction {
  fileId: string;
  fileVersionId: string;
  fileName: string;
  sheetName: string;
  headerRow: number;
  categories: EquipmentCategory[];
  generatedAt: string;
}
```

### 2.3 解析规则

1. 选 sheet：取存在合法表头且数据行最多的 sheet；
2. 表头行必须同时包含：分类名称 + 物料名称/项目内容 + 数量 + 单位；
3. 数据行：`No` 为数字；跳过合计 / 小计 / 备注 / 说明行；
4. 合并单元格：分类名称向下填充；
5. 按分类名称分组，不二次归并；
6. 数量：按单位分别求和，不跨单位相加；
7. 代表物料：该分类前 3 个「物料名称/项目内容 + 型号」；
8. 分类或数量为空的行跳过并计数。

### 2.4 异常

| 情况 | 结果 |
|---|---|
| 无设备清单 | not_found → 未识别 |
| 无合法表头 | failed → 未识别 |
| 文件损坏 / 加密 | failed → 未识别 |
| 只有表头无数据 | not_found → 未识别 |
| 同一分类多个单位 | 同一分类下输出多条 quantities |

### 2.5 不得做的事

- 不得用现有「文件 AI 分析」逐页摘要代替本解析（其每页最多 8 条 keyFacts 且明确不输出表格）；
- 不得对分类做二次归并；
- 不得把不同单位数量相加。

## 3. P3 AI 上下文扩展

在现有 `ProjectAiContext` 上新增（字段名为建议）：

```ts
interface ProjectAiContextV2 {
  project: {
    // 现有：id, code, name, region, projectTypes, status, managerNames, startedAt
    partyA: string | null;
    customer: string | null;
    projectAddress: string | null;
    addressSource: "technical_agreement" | null;
    period: {
      planFrom: string | null;
      planTo: string | null;
      actualFrom: string | null;
      actualTo: string | null;
      actualOngoing: boolean;
    };
    members: Array<{ name: string; role: "manager" | "task_owner" }>;
  };
  equipment: {
    categories: EquipmentCategory[];
    sourceFileName: string | null;
  };
  layout: {
    cad: { fileId: string | null; source: "agreement" | "manual"; sourcePage: number | null };
    threeD: { fileId: string | null; source: "agreement" | "manual"; sourcePage: number | null };
  };
  reportPhotos: Array<{ fileId: string; date: string; authorName: string | null }>;
  issues: Array<{
    // 现有字段
    photos: Array<{ fileId: string; name: string | null }>;
  }>;
  issueCategoryStats: Array<{ category: string; count: number }>; // 全部问题，降序
}
```

口径：

- `members`：项目经理在前，任务负责人去重追加；不用项目成员名册；
- `reportPhotos`：只含有现场附图的已提交日报，按日期升序；抽样规则在生成总结时执行；
- `issueCategoryStats`：按全部问题统计，问题可多分类时每个分类各计一次；
- 所有 null 由下游显示「未识别」，不得补 0、不得推断。

## 4. P4 总结结构 v4

### 4.1 兼容策略

- `promptVersion` 升到新版本，旧缓存不再读取；
- 新增的 8 段为必选结构；
- 旧 v2 的 `timeline` / `resultsAndRisks` / `handoff` / `notes` 保留在 `extra`，页面可继续展示，后续再决定删减；
- `summaryText` 保留，作为摘要 / 列表展示。

### 4.2 建议结构

```ts
interface ProjectSummaryDocument {
  title: string;
  basicInfo: {
    projectCode: string;
    projectName: string;
    periodText: string;        // 计划 ...；实际 ...
    partyA: string;            // 或「未识别」
    customer: string;
    address: string;
    members: string;           // 张三（项目经理）、李四
    sources: string[];
  };
  equipmentLayout: {
    cadImage: { fileId: string | null; caption: string };
    threeDImage: { fileId: string | null; caption: string };
    sources: string[];
  };
  background: {
    text: string;              // 200–400 字或「未识别」
    sources: string[];
  };
  equipmentList: {
    rows: Array<{ category: string; itemCount: number; quantityText: string; representative: string }>;
    sources: string[];
  };
  progress: {
    text: string;
    table: Array<{ stage: string; status: string; planText: string; actualText: string; done: number; total: number; percent: number | null }>;
    percent: number | null;
    sources: string[];
  };
  sitePhotos: Array<{ fileId: string; caption: string }>;
  issues: {
    rows: Array<{
      index: number;
      title: string;
      categories: string[];
      state: string;
      owner: string;
      raisedAt: string;
      solution: string;
      closedAt: string;
      photos: Array<{ fileId: string; name: string | null }>;
    }>;
    summary: string;           // 聚焦前两个分类
    categoryStats: Array<{ category: string; count: number }>;
    sources: string[];
  };
  personalSummary: string;     // 人工填写，AI 不生成
  extra: {
    // 旧 v2：timeline / resultsAndRisks / handoff / notes
  };
  sourceAppendix: Array<{ fileName: string; docType: string; version: string; date: string }>;
}
```

### 4.3 模型边界

- 模型只生成 `background.text`、`progress.text`、`issues.summary` 与 `extra`；
- `basicInfo` 的编号 / 名称 / 周期 / 甲方 / 客户 / 地址 / 成员由采集器直接填，不交给模型改写；
- `equipmentList`、`progress.table`、`issues.rows`、`sitePhotos` 由采集器直接填，模型不得改数；
- `personalSummary` 永不进入模型输出；
- 所有模型文本必须能对应到来源。

## 5. 验收清单

### P1

- [ ] 封面「甲方名称 / 乙方名称」可稳定抽到甲方，乙方不出现；
- [ ] 只有甲方、没有客户时，客户 = 未识别；
- [ ] 地址抽项目地址，不抽甲方注册地址；
- [ ] 同一字段冲突 → 未识别并记录冲突；
- [ ] 布局图 / 三维图可返回页内嵌图（无内嵌图时整页渲染）并渲染；
- [ ] 无技术协议时其余章节不受影响。

### P2

- [ ] 截图样表可解析出 3 个分类与数量（1 套 / 2 套 / 207 个）；
- [ ] 合并单元格分类名称可向下填充；
- [ ] 合计行不被计入；
- [ ] 多单位不跨单位相加；
- [ ] 无表头 / 损坏文件 → 未识别。

### P3

- [ ] 项目组成员只含项目经理 + 任务负责人，且无重复；
- [ ] 计划区间与实际区间分别返回，未完成标记 ongoing；
- [ ] 现场图片返回 fileId + 日期 + 作者；
- [ ] 问题返回全部图片引用；
- [ ] 问题分类统计为全部问题，按数量降序。

### P4

- [ ] 新 promptVersion 不读取旧缓存；
- [ ] 8 段结构完整，缺数据时写「未识别」；
- [ ] 模型不改写 basicInfo / 表格 / 图片；
- [ ] 个人总结不被模型覆盖；
- [ ] 旧 v2 内容保留在 extra，页面仍可展示；
- [ ] 文末来源清单可生成。

## 6. 安全与权限

- 生成总结仍按现有 `project.export` 门禁（数据出站到外部模型）；
- 技术协议与设备清单解析只读当前项目文件；
- 页图与图片走受控预览签名，不直出对象存储；
- 日志不得打印协议正文、甲方联系方式等敏感内容。

## 6.1 人工替换布局图 / 三维图（实现补充）

- 表：`project_ai_manual_images`（迁移 0115），主键 `(project_id, kind)`，kind = `layout` / `three_d`；
- 读：人工值优先于技术协议自动判页；对象键只存库内，读图走受控端点；
- 写：`POST /api/v1/projects/{id}/ai-agreement-images/{kind}`（multipart 字段 `file`，PNG / JPEG / WebP，≤ 10 MB，需 `project.export`），服务端按文件魔数判真实类型；
- 缓存：读图 URL 带 `?v=<人工更新时间或抽取时间>`，替换后无需重新生成总结；
- 存储：`projects/{projectId}/ai-extraction/manual/{kind}-{hash}.{ext}`。

## 7. 变更记录

| 日期 | 版本 | 说明 |
|---|---|---|
| 2026-11-24 | v1.0 | P1–P4 抽取结构、上下文扩展、总结 v4 结构与验收清单 |
