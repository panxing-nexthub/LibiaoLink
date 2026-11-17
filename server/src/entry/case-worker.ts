import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { Logger } from "nestjs-pino";
import { loadCaseEnv } from "../modules/case-hub/case-env.js";
import { CaseWorkerModule } from "../modules/case-hub/case-worker.module.js";

const HEARTBEAT_MS = 60_000;

async function bootstrap(): Promise<void> {
  const env = loadCaseEnv();
  const app = await NestFactory.createApplicationContext(CaseWorkerModule.forRoot(env), {
    bufferLogs: true,
  });
  const logger = app.get(Logger);
  app.useLogger(logger);
  app.flushLogs();

  const heartbeat = setInterval(() => {
    logger.debug("case-worker 心跳：L0 运行骨架无案例任务");
  }, HEARTBEAT_MS);

  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    clearInterval(heartbeat);
    logger.log("case-worker 收到 " + signal + "，退出");
    await app.close();
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  logger.log("case-worker L0 运行骨架已启动：未注册案例任务");
}

await bootstrap();
