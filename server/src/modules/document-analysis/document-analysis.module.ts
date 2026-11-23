import { Module } from "@nestjs/common";
import { IdentityModule } from "../identity/index.js";
import { PermissionModule } from "../permission/index.js";
import { DocumentAnalysisController } from "./document-analysis.controller.js";
import { DocumentAnalysisRepository } from "./document-analysis.repository.js";
import { DocumentAnalysisService } from "./document-analysis.service.js";

@Module({
  imports: [IdentityModule, PermissionModule],
  controllers: [DocumentAnalysisController],
  providers: [DocumentAnalysisRepository, DocumentAnalysisService],
  exports: [DocumentAnalysisService],
})
export class DocumentAnalysisModule {}
