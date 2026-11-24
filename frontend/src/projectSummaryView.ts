/**
 * AI 项目总结文档视图模型。
 *
 * 输入 = 现有只读上下文 + 总结报告 + 日报（含现场图）+ 问题（含问题图）。
 * P3/P4 上线前：能由现有数据算出的先算，算不出的字段保持 null，由页面显示「未识别」。
 * P3/P4 上线后：优先使用 report.basicInfo / equipmentLayout / equipmentList / progressDetail /
 * sitePhotos / issueTable / personalSummary，前端不改页面结构。
 */
import type {
  ProjectAiContext,
  ProjectAiContextMember,
  ProjectAiFileAnalysis,
  ProjectAiSummary,
  ProjectAiSummaryEquipmentRow,
  ProjectAiSummaryIssue,
  ProjectAiSummaryIssueRowV4,
  ProjectAiSummaryReportEntry,
  ProjectAiSummaryReportV4,
} from "./projectAiApi";

export type SummaryPhoto = { fileId: string | null; name: string; url: string | null };

export type SummaryPeriod = {
  planFrom: string | null;
  planTo: string | null;
  actualFrom: string | null;
  actualTo: string | null;
  ongoing: boolean;
};

export type SummaryBasicInfo = {
  code: string;
  name: string;
  periodText: string | null;
  period: SummaryPeriod | null;
  partyA: string | null;
  customer: string | null;
  address: string | null;
  members: Array<{ name: string; role: "manager" | "task_owner" }>;
  sources: string[];
};

export type SummaryProgressRow = {
  stage: string;
  status: string;
  planText: string;
  actualText: string;
  done: number;
  total: number;
  percent: number | null;
};

export type SummaryIssueRow = {
  index: number;
  id: string;
  title: string;
  categories: string[];
  state: string;
  owner: string | null;
  raisedAt: string;
  solution: string | null;
  closedAt: string | null;
  photos: SummaryPhoto[];
};

export type SummaryView = {
  code: string;
  name: string;
  basic: SummaryBasicInfo;
  layout: {
    cad: SummaryPhoto | null;
    threeD: SummaryPhoto | null;
    sources: string[];
  };
  background: { text: string | null; sources: string[] };
  equipment: { rows: ProjectAiSummaryEquipmentRow[]; source: string | null };
  progress: {
    text: string | null;
    rows: SummaryProgressRow[];
    percent: number | null;
    done: number;
    total: number;
    latestStage: string | null;
    slowestStage: string | null;
  };
  sitePhotos: Array<{ photo: SummaryPhoto; caption: string }>;
  issues: {
    rows: SummaryIssueRow[];
    summary: string | null;
    stats: Array<{ category: string; count: number }>;
    topTwo: string[];
  };
  personal: string | null;
  sourceAppendix: Array<{ fileName: string; docType: string; version: string; date: string }>;
};

function clean(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === "" || trimmed === "未识别" ? null : trimmed;
}

function agreementField(field: { status: string; value: string | null } | undefined): string | null {
  return field !== undefined && field.status === "found" ? clean(field.value) : null;
}

function actualPeriodText(value: string | null): string | null {
  if (value === null) return null;
  const marker = value.lastIndexOf("实际 ");
  if (marker < 0) return value;
  return value.slice(marker + 3).trim();
}

function unique(values: readonly string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter((value) => value !== "")));
}

function minDate(values: ReadonlyArray<string | null | undefined>): string | null {
  const usable = values.filter((value): value is string => typeof value === "string" && value !== "");
  if (usable.length === 0) return null;
  return usable.reduce((min, value) => (value < min ? value : min));
}

function maxDate(values: ReadonlyArray<string | null | undefined>): string | null {
  const usable = values.filter((value): value is string => typeof value === "string" && value !== "");
  if (usable.length === 0) return null;
  return usable.reduce((max, value) => (value > max ? value : max));
}

function rangeText(from: string | null, to: string | null): string {
  return (from ?? "未识别") + " ~ " + (to ?? "未识别");
}

function agreementAnalyses(context: ProjectAiContext | null): ProjectAiFileAnalysis[] {
  return (context?.fileAnalyses ?? []).filter((file) =>
    /技术协议|技术规格书/i.test(file.fileName + " " + file.summary.documentType),
  );
}

function factText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map((item) => factText(item)).filter((item) => item !== "").join("、");
  return "";
}

function agreementFact(context: ProjectAiContext | null, patterns: readonly RegExp[]): string | null {
  for (const file of agreementAnalyses(context)) {
    for (const fact of file.summary.keyFacts) {
      const key = fact.key ?? "";
      if (!patterns.some((pattern) => pattern.test(key))) continue;
      const value = factText(fact.value);
      if (value !== "") return value;
    }
  }
  return null;
}

function backgroundFromAgreement(context: ProjectAiContext | null): string | null {
  const pieces = agreementAnalyses(context)
    .flatMap((file) => file.summary.summaries)
    .map((text) => text.trim())
    .filter((text) => text !== "");
  if (pieces.length === 0) return null;
  const merged = pieces.join("\n");
  return merged.length > 1200 ? merged.slice(0, 1200) + "…" : merged;
}

function membersOf(context: ProjectAiContext | null): Array<{ name: string; role: "manager" | "task_owner" }> {
  if (context === null) return [];
  const provided: ProjectAiContextMember[] | null | undefined = context.project.members;
  if (Array.isArray(provided) && provided.length > 0) {
    return provided
      .filter((member) => typeof member.name === "string" && member.name.trim() !== "")
      .map((member) => ({ name: member.name.trim(), role: member.role }));
  }
  const managers = unique((context.project.managerNames ?? []).filter((name): name is string => name !== null));
  const owners = unique(
    (context.tasks ?? []).flatMap((task) => task.ownerNames ?? []).filter((name): name is string => name !== null),
  ).filter((name) => !managers.includes(name));
  return [
    ...managers.map((name) => ({ name, role: "manager" as const })),
    ...owners.map((name) => ({ name, role: "task_owner" as const })),
  ];
}

function periodOf(context: ProjectAiContext | null): SummaryPeriod | null {
  if (context === null) return null;
  const provided = context.project.period;
  if (provided !== null && provided !== undefined) {
    const empty = provided.planFrom === null && provided.planTo === null && provided.actualFrom === null && provided.actualTo === null;
    if (empty && !provided.actualOngoing) return null;
    return {
      planFrom: provided.planFrom,
      planTo: provided.planTo,
      actualFrom: provided.actualFrom,
      actualTo: provided.actualTo,
      ongoing: provided.actualOngoing,
    };
  }
  const planFrom = context.metrics.planStart;
  const planTo = context.metrics.planEnd;
  const stages = context.stages ?? [];
  const actualFrom = minDate(stages.map((stage) => stage.actualStart)) ?? context.project.startedAt;
  const actualTo = maxDate(stages.map((stage) => stage.actualEnd));
  const ongoing = context.metrics.taskTotal > 0 && context.metrics.taskDone < context.metrics.taskTotal;
  if (planFrom === null && planTo === null && actualFrom === null && actualTo === null) return null;
  return { planFrom, planTo, actualFrom, actualTo, ongoing };
}

function layoutOf(
  report: ProjectAiSummaryReportV4,
  context: ProjectAiContext | null,
): { cad: SummaryPhoto | null; threeD: SummaryPhoto | null; sources: string[] } {
  const fromReport = report.equipmentLayout;
  const reportCad = fromReport?.cadImage;
  const reportThreeD = fromReport?.threeDImage;

  // 人工替换 / 最新抽取结果优先于生成时缓存的 report.equipmentLayout。
  const cad: SummaryPhoto | null =
    context?.agreement?.layout.url !== null && context?.agreement?.layout.url !== undefined
      ? { fileId: null, name: context.agreement.layout.caption ?? "CAD 布局图", url: context.agreement.layout.url }
      : reportCad !== undefined && (reportCad.fileId !== null || reportCad.url !== null)
        ? { fileId: reportCad.fileId, name: reportCad.caption === "" ? "CAD 布局图" : reportCad.caption, url: reportCad.url }
        : context?.layout?.cad?.fileId !== null && context?.layout?.cad?.fileId !== undefined
          ? { fileId: context.layout.cad.fileId, name: "CAD 布局图", url: null }
          : null;

  const threeD: SummaryPhoto | null =
    context?.agreement?.threeD.url !== null && context?.agreement?.threeD.url !== undefined
      ? { fileId: null, name: context.agreement.threeD.caption ?? "三维图", url: context.agreement.threeD.url }
      : reportThreeD !== undefined && (reportThreeD.fileId !== null || reportThreeD.url !== null)
        ? { fileId: reportThreeD.fileId, name: reportThreeD.caption === "" ? "三维图" : reportThreeD.caption, url: reportThreeD.url }
        : context?.layout?.threeD?.fileId !== null && context?.layout?.threeD?.fileId !== undefined
          ? { fileId: context.layout.threeD.fileId, name: "三维图", url: null }
          : null;

  return { cad, threeD, sources: cad === null && threeD === null ? [] : ["技术协议"] };
}

function sampleSitePhotos(reports: readonly ProjectAiSummaryReportEntry[]): Array<{ photo: SummaryPhoto; caption: string }> {
  const byDate = new Map<string, Array<{ photo: SummaryPhoto; caption: string }>>();
  for (const report of reports) {
    if (report.state === "draft") continue;
    const date = report.date;
    const caption = report.authorName === null || report.authorName.trim() === "" ? date : date + " · " + report.authorName;
    const list = byDate.get(date) ?? [];
    for (const [index, photo] of report.photos.entries()) {
      list.push({
        photo: { fileId: photo.fileId, name: photo.name ?? "现场图片 " + String(index + 1), url: null },
        caption,
      });
    }
    byDate.set(date, list);
  }
  const dates = Array.from(byDate.keys()).sort();
  const picked: Array<{ photo: SummaryPhoto; caption: string }> = [];
  const seen = new Set<string>();
  for (let round = 0; round < 12; round += 1) {
    let added = false;
    for (const date of dates) {
      const list = byDate.get(date) ?? [];
      const item = list[round];
      if (item === undefined) continue;
      added = true;
      const fileId = item.photo.fileId;
      if (fileId === null || seen.has(fileId)) continue;
      seen.add(fileId);
      picked.push(item);
      if (picked.length >= 12) return picked;
    }
    if (!added) break;
  }
  return picked;
}

function issueRowsFromFetched(issues: readonly ProjectAiSummaryIssue[]): SummaryIssueRow[] {
  return issues.map((issue, index) => ({
    index: index + 1,
    id: issue.id,
    title: issue.title,
    categories: [...issue.categories],
    state: issue.state,
    owner: issue.ownerName,
    raisedAt: issue.raisedAt,
    solution: issue.solution,
    closedAt: issue.closedAt,
    photos: issue.photos.map((photo) => ({ fileId: photo.fileId, name: photo.name ?? "问题图片", url: null })),
  }));
}

function issueRowsFromContext(context: ProjectAiContext | null): SummaryIssueRow[] {
  return (context?.issues ?? []).map((issue, index) => ({
    index: index + 1,
    id: issue.issueId,
    title: issue.title,
    categories: [...issue.categories],
    state: issue.state,
    owner: issue.ownerName,
    raisedAt: issue.raisedAt,
    solution: issue.solution,
    closedAt: issue.closedAt,
    photos: (issue.photos ?? []).map((photo) => ({ fileId: photo.fileId, name: photo.name ?? "问题图片", url: null })),
  }));
}

function issueRowsFromV4(rows: readonly ProjectAiSummaryIssueRowV4[]): SummaryIssueRow[] {
  return rows.map((row) => ({
    index: row.index,
    id: row.index + "-" + row.title,
    title: row.title,
    categories: [...row.categories],
    state: row.state,
    owner: row.owner,
    raisedAt: row.raisedAt,
    solution: row.solution,
    closedAt: row.closedAt,
    photos: row.photos.map((photo) => ({ fileId: photo.fileId, name: photo.name ?? "问题图片", url: null })),
  }));
}

function categoryStats(rows: readonly SummaryIssueRow[]): Array<{ category: string; count: number }> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    for (const category of unique(row.categories)) {
      counts.set(category, (counts.get(category) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => (b.count - a.count === 0 ? a.category.localeCompare(b.category) : b.count - a.count));
}

export function buildProjectSummaryView(input: {
  context: ProjectAiContext | null;
  summary: ProjectAiSummary;
  reports: readonly ProjectAiSummaryReportEntry[];
  issues: readonly ProjectAiSummaryIssue[];
}): SummaryView {
  const { context, summary, reports, issues } = input;
  const report = summary.report;

  const reportBasic = report.basicInfo;
  const code = reportBasic?.projectCode ?? context?.project.code ?? report.overview.projectCode;
  const name = reportBasic?.projectName ?? context?.project.name ?? report.overview.projectName;

  const partyA =
    agreementField(context?.agreement?.partyA) ??
    clean(reportBasic?.partyA) ??
    clean(context?.project.partyA) ??
    agreementFact(context, [/甲方|委托方|买方|发包方/]);
  const customer =
    agreementField(context?.agreement?.customer) ??
    clean(reportBasic?.customer) ??
    agreementFact(context, [/客户|最终用户|使用单位|业主/]);
  const address =
    agreementField(context?.agreement?.projectAddress) ??
    clean(reportBasic?.address) ??
    clean(context?.project.projectAddress) ??
    agreementFact(context, [/项目地址|实施地点|建设地点|场地地址/]);
  const period = periodOf(context);

  const basic: SummaryBasicInfo = {
    code,
    name,
    periodText: actualPeriodText(reportBasic?.periodText ?? null),
    period,
    partyA: partyA === null || partyA.trim() === "" ? null : partyA,
    customer: customer === null || customer.trim() === "" ? null : customer,
    address: address === null || address.trim() === "" ? null : address,
    members: membersOf(context),
    sources: unique([
      "系统项目档案",
      ...(reportBasic?.sources ?? []),
      partyA !== null || customer !== null || address !== null ? "技术协议" : "",
    ]),
  };

  const backgroundText =
    clean(report.background?.text) ??
    agreementField(context?.agreement?.background) ??
    backgroundFromAgreement(context);
  const background: { text: string | null; sources: string[] } = {
    text: backgroundText !== null && backgroundText !== "" ? backgroundText : null,
    sources: backgroundText !== null && backgroundText !== "" ? ["技术协议"] : [],
  };

  const layout = layoutOf(report, context);

  const equipmentRows: ProjectAiSummaryEquipmentRow[] =
    report.equipmentList?.rows ??
    (context?.equipment?.categories ?? []).map((category) => ({
      category: category.name,
      itemCount: category.itemCount,
      quantityText: category.quantities.map((quantity) => String(quantity.value) + (quantity.unit === "" ? "" : " " + quantity.unit)).join("、"),
      representative: category.representativeItems.join("、"),
    }));
  const equipment = {
    rows: equipmentRows,
    source: equipmentRows.length === 0 ? null : (context?.equipment?.sourceFileName ?? "设备清单"),
  };

  const progressRows: SummaryProgressRow[] =
    report.progressDetail?.table ??
    (context?.stages ?? []).map((stage) => ({
      stage: stage.name,
      status: stage.status,
      planText: rangeText(stage.plannedStart, stage.plannedEnd),
      actualText: rangeText(stage.actualStart, stage.actualEnd),
      done: stage.taskDoneCount,
      total: stage.taskTotalCount,
      percent: stage.taskTotalCount > 0 ? Math.round((stage.taskDoneCount / stage.taskTotalCount) * 100) : null,
    }));

  const progress = {
    text: report.progressDetail?.text ?? null,
    rows: progressRows,
    percent: report.progressDetail?.percent ?? context?.metrics.percent ?? report.overview.progress.percent,
    done: context?.metrics.taskDone ?? report.overview.progress.done,
    total: context?.metrics.taskTotal ?? report.overview.progress.total,
    latestStage: context?.metrics.latestStage ?? report.overview.progress.latestStage,
    slowestStage: context?.metrics.slowestStage ?? report.overview.progress.slowestStage,
  };

  const sitePhotos =
    report.sitePhotos != null
      ? report.sitePhotos.map((photo) => ({
          photo: { fileId: photo.fileId, name: photo.caption, url: null },
          caption: photo.caption,
        }))
      : context?.reportPhotos !== undefined && context.reportPhotos.length > 0
        ? context.reportPhotos.map((photo) => ({
            photo: { fileId: photo.fileId, name: photo.name, url: null },
            caption: photo.authorName === null ? photo.date : photo.date + " · " + photo.authorName,
          }))
        : sampleSitePhotos(reports);

  const rows = report.issueTable == null
    ? issues.length > 0
      ? issueRowsFromFetched(issues)
      : issueRowsFromContext(context)
    : issueRowsFromV4(report.issueTable.rows);
  const stats = report.issueTable?.categoryStats ?? context?.issueCategoryStats ?? categoryStats(rows);
  const topTwo = stats.slice(0, 2).map((entry) => entry.category);
  const issueSummary = report.issueTable?.summary ?? (report.issues.summary.trim() === "" ? null : report.issues.summary);

  return {
    code,
    name,
    basic,
    layout,
    background,
    equipment,
    progress,
    sitePhotos,
    issues: { rows, summary: issueSummary, stats, topTwo },
    personal: report.personalSummary?.trim() === "" || report.personalSummary === undefined ? null : report.personalSummary,
    sourceAppendix: report.sourceAppendix ?? [],
  };
}
