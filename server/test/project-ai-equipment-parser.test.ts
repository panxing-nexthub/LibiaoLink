import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { parseEquipmentWorkbook } from "../src/modules/project-ai/project-ai-equipment.parser.js";

async function workbookBytes(build: (sheet: ExcelJS.Worksheet) => void): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("清单");
  build(sheet);
  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer);
}

describe("设备清单解析（P2）", () => {
  it("按分类名称聚合、跳过合计行、按单位分别汇总", async () => {
    const bytes = await workbookBytes((sheet) => {
      sheet.addRow(["LBGN23171-G1 物料清单"]);
      sheet.addRow([]);
      sheet.addRow(["No", "分类名称", "*物料编码", "物料名称/项目内容", "型号", "品牌", "*数量", "单位", "备注"]);
      sheet.addRow([1, "单层桌子", "详见机械清单", "650×1300mm", "S12L650", "立镖", 1, "套", ""]);
      sheet.addRow([2, "L型单层桌子", "详见机械清单", "1300×1950mm", "", "立镖", 2, "套", ""]);
      sheet.addRow([3, "流利条格口滑槽", "详见机械清单", "1730×630×100mm", "", "立镖", 207, "个", ""]);
      sheet.addRow([null, "合计", "", "", "", "", 210, "", ""]);
    });

    const categories = await parseEquipmentWorkbook(bytes);

    expect(categories).toEqual([
      { name: "单层桌子", itemCount: 1, quantities: [{ value: 1, unit: "套" }], representativeItems: ["650×1300mm（S12L650）"] },
      { name: "L型单层桌子", itemCount: 1, quantities: [{ value: 2, unit: "套" }], representativeItems: ["1300×1950mm"] },
      { name: "流利条格口滑槽", itemCount: 1, quantities: [{ value: 207, unit: "个" }], representativeItems: ["1730×630×100mm"] },
    ]);
  });

  it("合并单元格分类名称向下填充，并合并同分类同单位数量", async () => {
    const bytes = await workbookBytes((sheet) => {
      sheet.addRow(["分类名称", "物料名称/项目内容", "数量", "单位"]);
      sheet.addRow(["桌子", "A", 2, "套"]);
      sheet.addRow(["", "B", 3, "套"]);
      sheet.addRow(["滑槽", "C", 10, "个"]);
    });

    const categories = await parseEquipmentWorkbook(bytes);

    expect(categories).toEqual([
      { name: "桌子", itemCount: 2, quantities: [{ value: 5, unit: "套" }], representativeItems: ["A", "B"] },
      { name: "滑槽", itemCount: 1, quantities: [{ value: 10, unit: "个" }], representativeItems: ["C"] },
    ]);
  });
  it("物料名称为空但分类与数量存在时仍计入分类", async () => {
    const bytes = await workbookBytes((sheet) => {
      sheet.addRow(["No", "分类名称", "物料名称/项目内容", "型号", "数量", "单位"]);
      sheet.addRow([1, "单层桌子", "650×1300mm", "S12L650", 1, "套"]);
      sheet.addRow([2, "L型单层桌子", "1300×1950mm", "", 2, "套"]);
      sheet.addRow([3, "流利条格口滑槽", "", "", 207, "个"]);
    });

    const categories = await parseEquipmentWorkbook(bytes);

    expect(categories).toEqual([
      { name: "单层桌子", itemCount: 1, quantities: [{ value: 1, unit: "套" }], representativeItems: ["650×1300mm（S12L650）"] },
      { name: "L型单层桌子", itemCount: 1, quantities: [{ value: 2, unit: "套" }], representativeItems: ["1300×1950mm"] },
      { name: "流利条格口滑槽", itemCount: 1, quantities: [{ value: 207, unit: "个" }], representativeItems: ["流利条格口滑槽"] },
    ]);
  });

});
