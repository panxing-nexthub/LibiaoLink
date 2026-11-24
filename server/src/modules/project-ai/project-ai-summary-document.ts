import type { ProjectAiContext, ProjectAiSummaryReport } from "@libiaolink/contracts";

/** 总结文档是中文交付物；缺失统一写「未识别」。 */
const UNKNOWN = "未识别";

function text(value: string | null | undefined): string {
  return value === null || value === undefined || value.trim() === "" ? UNKNOWN : value;
}

function rangeText(from: string | null, to: string | null): string {
  return (from ?? UNKNOWN) + " ~ " + (to ?? UNKNOWN);
}

function periodText(context: ProjectAiContext): string {
  const period = context.project.period;
  if (period === null || period === undefined) return UNKNOWN;
  const plan = "计划 " + rangeText(period.planFrom, period.planTo);
  const actual = "实际 " + (period.actualFrom ?? UNKNOWN) + " ~ " + (period.actualOngoing ? "进行中" : (period.actualTo ?? UNKNOWN));
  return plan + " / " + actual;
}

function progressText(context: ProjectAiContext): string {
  const metrics = context.metrics;
  const percent = metrics.percent === null ? UNKNOWN : String(metrics.percent) + "%";
  const latest = metrics.latestStage ?? (metrics.taskTotal > 0 ? "全部完成" : "暂无已动工任务");
  const slowest = metrics.slowestStage ?? (metrics.taskTotal > 0 ? "全部完成" : "暂无任务");
  return (
    "已完成 " + String(metrics.taskDone) + " / " + String(metrics.taskTotal) + " 项任务（" + percent + "），" +
    "最新阶段：" + latest + "，最慢阶段：" + slowest + "。"
  );
}

function stageStatusText(status: string): string {
  if (status === "done") return "已完成";
  if (status === "active") return "进行中";
  return "未开始";
}

/**
 * P4：把采集器数据确定性补齐为文档字段。
 *
 * 模型只负责 summary / timeline / issues.summary / resultsAndRisks / handoff / notes；
 * 基本信息、设备布局、背景、设备清单、进度表、现场图片、问题全量表、来源清单全部由这里写入，
 * 避免模型改数、编造图片或表格。
 */
export function buildSummaryDocument(
  context: ProjectAiContext,
  report: ProjectAiSummaryReport,
): Partial<ProjectAiSummaryReport> {
  const agreement = context.agreement ?? null;
  const members = (context.project.members ?? [])
    .map((member) => (member.role === "manager" ? member.name + "（项目经理）" : member.name))
    .join("、");

  const progressRows = context.stages.map((stage) => ({
    stage: stage.name,
    status: stage.status,
    planText: rangeText(stage.plannedStart, stage.plannedEnd),
    actualText: rangeText(stage.actualStart, stage.actualEnd),
    done: stage.taskDoneCount,
    total: stage.taskTotalCount,
    percent: stage.taskTotalCount > 0 ? Math.round((stage.taskDoneCount / stage.taskTotalCount) * 100) : null,
  }));

  const document: Partial<ProjectAiSummaryReport> = {
    basicInfo: {
      projectCode: context.project.code,
      projectName: context.project.name,
      periodText: periodText(context),
      partyA: agreement !== null && agreement.partyA.status === "found" ? text(agreement.partyA.value) : UNKNOWN,
      customer: agreement !== null && agreement.customer.status === "found" ? text(agreement.customer.value) : UNKNOWN,
      address:
        agreement !== null && agreement.projectAddress.status === "found"
          ? text(agreement.projectAddress.value)
          : UNKNOWN,
      members: members === "" ? UNKNOWN : members,
      sources: ["系统项目档案", ...(agreement === null ? [] : ["技术协议"])],
    },
    equipmentLayout: {
      cadImage: {
        fileId: null,
        url: agreement?.layout.url ?? null,
        caption: agreement?.layout.caption ?? "",
      },
      threeDImage: {
        fileId: null,
        url: agreement?.threeD.url ?? null,
        caption: agreement?.threeD.caption ?? "",
      },
    },
    progressDetail: {
      text: progressText(context),
      table: progressRows,
      percent: context.metrics.percent,
    },
  };

  if (agreement !== null && agreement.background.status === "found" && agreement.background.value !== null) {
    document.background = { text: agreement.background.value };
  }

  if (context.equipment !== null && context.equipment !== undefined && context.equipment.categories.length > 0) {
    document.equipmentList = {
      rows: context.equipment.categories.map((category) => ({
        category: category.name,
        itemCount: category.itemCount,
        quantityText: category.quantities
          .map((quantity) => String(quantity.value) + (quantity.unit === "" ? "" : " " + quantity.unit))
          .join("、"),
        representative: category.representativeItems.join("、"),
      })),
    };
  }

  if (context.reportPhotos !== undefined && context.reportPhotos.length > 0) {
    document.sitePhotos = context.reportPhotos.map((photo) => ({
      fileId: photo.fileId,
      caption: photo.authorName === null ? photo.date : photo.date + " · " + photo.authorName,
    }));
  }

  if (context.issues.length > 0) {
    document.issueTable = {
      rows: context.issues.map((issue, index) => ({
        index: index + 1,
        title: issue.title,
        categories: [...issue.categories],
        state: issue.state,
        owner: issue.ownerName ?? "",
        raisedAt: issue.raisedAt,
        solution: issue.solution ?? "",
        closedAt: issue.closedAt === null ? "" : issue.closedAt.slice(0, 10),
        photos: (issue.photos ?? []).map((photo) => ({ fileId: photo.fileId, name: photo.name })),
      })),
      summary: report.issues.summary,
      categoryStats: context.issueCategoryStats ?? [],
    };
  }

  const appendix: Array<{ fileName: string; docType: string; version: string; date: string }> = [];
  if (agreement !== null) {
    appendix.push({ fileName: agreement.fileName, docType: "技术协议", version: "", date: agreement.extractedAt.slice(0, 10) });
  }
  if (context.equipment !== null && context.equipment !== undefined && context.equipment.sourceFileName !== null) {
    appendix.push({ fileName: context.equipment.sourceFileName, docType: "设备清单", version: "", date: "" });
  }
  if (appendix.length > 0) document.sourceAppendix = appendix;

  return document;
}
