import { Controller, Get, Res } from "@nestjs/common";
import type { Response } from "express";
import { CaseHealthService } from "./case-health.service.js";

/** Case Hub 基础设施端点（不在 /api/v1 业务契约内）。 */
@Controller()
export class CaseHealthController {
  constructor(private readonly health: CaseHealthService) {}

  @Get("healthz")
  liveness(): { status: "ok" } {
    return this.health.liveness();
  }

  @Get("readyz")
  async readiness(@Res() response: Response): Promise<void> {
    const report = this.health.readiness();
    response.status(report.ok ? 200 : 503).json(report);
  }
}
