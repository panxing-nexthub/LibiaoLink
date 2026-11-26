import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { memberNameOf, type Member } from "../data/members";
import type { ProjectTask } from "../data/tasks";
import { fetchProjectTasks } from "../taskApi";
import { MemberCompactMultiSelect } from "./MemberSelect";
import {
  createMaterialReissue,
  type MaterialReissueApplicationDepartment,
  type MaterialReissueApproval,
  type MaterialReissueDepartment,
  type MaterialReissueFreight,
  type MaterialReissueInput,
  type MaterialReissueLine,
  type MaterialReissueReason,
  type MaterialReissueResult,
} from "../fileApi";
import { fieldText, useLocale, useT } from "../i18n";
import { useMyPermissions } from "../permissions";
import { fetchProject, type ApiProject } from "../projectApi";
import {
  MATERIAL_REISSUE_APPLICATION_DEPARTMENT_OPTIONS,
  MATERIAL_REISSUE_APPROVAL_OPTIONS,
  MATERIAL_REISSUE_FREIGHT_OPTIONS,
  MATERIAL_REISSUE_REASON_OPTIONS,
  MATERIAL_REISSUE_RESPONSIBLE_DEPARTMENT_OPTIONS,
  materialReissueDefaultEmailTitle,
  materialReissueProjectAssistantIds,
} from "../materialReissue";

type MaterialDraft = MaterialReissueLine & { id: number };

const CELL_INPUT =
  "w-full bg-transparent px-2 py-1.5 text-sm leading-5 text-zinc-900 outline-none placeholder:text-zinc-300 focus:bg-amber-50/70";
const CELL_TEXTAREA =
  "w-full resize-y bg-transparent px-2 py-1.5 text-sm leading-5 text-zinc-900 outline-none placeholder:text-zinc-300 focus:bg-amber-50/70";
const TABLE_CELL = "border border-zinc-400 px-2 py-1.5 align-middle";
const LABEL_CELL = "w-[104px] border border-zinc-400 bg-zinc-50 px-2 py-1.5 text-left align-middle text-xs font-normal text-zinc-600 sm:w-[124px]";

function blankMaterial(id: number): MaterialDraft {
  return { id, materialCode: "", materialName: "", specification: "", quantity: 1, unit: "个", remark: "" };
}

function slashDate(value: string): string {
  return value.trim() === "" ? "" : value.replace(/-/g, "/");
}

/** 草稿版本：字段口径变化时 +1，旧版本草稿直接丢弃（不让半旧数据回填到新表单）。 */
const MATERIAL_REISSUE_DRAFT_VERSION = 1;
const MATERIAL_REISSUE_DRAFT_KEY_PREFIX = "libiaolink.material-reissue.draft.";
const MATERIAL_REISSUE_ASSISTANT_KEY_PREFIX = "libiaolink.material-reissue.assistants.";

const MATERIAL_REISSUE_REASON_VALUES = MATERIAL_REISSUE_REASON_OPTIONS.map((option) => option.value);
const MATERIAL_REISSUE_APPLICATION_DEPARTMENT_VALUES = MATERIAL_REISSUE_APPLICATION_DEPARTMENT_OPTIONS.map((option) => option.value);
const MATERIAL_REISSUE_APPROVAL_VALUES = MATERIAL_REISSUE_APPROVAL_OPTIONS.map((option) => option.value);
const MATERIAL_REISSUE_RESPONSIBLE_DEPARTMENT_VALUES = MATERIAL_REISSUE_RESPONSIBLE_DEPARTMENT_OPTIONS.map((option) => option.value);
const MATERIAL_REISSUE_FREIGHT_VALUES = MATERIAL_REISSUE_FREIGHT_OPTIONS.map((option) => option.value);

type MaterialReissueDraft = {
  version: number;
  emailTitleDraft: string | null;
  customerNameDraft: string | null;
  reason: MaterialReissueReason;
  reasonOther: string;
  applicationDepartment: MaterialReissueApplicationDepartment;
  applicationDepartmentOther: string;
  accepted: boolean;
  inWarranty: boolean;
  freeReissue: boolean;
  approved: MaterialReissueApproval;
  responsibleDepartment: MaterialReissueDepartment;
  responsibleDepartmentOther: string;
  requiredOutDate: string;
  oldPartReturn: boolean;
  freightBearer: MaterialReissueFreight;
  recipient: string;
  phone: string;
  address: string;
  description: string;
  materials: MaterialReissueLine[];
  savedAt: string;
};

function materialReissueDraftKey(userId: string, projectId: string, taskId: string): string {
  return MATERIAL_REISSUE_DRAFT_KEY_PREFIX + userId + ":" + projectId + ":" + taskId;
}

/** localStorage 只在本机：关闭抽屉 / 刷新 / 切换页面后仍可回填；读写失败不影响表单继续使用。 */
function storageRead(key: string): unknown {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
}

function storageWrite(key: string, value: unknown): boolean {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function storageRemove(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // 浏览器禁用存储时忽略：表单仍可填写与提交。
  }
}

function textValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function boolValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function readStoredDraft(key: string): MaterialReissueDraft | null {
  const raw = storageRead(key);
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const value = raw as Record<string, unknown>;
  if (value.version !== MATERIAL_REISSUE_DRAFT_VERSION) {
    return null;
  }
  const materials: MaterialReissueLine[] = Array.isArray(value.materials)
    ? value.materials.flatMap((item) => {
        if (typeof item !== "object" || item === null) {
          return [];
        }
        const row = item as Record<string, unknown>;
        return [
          {
            materialCode: textValue(row.materialCode),
            materialName: textValue(row.materialName),
            specification: textValue(row.specification),
            quantity: typeof row.quantity === "number" && Number.isFinite(row.quantity) ? row.quantity : 1,
            unit: textValue(row.unit, "个"),
            remark: textValue(row.remark),
          },
        ];
      })
    : [];
  if (materials.length === 0) {
    materials.push({ materialCode: "", materialName: "", specification: "", quantity: 1, unit: "个", remark: "" });
  }
  const requiredOutDate = textValue(value.requiredOutDate);
  return {
    version: MATERIAL_REISSUE_DRAFT_VERSION,
    emailTitleDraft: typeof value.emailTitleDraft === "string" ? value.emailTitleDraft : null,
    customerNameDraft: typeof value.customerNameDraft === "string" ? value.customerNameDraft : null,
    reason: oneOf(value.reason, MATERIAL_REISSUE_REASON_VALUES, "missing_list"),
    reasonOther: textValue(value.reasonOther),
    applicationDepartment: oneOf(value.applicationDepartment, MATERIAL_REISSUE_APPLICATION_DEPARTMENT_VALUES, "project"),
    applicationDepartmentOther: textValue(value.applicationDepartmentOther),
    accepted: boolValue(value.accepted, true),
    inWarranty: boolValue(value.inWarranty, true),
    freeReissue: boolValue(value.freeReissue, true),
    approved: oneOf(value.approved, MATERIAL_REISSUE_APPROVAL_VALUES, "yes"),
    responsibleDepartment: oneOf(value.responsibleDepartment, MATERIAL_REISSUE_RESPONSIBLE_DEPARTMENT_VALUES, "project"),
    responsibleDepartmentOther: textValue(value.responsibleDepartmentOther),
    requiredOutDate: /^\d{4}-\d{2}-\d{2}$/.test(requiredOutDate) ? requiredOutDate : "",
    oldPartReturn: boolValue(value.oldPartReturn, false),
    freightBearer: oneOf(value.freightBearer, MATERIAL_REISSUE_FREIGHT_VALUES, "libiao"),
    recipient: textValue(value.recipient),
    phone: textValue(value.phone),
    address: textValue(value.address),
    description: textValue(value.description),
    materials,
    savedAt: textValue(value.savedAt),
  };
}

/** 项目助理手动调整结果按项目记忆；null = 没有手动调整过，继续用任务自动识别结果。 */
function readStoredAssistantIds(key: string): string[] | null {
  const raw = storageRead(key);
  if (!Array.isArray(raw)) {
    return null;
  }
  return raw.filter((id): id is string => typeof id === "string" && id !== "");
}

function draftTimeText(iso: string | null): string {
  if (iso === null || iso === "") {
    return "";
  }
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? "" : at.toLocaleTimeString(undefined, { hour12: false });
}

function TemplateCheck({
  checked,
  label,
  name,
  value,
  onChange,
  ariaLabel,
}: {
  checked: boolean;
  label: string;
  name: string;
  value?: string;
  onChange: () => void;
  ariaLabel?: string;
}) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-1 whitespace-nowrap text-sm leading-6 text-zinc-800">
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
        aria-label={ariaLabel ?? label}
        className="sr-only"
      />
      <span aria-hidden="true" className={"text-[15px] leading-none " + (checked ? "text-zinc-900" : "text-zinc-400")}>
        {checked ? "☑" : "☐"}
      </span>
      <span>{label}</span>
    </label>
  );
}

function FormRow({
  label,
  children,
  required = false,
}: {
  label: string;
  children: ReactNode;
  required?: boolean;
}) {
  return (
    <tr>
      <th scope="row" className={LABEL_CELL}>
        {label}
        {required ? <span className="ml-0.5 text-rose-500">*</span> : null}
      </th>
      <td className={TABLE_CELL}>{children}</td>
    </tr>
  );
}

function ReadOnlyValue({ value }: { value: string }) {
  return <span className="block px-2 py-1.5 text-sm leading-5 text-zinc-800">{value === "" ? "—" : value}</span>;
}

function ChoiceGroup({
  name,
  value,
  options,
  onChange,
  ariaLabel,
}: {
  name: string;
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  onChange: (value: string) => void;
  ariaLabel: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="flex flex-wrap items-center gap-x-4 gap-y-0.5">
      {options.map((option) => (
        <TemplateCheck
          key={option.value}
          name={name}
          value={option.value}
          checked={value === option.value}
          label={option.label}
          onChange={() => { onChange(option.value); }}
        />
      ))}
    </div>
  );
}

/**
 * 物料补发表单（2026-11-26）：
 * - 所有输入按「用户 + 项目 + 任务」即时写入 localStorage 草稿；关闭抽屉、刷新或切换页面后自动回填，
 *   提交成功 / 二次确认清空时删除草稿。
 * - 页脚显示自动识别的项目助理：项目内「运输及送仓 / 清关 / 送仓 / 运输」任一任务的负责人，
 *   与服务端「项目助理可查看物料补发并登记发货」同一口径；可在本机手动增删多选，
 *   手动结果按项目记忆，仅影响表单草稿展示，不改变服务端权限或提交快照。
 */
export function MaterialReissueForm({ projectId, task, members, onSubmitted }: {
  projectId: string;
  task: ProjectTask;
  members: readonly Member[];
  onSubmitted: (result: MaterialReissueResult) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const projectErrorText = t("mr.err.project");
  const permissions = useMyPermissions();
  const [project, setProject] = useState<ApiProject | null>(null);
  const [projectError, setProjectError] = useState<string | null>(null);
  const [projectTick, setProjectTick] = useState(0);
  const [emailTitleDraft, setEmailTitleDraft] = useState<string | null>(null);
  const [customerNameDraft, setCustomerNameDraft] = useState<string | null>(null);
  const [reason, setReason] = useState<MaterialReissueReason>("missing_list");
  const [reasonOther, setReasonOther] = useState("");
  const [applicationDepartment, setApplicationDepartment] = useState<MaterialReissueApplicationDepartment>("project");
  const [applicationDepartmentOther, setApplicationDepartmentOther] = useState("");
  const [accepted, setAccepted] = useState(true);
  const [inWarranty, setInWarranty] = useState(true);
  const [freeReissue, setFreeReissue] = useState(true);
  const [approved, setApproved] = useState<MaterialReissueApproval>("yes");
  const [responsibleDepartment, setResponsibleDepartment] = useState<MaterialReissueDepartment>("project");
  const [responsibleDepartmentOther, setResponsibleDepartmentOther] = useState("");
  const [requiredOutDate, setRequiredOutDate] = useState("");
  const [oldPartReturn, setOldPartReturn] = useState(false);
  const [freightBearer, setFreightBearer] = useState<MaterialReissueFreight>("libiao");
  const [recipient, setRecipient] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [description, setDescription] = useState("");
  const nextMaterialId = useRef(2);
  const [materials, setMaterials] = useState<MaterialDraft[]>(() => [blankMaterial(1)]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detectedAssistantIds, setDetectedAssistantIds] = useState<string[] | null>(null);
  const [assistantIds, setAssistantIds] = useState<string[]>([]);
  const [assistantCustomized, setAssistantCustomized] = useState(false);
  const [draftStatus, setDraftStatus] = useState<"idle" | "restored" | "saved" | "cleared" | "failed">("idle");
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null);
  const [clearArmed, setClearArmed] = useState(false);
  const draftKey =
    permissions === null || projectId === ""
      ? null
      : materialReissueDraftKey(permissions.userId, projectId, task.id);
  const assistantKey =
    permissions === null || projectId === ""
      ? null
      : MATERIAL_REISSUE_ASSISTANT_KEY_PREFIX + permissions.userId + ":" + projectId;
  const hydratedDraftKeyRef = useRef<string | null>(null);
  /**
   * 只有用户真正改过字段才写草稿：打开表单、回填草稿、切换任务本身都不写，
   * 避免一进页面就生成一份默认值草稿，也避免换任务时把上一任务的旧状态写进新任务。
   */
  const userTouchedRef = useRef(false);
  const submittedRef = useRef(false);
  const lastDraftStatusAtRef = useRef(0);

  const resetFormState = useCallback(() => {
    setEmailTitleDraft(null);
    setCustomerNameDraft(null);
    setReason("missing_list");
    setReasonOther("");
    setApplicationDepartment("project");
    setApplicationDepartmentOther("");
    setAccepted(true);
    setInWarranty(true);
    setFreeReissue(true);
    setApproved("yes");
    setResponsibleDepartment("project");
    setResponsibleDepartmentOther("");
    setRequiredOutDate("");
    setOldPartReturn(false);
    setFreightBearer("libiao");
    setRecipient("");
    setPhone("");
    setAddress("");
    setDescription("");
    const id = nextMaterialId.current;
    nextMaterialId.current += 1;
    setMaterials([blankMaterial(id)]);
    setError(null);
  }, []);

  const applyDraft = useCallback((draft: MaterialReissueDraft) => {
    setEmailTitleDraft(draft.emailTitleDraft);
    setCustomerNameDraft(draft.customerNameDraft);
    setReason(draft.reason);
    setReasonOther(draft.reasonOther);
    setApplicationDepartment(draft.applicationDepartment);
    setApplicationDepartmentOther(draft.applicationDepartmentOther);
    setAccepted(draft.accepted);
    setInWarranty(draft.inWarranty);
    setFreeReissue(draft.freeReissue);
    setApproved(draft.approved);
    setResponsibleDepartment(draft.responsibleDepartment);
    setResponsibleDepartmentOther(draft.responsibleDepartmentOther);
    setRequiredOutDate(draft.requiredOutDate);
    setOldPartReturn(draft.oldPartReturn);
    setFreightBearer(draft.freightBearer);
    setRecipient(draft.recipient);
    setPhone(draft.phone);
    setAddress(draft.address);
    setDescription(draft.description);
    nextMaterialId.current = draft.materials.length + 1;
    setMaterials(draft.materials.map((line, index) => ({ ...line, id: index + 1 })));
    setError(null);
  }, []);

  /** 每次进入某任务：先复位，再回填本机草稿；只有用户真正改过字段才会写草稿。 */
  useEffect(() => {
    if (draftKey === null) {
      hydratedDraftKeyRef.current = null;
      return;
    }
    if (hydratedDraftKeyRef.current === draftKey) {
      return;
    }
    const previousKey = hydratedDraftKeyRef.current;
    hydratedDraftKeyRef.current = draftKey;
    submittedRef.current = false;
    if (previousKey === null && userTouchedRef.current) {
      // 权限 / 草稿键就绪前用户已开始填写：保留输入，交给保存 effect 直接写入新键。
      return;
    }
    userTouchedRef.current = false;
    resetFormState();
    const draft = readStoredDraft(draftKey);
    if (draft === null) {
      setDraftStatus("idle");
      setDraftSavedAt(null);
    } else {
      applyDraft(draft);
      setDraftSavedAt(draft.savedAt);
      setDraftStatus("restored");
    }
    lastDraftStatusAtRef.current = 0;
  }, [draftKey, resetFormState, applyDraft]);

  /** 项目助理手动调整结果按项目记忆；没有手动调整时继续用自动识别。 */
  useEffect(() => {
    if (assistantKey === null) {
      setAssistantIds([]);
      setAssistantCustomized(false);
      return;
    }
    const stored = readStoredAssistantIds(assistantKey);
    setAssistantIds(stored ?? []);
    setAssistantCustomized(stored !== null);
  }, [assistantKey]);

  useEffect(() => {
    if (projectId === "") {
      setDetectedAssistantIds([]);
      return;
    }
    let alive = true;
    setDetectedAssistantIds(null);
    void fetchProjectTasks(projectId)
      .then((result) => {
        if (alive) {
          setDetectedAssistantIds(materialReissueProjectAssistantIds(result.items));
        }
      })
      .catch(() => {
        if (alive) {
          setDetectedAssistantIds([]);
        }
      });
    return () => {
      alive = false;
    };
  }, [projectId]);

  useEffect(() => {
    if (assistantCustomized || detectedAssistantIds === null) {
      return;
    }
    setAssistantIds(detectedAssistantIds);
  }, [assistantCustomized, detectedAssistantIds]);

  /** 填写即保存：字段一变就整体写回本机草稿（不做延迟，刷新 / 关闭也不丢最后一笔）。 */
  useEffect(() => {
    if (draftKey === null || submittedRef.current || !userTouchedRef.current) {
      return;
    }
    const draft: MaterialReissueDraft = {
      version: MATERIAL_REISSUE_DRAFT_VERSION,
      emailTitleDraft,
      customerNameDraft,
      reason,
      reasonOther,
      applicationDepartment,
      applicationDepartmentOther,
      accepted,
      inWarranty,
      freeReissue,
      approved,
      responsibleDepartment,
      responsibleDepartmentOther,
      requiredOutDate,
      oldPartReturn,
      freightBearer,
      recipient,
      phone,
      address,
      description,
      materials: materials.map((row) => ({
        materialCode: row.materialCode,
        materialName: row.materialName,
        specification: row.specification,
        quantity: row.quantity,
        unit: row.unit,
        remark: row.remark,
      })),
      savedAt: new Date().toISOString(),
    };
    if (!storageWrite(draftKey, draft)) {
      setDraftStatus("failed");
      return;
    }
    const now = Date.now();
    if (now - lastDraftStatusAtRef.current >= 1000) {
      lastDraftStatusAtRef.current = now;
      setDraftSavedAt(draft.savedAt);
      setDraftStatus("saved");
    }
  }, [
    draftKey,
    emailTitleDraft,
    customerNameDraft,
    reason,
    reasonOther,
    applicationDepartment,
    applicationDepartmentOther,
    accepted,
    inWarranty,
    freeReissue,
    approved,
    responsibleDepartment,
    responsibleDepartmentOther,
    requiredOutDate,
    oldPartReturn,
    freightBearer,
    recipient,
    phone,
    address,
    description,
    materials,
  ]);

  useEffect(() => {
    if (!clearArmed) {
      return;
    }
    const timer = window.setTimeout(() => {
      setClearArmed(false);
    }, 4000);
    return () => {
      window.clearTimeout(timer);
    };
  }, [clearArmed]);

  const markTouched = () => {
    userTouchedRef.current = true;
  };

  const updateAssistants = (ids: string[]) => {
    setAssistantIds(ids);
    setAssistantCustomized(true);
    if (assistantKey !== null) {
      storageWrite(assistantKey, ids);
    }
  };

  /** 清空 = 二次确认；同时删除本任务草稿并把项目助理恢复为自动识别。 */
  const clearForm = () => {
    if (busy) {
      return;
    }
    if (!clearArmed) {
      setClearArmed(true);
      return;
    }
    setClearArmed(false);
    submittedRef.current = false;
    userTouchedRef.current = false;
    resetFormState();
    if (draftKey !== null) {
      storageRemove(draftKey);
    }
    if (assistantKey !== null) {
      storageRemove(assistantKey);
    }
    setAssistantCustomized(false);
    setAssistantIds(detectedAssistantIds ?? []);
    setDraftSavedAt(null);
    setDraftStatus("cleared");
    lastDraftStatusAtRef.current = 0;
  };

  useEffect(() => {
    let cancelled = false;
    setProject(null);
    setProjectError(null);
    void fetchProject(projectId)
      .then((loaded) => {
        if (!cancelled) setProject(loaded);
      })
      .catch(() => {
        if (!cancelled) setProjectError(projectErrorText);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, projectTick, projectErrorText]);

  useEffect(() => {
    setEmailTitleDraft(null);
    setCustomerNameDraft(null);
  }, [projectId, task.id]);

  const defaultEmailTitle = project === null ? "…" : materialReissueDefaultEmailTitle(project.code, project.name);
  const emailTitle = emailTitleDraft ?? defaultEmailTitle;
  const customerName = customerNameDraft ?? project?.customer ?? "";

  const applicantName =
    permissions === null
      ? t("common.loading")
      : memberNameOf(members, permissions.userId) ?? permissions.userId;

  const updateMaterial = (id: number, patch: Partial<MaterialReissueLine>) => {
    setMaterials((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
    setError(null);
  };

  const removeMaterial = (id: number) => {
    userTouchedRef.current = true;
    setMaterials((current) => (current.length <= 1 ? current : current.filter((row) => row.id !== id)));
  };

  const addMaterial = () => {
    userTouchedRef.current = true;
    const id = nextMaterialId.current;
    nextMaterialId.current += 1;
    setMaterials((current) => [...current, blankMaterial(id)]);
  };

  const submit = async () => {
    if (busy) return;
    if (emailTitle.trim() === "") {
      setError(t("mr.err.emailTitle"));
      return;
    }
    if (reason === "other" && reasonOther.trim() === "") {
      setError(t("mr.err.reasonOther"));
      return;
    }
    if (applicationDepartment === "other" && applicationDepartmentOther.trim() === "") {
      setError(t("mr.err.applicationDepartmentOther"));
      return;
    }
    if (responsibleDepartment === "other" && responsibleDepartmentOther.trim() === "") {
      setError(t("mr.err.responsibleDepartmentOther"));
      return;
    }
    if (requiredOutDate === "") {
      setError(t("mr.err.outDate"));
      return;
    }
    if (recipient.trim() === "") {
      setError(t("mr.err.recipient"));
      return;
    }
    if (phone.trim() === "") {
      setError(t("mr.err.phone"));
      return;
    }
    if (address.trim() === "") {
      setError(t("mr.err.address"));
      return;
    }
    if (description.trim() === "") {
      setError(t("mr.err.description"));
      return;
    }
    const badName = materials.findIndex((row) => row.materialName.trim() === "");
    if (badName >= 0) {
      setError(t("mr.err.materialName", { n: String(badName + 1) }));
      return;
    }
    const badQuantity = materials.findIndex((row) => !Number.isFinite(row.quantity) || row.quantity <= 0);
    if (badQuantity >= 0) {
      setError(t("mr.err.materialQuantity", { n: String(badQuantity + 1) }));
      return;
    }
    const badUnit = materials.findIndex((row) => row.unit.trim() === "");
    if (badUnit >= 0) {
      setError(t("mr.err.materialUnit", { n: String(badUnit + 1) }));
      return;
    }
    const input: MaterialReissueInput = {
      emailTitle: emailTitle.trim(),
      customerName: customerName.trim(),
      reason,
      reasonOther: reason === "other" ? reasonOther.trim() : undefined,
      applicationDepartment,
      applicationDepartmentOther:
        applicationDepartment === "other" ? applicationDepartmentOther.trim() : undefined,
      accepted,
      inWarranty,
      freeReissue,
      approved,
      responsibleDepartment,
      responsibleDepartmentOther:
        responsibleDepartment === "other" ? responsibleDepartmentOther.trim() : undefined,
      requiredOutDate,
      oldPartReturn,
      freightBearer,
      recipient: recipient.trim(),
      phone: phone.trim(),
      address: address.trim(),
      description: description.trim(),
      materials: materials.map((row) => ({
        materialCode: row.materialCode.trim(),
        materialName: row.materialName.trim(),
        specification: row.specification.trim(),
        quantity: row.quantity,
        unit: row.unit.trim(),
        remark: row.remark.trim(),
      })),
    };
    setBusy(true);
    setError(null);
    try {
      const result = await createMaterialReissue(projectId, task.id, input);
      submittedRef.current = true;
      if (draftKey !== null) {
        storageRemove(draftKey);
      }
      onSubmitted(result);
    } catch (caught) {
      setError(caught instanceof Error && caught.message !== "" ? caught.message : t("mr.err.submit"));
    } finally {
      setBusy(false);
    }
  };

  const yesNoOptions = [
    { value: "true", label: fieldText(locale, "是") },
    { value: "false", label: fieldText(locale, "否") },
  ];
  const approvalOptions = MATERIAL_REISSUE_APPROVAL_OPTIONS.map((option) => ({
    value: option.value,
    label: fieldText(locale, option.label),
  }));
  const freightOptions = MATERIAL_REISSUE_FREIGHT_OPTIONS.map((option) => ({
    value: option.value,
    label: fieldText(locale, option.label),
  }));
  /**
   * 是否有用户填写内容：用于「清空当前所填」禁用态。
   * 自动带入的邮件标题 / 客户名称 / 申请人 / 默认勾选不算；项目助理选择不在表单草稿内，也不触发启用。
   */
  const hasFilledContent =
    emailTitleDraft !== null ||
    customerNameDraft !== null ||
    reason !== "missing_list" ||
    reasonOther.trim() !== "" ||
    applicationDepartment !== "project" ||
    applicationDepartmentOther.trim() !== "" ||
    !accepted ||
    !inWarranty ||
    !freeReissue ||
    approved !== "yes" ||
    responsibleDepartment !== "project" ||
    responsibleDepartmentOther.trim() !== "" ||
    requiredOutDate !== "" ||
    oldPartReturn ||
    freightBearer !== "libiao" ||
    recipient.trim() !== "" ||
    phone.trim() !== "" ||
    address.trim() !== "" ||
    description.trim() !== "" ||
    materials.length > 1 ||
    materials.some(
      (row) =>
        row.materialCode.trim() !== "" ||
        row.materialName.trim() !== "" ||
        row.specification.trim() !== "" ||
        row.quantity !== 1 ||
        row.unit.trim() !== "个" ||
        row.remark.trim() !== "",
    );
  const draftTime = draftTimeText(draftSavedAt);
  const draftStatusText =
    draftStatus === "failed"
      ? t("mr.draft.failed")
      : draftStatus === "restored"
        ? t("mr.draft.restored")
        : draftStatus === "saved"
          ? t("mr.draft.saved", { time: draftTime })
          : draftStatus === "cleared"
            ? t("mr.draft.cleared")
            : "";

  return (
    <div
      data-material-reissue-form="true"
      className="flex flex-col gap-4 py-4"
      onChange={markTouched}
      onInput={markTouched}
    >
      <section className="rounded-xl border border-zinc-200 bg-white p-3 sm:p-5">
        <div className="flex items-center justify-between gap-3 border-b border-zinc-300 pb-2">
          <img src="/libiao-logo.svg" alt="Libiao Robotics" className="h-7 w-auto max-w-[150px]" />
          <span className="text-right text-[11px] leading-4 text-zinc-500">{t("mr.form.company")}</span>
        </div>

        <h3 className="mt-4 text-center text-lg font-bold tracking-wide text-zinc-900">{t("mr.title")}</h3>
        <div className="mt-3 flex min-w-0 items-center gap-1 text-[13px] font-bold leading-6 text-zinc-900">
          <span className="shrink-0">{t("mr.form.emailLabel")}</span>
          <input
            data-material-reissue-email-title="true"
            value={emailTitle}
            maxLength={500}
            onChange={(event) => { setEmailTitleDraft(event.target.value); setError(null); }}
            aria-label={t("mr.form.emailLabel")}
            className="min-w-0 flex-1 bg-transparent px-1 py-0.5 font-bold text-zinc-900 outline-none focus:bg-amber-50/70"
          />
        </div>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-2 text-[10px] leading-4 text-zinc-400">
          <span className="min-w-0 flex-1">{t("mr.autoHint")}</span>
          <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-700">{t("mr.autoBadge")}</span>
        </div>

        {projectError === null ? null : (
          <div className="mt-3 flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <span className="min-w-0 flex-1">{projectError}</span>
            <button type="button" onClick={() => { setProjectTick((tick) => tick + 1); }} className="shrink-0 font-medium underline">
              {t("common.retry")}
            </button>
          </div>
        )}

        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[560px] table-fixed border-collapse text-sm">
            <colgroup>
              <col className="w-[104px] sm:w-[124px]" />
              <col />
            </colgroup>
            <thead>
              <tr>
                <th scope="col" className="border border-zinc-400 bg-zinc-100 px-2 py-1.5 text-center text-xs font-bold text-zinc-800">{fieldText(locale, "项目")}</th>
                <th scope="col" className="border border-zinc-400 bg-zinc-100 px-2 py-1.5 text-center text-xs font-bold text-zinc-800">{t("mr.form.valueHeader")}</th>
              </tr>
            </thead>
            <tbody>
              <FormRow label={fieldText(locale, "项目编号")}>
                <ReadOnlyValue value={project?.code ?? "…"} />
              </FormRow>
              <FormRow label={fieldText(locale, "项目名称")}>
                <ReadOnlyValue value={project?.name ?? "…"} />
              </FormRow>
              <FormRow label={fieldText(locale, "客户名称")}>
                <input
                  data-material-reissue-customer-name="true"
                  value={customerName}
                  maxLength={200}
                  onChange={(event) => { setCustomerNameDraft(event.target.value); setError(null); }}
                  aria-label={fieldText(locale, "客户名称")}
                  placeholder="—"
                  className={CELL_INPUT}
                />
              </FormRow>
              <FormRow label={fieldText(locale, "申请部门")} required>
                <div role="radiogroup" aria-label={t("mr.applicationDepartment.aria")} className="flex flex-wrap items-center gap-x-4 gap-y-0.5">
                  {MATERIAL_REISSUE_APPLICATION_DEPARTMENT_OPTIONS.map((option) => (
                    <TemplateCheck
                      key={option.value}
                      name="material-reissue-application-department"
                      value={option.value}
                      checked={applicationDepartment === option.value}
                      label={fieldText(locale, option.label) + (option.value === "other" ? "：" : "")}
                      onChange={() => { setApplicationDepartment(option.value); setError(null); }}
                    />
                  ))}
                  {applicationDepartment === "other" ? (
                    <input
                      value={applicationDepartmentOther}
                      maxLength={100}
                      onChange={(event) => { setApplicationDepartmentOther(event.target.value); setError(null); }}
                      placeholder={t("mr.form.otherPlaceholder")}
                      aria-label={t("mr.applicationDepartmentOther")}
                      className="h-7 w-36 border-b border-zinc-400 bg-transparent px-1 text-sm outline-none placeholder:text-zinc-300 focus:border-zinc-900"
                    />
                  ) : (
                    <span className="text-sm text-zinc-300">______</span>
                  )}
                </div>
              </FormRow>
              <FormRow label={fieldText(locale, "申请人")}>
                <ReadOnlyValue value={applicantName} />
              </FormRow>
              <FormRow label={fieldText(locale, "补发类别")} required>
                <div role="radiogroup" aria-label={t("mr.reason.aria")} className="flex flex-wrap items-center gap-x-4 gap-y-0.5">
                  {MATERIAL_REISSUE_REASON_OPTIONS.map((option) => (
                    <TemplateCheck
                      key={option.value}
                      name="material-reissue-reason"
                      value={option.value}
                      checked={reason === option.value}
                      label={fieldText(locale, option.label) + (option.value === "other" ? "：" : "")}
                      onChange={() => { setReason(option.value); setError(null); }}
                    />
                  ))}
                  {reason === "other" ? (
                    <input
                      value={reasonOther}
                      maxLength={100}
                      onChange={(event) => { setReasonOther(event.target.value); setError(null); }}
                      placeholder={t("mr.form.otherPlaceholder")}
                      aria-label={t("mr.reasonOther")}
                      className="h-7 w-40 border-b border-zinc-400 bg-transparent px-1 text-sm outline-none placeholder:text-zinc-300 focus:border-zinc-900"
                    />
                  ) : (
                    <span className="text-sm text-zinc-300">______</span>
                  )}
                </div>
              </FormRow>
              <FormRow label={fieldText(locale, "是否已验收")} required>
                <ChoiceGroup
                  name="material-reissue-accepted"
                  value={accepted ? "true" : "false"}
                  options={yesNoOptions}
                  onChange={(value) => { setAccepted(value === "true"); setError(null); }}
                  ariaLabel={t("mr.accepted.aria")}
                />
              </FormRow>
              <FormRow label={fieldText(locale, "是否质保期内")} required>
                <ChoiceGroup
                  name="material-reissue-in-warranty"
                  value={inWarranty ? "true" : "false"}
                  options={yesNoOptions}
                  onChange={(value) => { setInWarranty(value === "true"); setError(null); }}
                  ariaLabel={t("mr.inWarranty.aria")}
                />
              </FormRow>
              <FormRow label={fieldText(locale, "是否免费补发")} required>
                <ChoiceGroup
                  name="material-reissue-free"
                  value={freeReissue ? "true" : "false"}
                  options={yesNoOptions}
                  onChange={(value) => { setFreeReissue(value === "true"); setError(null); }}
                  ariaLabel={t("mr.freeReissue.aria")}
                />
              </FormRow>
              <FormRow label={fieldText(locale, "是否已审批")} required>
                <ChoiceGroup
                  name="material-reissue-approved"
                  value={approved}
                  options={approvalOptions}
                  onChange={(value) => { setApproved(value as MaterialReissueApproval); setError(null); }}
                  ariaLabel={t("mr.approved.aria")}
                />
              </FormRow>
              <FormRow label={fieldText(locale, "责任归属部门")} required>
                <div role="radiogroup" aria-label={t("mr.responsibleDepartment.aria")} className="flex flex-wrap items-center gap-x-4 gap-y-0.5">
                  {MATERIAL_REISSUE_RESPONSIBLE_DEPARTMENT_OPTIONS.map((option) => (
                    <TemplateCheck
                      key={option.value}
                      name="material-reissue-responsible-department"
                      value={option.value}
                      checked={responsibleDepartment === option.value}
                      label={fieldText(locale, option.label) + (option.value === "other" ? "：" : "")}
                      onChange={() => { setResponsibleDepartment(option.value); setError(null); }}
                    />
                  ))}
                  {responsibleDepartment === "other" ? (
                    <input
                      value={responsibleDepartmentOther}
                      maxLength={100}
                      onChange={(event) => { setResponsibleDepartmentOther(event.target.value); setError(null); }}
                      placeholder={t("mr.form.otherPlaceholder")}
                      aria-label={t("mr.responsibleDepartmentOther")}
                      className="h-7 w-36 border-b border-zinc-400 bg-transparent px-1 text-sm outline-none placeholder:text-zinc-300 focus:border-zinc-900"
                    />
                  ) : (
                    <span className="text-sm text-zinc-300">______</span>
                  )}
                </div>
              </FormRow>
              <FormRow label={fieldText(locale, "要求出库时间")} required>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="date"
                    value={requiredOutDate}
                    onChange={(event) => { setRequiredOutDate(event.target.value); setError(null); }}
                    aria-label={fieldText(locale, "要求出库时间")}
                    className="rounded border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-900 outline-none focus:border-zinc-500"
                  />
                  <span className="text-xs tabular-nums text-zinc-500">{requiredOutDate === "" ? "YYYY/MM/DD" : slashDate(requiredOutDate)}</span>
                </div>
              </FormRow>
              <FormRow label={fieldText(locale, "是否涉及旧件返还")} required>
                <ChoiceGroup
                  name="material-reissue-old-part"
                  value={oldPartReturn ? "true" : "false"}
                  options={yesNoOptions}
                  onChange={(value) => { setOldPartReturn(value === "true"); setError(null); }}
                  ariaLabel={t("mr.oldPartReturn.aria")}
                />
              </FormRow>
              <FormRow label={fieldText(locale, "运费承担")} required>
                <ChoiceGroup
                  name="material-reissue-freight"
                  value={freightBearer}
                  options={freightOptions}
                  onChange={(value) => { setFreightBearer(value as MaterialReissueFreight); setError(null); }}
                  ariaLabel={t("mr.freight.aria")}
                />
              </FormRow>
              <FormRow label={fieldText(locale, "收货人")} required>
                <input
                  value={recipient}
                  maxLength={80}
                  onChange={(event) => { setRecipient(event.target.value); setError(null); }}
                  placeholder={t("mr.recipient.placeholder")}
                  className={CELL_INPUT}
                />
              </FormRow>
              <FormRow label={fieldText(locale, "联系电话")} required>
                <input
                  type="tel"
                  value={phone}
                  maxLength={40}
                  onChange={(event) => { setPhone(event.target.value); setError(null); }}
                  placeholder={t("mr.phone.placeholder")}
                  className={CELL_INPUT}
                />
              </FormRow>
              <FormRow label={fieldText(locale, "收货地址")} required>
                <textarea
                  value={address}
                  maxLength={500}
                  rows={2}
                  onChange={(event) => { setAddress(event.target.value); setError(null); }}
                  placeholder={t("mr.address.placeholder")}
                  className={CELL_TEXTAREA}
                />
              </FormRow>
              <FormRow label={fieldText(locale, "补发原因简述")} required>
                <textarea
                  value={description}
                  maxLength={2000}
                  rows={3}
                  onChange={(event) => { setDescription(event.target.value); setError(null); }}
                  placeholder={t("mr.description.placeholder")}
                  className={CELL_TEXTAREA}
                />
              </FormRow>
            </tbody>
          </table>
        </div>

        <h4 className="mt-5 text-sm font-bold text-zinc-900">{fieldText(locale, "补发物料清单")}</h4>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[720px] table-fixed border-collapse text-xs">
            <colgroup>
              <col className="w-[48px]" />
              <col className="w-[128px]" />
              <col className="w-[148px]" />
              <col className="w-[148px]" />
              <col className="w-[72px]" />
              <col className="w-[64px]" />
              <col className="w-[112px]" />
            </colgroup>
            <thead>
              <tr>
                <th scope="col" className="border border-zinc-400 bg-zinc-100 px-1 py-1.5 text-center font-bold">{fieldText(locale, "序号")}</th>
                <th scope="col" className="border border-zinc-400 bg-zinc-100 px-1 py-1.5 text-center font-bold">{fieldText(locale, "物料编码")}</th>
                <th scope="col" className="border border-zinc-400 bg-zinc-100 px-1 py-1.5 text-center font-bold">{fieldText(locale, "物料名称")}</th>
                <th scope="col" className="border border-zinc-400 bg-zinc-100 px-1 py-1.5 text-center font-bold">{fieldText(locale, "规格型号")}</th>
                <th scope="col" className="border border-zinc-400 bg-zinc-100 px-1 py-1.5 text-center font-bold">{fieldText(locale, "数量")}</th>
                <th scope="col" className="border border-zinc-400 bg-zinc-100 px-1 py-1.5 text-center font-bold">{fieldText(locale, "单位")}</th>
                <th scope="col" className="border border-zinc-400 bg-zinc-100 px-1 py-1.5 text-center font-bold">{fieldText(locale, "备注")}</th>
              </tr>
            </thead>
            <tbody>
              {materials.map((row, index) => (
                <tr key={row.id} data-material-reissue-row={String(index + 1)}>
                  <td className="border border-zinc-400 px-1 py-1 text-center align-middle">
                    <span className="mr-1 tabular-nums text-zinc-600">{String(index + 1)}</span>
                    {materials.length <= 1 ? null : (
                      <button
                        type="button"
                        onClick={() => { removeMaterial(row.id); }}
                        aria-label={t("mr.form.removeMaterial")}
                        title={t("mr.form.removeMaterial")}
                        className="text-[10px] leading-none text-zinc-300 transition hover:text-rose-600"
                      >
                        ✕
                      </button>
                    )}
                  </td>
                  <td className="border border-zinc-400 px-1 py-1 align-middle">
                    <input value={row.materialCode} maxLength={80} onChange={(event) => { updateMaterial(row.id, { materialCode: event.target.value }); }} placeholder={t("mr.materialCode.placeholder")} aria-label={fieldText(locale, "物料编码")} className={CELL_INPUT + " text-xs"} />
                  </td>
                  <td className="border border-zinc-400 px-1 py-1 align-middle">
                    <input value={row.materialName} maxLength={200} onChange={(event) => { updateMaterial(row.id, { materialName: event.target.value }); }} placeholder={t("mr.materialName.placeholder")} aria-label={fieldText(locale, "物料名称")} className={CELL_INPUT + " text-xs"} />
                  </td>
                  <td className="border border-zinc-400 px-1 py-1 align-middle">
                    <input value={row.specification} maxLength={200} onChange={(event) => { updateMaterial(row.id, { specification: event.target.value }); }} placeholder={t("mr.specification.placeholder")} aria-label={fieldText(locale, "规格型号")} className={CELL_INPUT + " text-xs"} />
                  </td>
                  <td className="border border-zinc-400 px-1 py-1 align-middle">
                    <input type="number" min="0" step="any" value={row.quantity} onChange={(event) => { updateMaterial(row.id, { quantity: Number(event.target.value) }); }} aria-label={fieldText(locale, "数量")} className={CELL_INPUT + " text-center text-xs"} />
                  </td>
                  <td className="border border-zinc-400 px-1 py-1 align-middle">
                    <input value={row.unit} maxLength={20} onChange={(event) => { updateMaterial(row.id, { unit: event.target.value }); }} placeholder={t("mr.unit.placeholder")} aria-label={fieldText(locale, "单位")} className={CELL_INPUT + " text-center text-xs"} />
                  </td>
                  <td className="border border-zinc-400 px-1 py-1 align-middle">
                    <input value={row.remark} maxLength={200} onChange={(event) => { updateMaterial(row.id, { remark: event.target.value }); }} placeholder={t("mr.remark.placeholder")} aria-label={fieldText(locale, "备注")} className={CELL_INPUT + " text-xs"} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button
          type="button"
          onClick={addMaterial}
          className="mt-2 rounded-md border border-dashed border-zinc-300 px-2.5 py-1 text-[11px] font-medium text-zinc-600 transition hover:border-zinc-400 hover:text-zinc-900"
        >
          {t("mr.materials.add")}
        </button>

        <div className="mt-4 text-xs leading-6 text-zinc-700">
          <p className="font-bold text-zinc-900">{t("mr.form.notesTitle")}</p>
          <ol className="mt-1 list-decimal pl-6">
            <li>{t("mr.form.note1")}</li>
            <li>{t("mr.form.note2")}</li>
            <li>{t("mr.form.note3")}</li>
            <li>{t("mr.form.note4")}</li>
          </ol>
        </div>

        <div className="mt-4 flex flex-col gap-2 border-t border-zinc-200 pt-3">
          {error === null ? null : <p data-material-reissue-error="true" className="rounded-lg bg-red-50 px-3 py-2 text-xs leading-5 text-red-600">{error}</p>}
          <div className="flex flex-wrap items-stretch justify-end gap-2">
            <div data-material-reissue-assistants="true" className="shrink-0">
              <MemberCompactMultiSelect
                values={assistantIds}
                onChange={updateAssistants}
                options={members}
                inlineLabel={t("mr.assistant.label")}
                placeholder={t("mr.assistant.placeholder")}
                ariaLabel={t("mr.assistant.aria")}
              />
            </div>
            <button
              type="button"
              data-material-reissue-clear="true"
              onClick={clearForm}
              disabled={busy || !hasFilledContent}
              className={
                "inline-flex min-h-10 shrink-0 items-center justify-center rounded-lg border px-4 text-sm font-medium transition disabled:cursor-not-allowed " +
                (clearArmed && hasFilledContent
                  ? "border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100"
                  : "border-zinc-300 bg-white text-zinc-600 hover:border-zinc-400 hover:bg-zinc-50 hover:text-zinc-900 disabled:border-zinc-200 disabled:bg-zinc-50 disabled:text-zinc-300")
              }
            >
              {clearArmed && hasFilledContent ? t("mr.clear.confirm") : t("mr.clear")}
            </button>
            <button
              type="button"
              data-material-reissue-submit="true"
              onClick={() => { void submit(); }}
              disabled={busy || project === null}
              className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:bg-zinc-300"
            >
              {busy ? t("mr.submitting") : t("mr.submit")}
            </button>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[10px] leading-4 text-zinc-400">
            <p className="min-w-0">{t("mr.footnote")}</p>
            {draftStatusText === "" ? null : (
              <span
                data-material-reissue-draft-status="true"
                data-material-reissue-draft-mode={draftStatus}
                data-material-reissue-draft-saved-at={draftSavedAt ?? ""}
                className={
                  "shrink-0 " +
                  (draftStatus === "failed"
                    ? "text-rose-600"
                    : draftStatus === "restored"
                      ? "text-amber-600"
                      : "text-emerald-600")
                }
              >
                {draftStatusText}
              </span>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
