import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { Logger } from "nestjs-pino";
import { loadCaseEnv } from "../modules/case-hub/case-env.js";
import { CaseHttpModule } from "../modules/case-hub/case-http.module.js";

async function bootstrap(): Promise<void> {
  const env = loadCaseEnv();
  const app = await NestFactory.create(CaseHttpModule.forRoot(env), { bufferLogs: true });
  const logger = app.get(Logger);
  app.useLogger(logger);
  app.flushLogs();
  app.enableShutdownHooks();
  await app.listen(env.CASE_API_PORT);
  logger.log("case-api L0 运行骨架已启动：" + env.CASE_API_PORT);
}

await bootstrap();
