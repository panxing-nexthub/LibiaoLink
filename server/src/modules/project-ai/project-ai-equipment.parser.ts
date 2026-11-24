import ExcelJS from "exceljs";
import type { ProjectAiEquipmentCategory, ProjectAiEquipmentQuantity } from "@libiaolink/contracts";

const MAX_ROWS = 5000;
const MAX_HEADER_SCAN_ROWS = 60;

type RowAccumulator = {
  name: string;
  itemCount: number;
  quantities: Map<string, number>;
  items: string[];
};

type HeaderMap = {
  headerRow: number;
  no: number;
  category: number;
  name: number;
  model: number;
  quantity: number;
  unit: number;
};

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const richText = record["richText"];
    if (Array.isArray(richText)) {
      return richText.map((part) => {
        const item = part !== null && typeof part === "object" ? (part as Record<string, unknown>) : null;
        return cellText(item?.["text"]);
      }).join("").trim();
    }
    const text = record["text"];
    if (typeof text === "string") return text.trim();
    if (record["result"] !== undefined) return cellText(record["result"]);
  }
  return "";
}

function parseNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const match = cellText(value).replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  if (match === null) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function quantityOf(value: unknown, unitValue: unknown): { value: number | null; unit: string } {
  const text = cellText(value);
  const unit = cellText(unitValue) || text.replace(/[-\d.,\s]/g, "").trim();
  return { value: parseNumber(value), unit };
}

function findHeader(sheet: ExcelJS.Worksheet): HeaderMap | null {
  const limit = Math.min(sheet.rowCount, MAX_HEADER_SCAN_ROWS);
  for (let rowNo = 1; rowNo <= limit; rowNo += 1) {
    const row = sheet.getRow(rowNo);
    const cells: string[] = [];
    for (let col = 1; col <= row.cellCount; col += 1) cells[col] = cellText(row.getCell(col).value);
    const find = (test: (text: string) => boolean): number => {
      for (let col = 1; col < cells.length; col += 1) {
        const text = cells[col] ?? "";
        if (test(text)) return col;
      }
      return -1;
    };
    const category = find((text) => text.includes("分类名称"));
    const name = find((text) => text.includes("物料名称") || text.includes("项目内容"));
    const quantity = find((text) => text.includes("数量"));
    if (category < 0 || name < 0 || quantity < 0) continue;
    return {
      headerRow: rowNo,
      no: find((text) => text === "No" || text === "NO" || text === "序号"),
      category,
      name,
      model: find((text) => text.includes("型号")),
      quantity,
      unit: find((text) => text === "单位" || text.includes("单位")),
    };
  }
  return null;
}

function parseSheet(sheet: ExcelJS.Worksheet): ProjectAiEquipmentCategory[] {
  const header = findHeader(sheet);
  if (header === null) return [];
  const accumulators = new Map<string, RowAccumulator>();
  let lastCategory = "";
  const lastRow = Math.min(sheet.rowCount, header.headerRow + MAX_ROWS);
  for (let rowNo = header.headerRow + 1; rowNo <= lastRow; rowNo += 1) {
    const row = sheet.getRow(rowNo);
    const categoryText = cellText(row.getCell(header.category).value);
    const nameText = cellText(row.getCell(header.name).value);
    const noText = header.no > 0 ? cellText(row.getCell(header.no).value) : "";
    if (categoryText === "" && nameText === "") continue;
    if (/合计|小计|总计|说明|备注/.test(categoryText + nameText)) continue;
    if (noText !== "" && !/^\d+$/.test(noText)) continue;
    const category = categoryText !== "" ? categoryText : lastCategory;
    if (category === "") continue;
    lastCategory = category;
    const modelText = header.model > 0 ? cellText(row.getCell(header.model).value) : "";
    const quantity = quantityOf(
      row.getCell(header.quantity).value,
      header.unit > 0 ? row.getCell(header.unit).value : null,
    );
    const accumulator = accumulators.get(category) ?? {
      name: category,
      itemCount: 0,
      quantities: new Map<string, number>(),
      items: [],
    };
    accumulator.itemCount += 1;
    if (quantity.value !== null) {
      accumulator.quantities.set(quantity.unit, (accumulator.quantities.get(quantity.unit) ?? 0) + quantity.value);
    }
    const representativeText = nameText === "" ? category : nameText;
    if (accumulator.items.length < 3) {
      accumulator.items.push(modelText === "" ? representativeText : representativeText + "（" + modelText + "）");
    }
    accumulators.set(category, accumulator);
  }
  return Array.from(accumulators.values()).map((accumulator) => ({
    name: accumulator.name,
    itemCount: accumulator.itemCount,
    quantities: Array.from(accumulator.quantities.entries()).map(([unit, value]): ProjectAiEquipmentQuantity => ({ value, unit })),
    representativeItems: accumulator.items,
  }));
}

/** 解析设备清单工作簿：取表头合法且数据行最多的 sheet，按「分类名称」聚合。 */
export async function parseEquipmentWorkbook(bytes: Uint8Array): Promise<ProjectAiEquipmentCategory[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(bytes) as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  let best: ProjectAiEquipmentCategory[] = [];
  for (const sheet of workbook.worksheets) {
    const categories = parseSheet(sheet);
    const totalRows = categories.reduce((sum, category) => sum + category.itemCount, 0);
    const bestRows = best.reduce((sum, category) => sum + category.itemCount, 0);
    if (totalRows > bestRows) best = categories;
  }
  return best;
}
