# Document Analysis Worker

LibiaoLink 项目文件 AI 读取 worker。独立容器运行，避免把 LibreOffice / PyMuPDF 装进 API 容器。

## 范围

只处理项目详情「项目文件」视图：

- 任务文件：files.task_id 非空
- 变更文件：文件版本关联 change_requests
- 状态：draft / final / changed / archived
- 类型：PDF、图片、Word、Excel
- 图片排除日报现场图和问题图
- 其它类型计入 skipped_count，不送模型

## 处理链路

1. 从 files / file_versions 查询当前版本。
2. 从对象存储下载原始文件。
3. PDF 用 PyMuPDF 拆页；Word / Excel 用 LibreOffice 转 PDF；图片规范化为 PNG。
4. 每页发送图片 + 页面文本给当前启用模型。
5. 只提炼摘要型事实，最多 8 条，不逐行抄录长表。
6. 按 file_version_id + prompt_version 缓存到 project_file_analyses。
7. run 汇总 succeeded / failed / skipped 数量。

## 环境变量

- DB_HOST / DB_PORT / DB_NAME（默认 postgres / 5432 / libiaolink）
- S3_ENDPOINT / S3_REGION / S3_BUCKET / S3_FORCE_PATH_STYLE
- DOCUMENT_ANALYSIS_MAX_PAGES（默认 20）
- DOCUMENT_ANALYSIS_MAX_FILE_MB（默认 200）
- DOCUMENT_ANALYSIS_MAX_TOKENS（默认 6000）
- LOG_LEVEL（默认 INFO）

Docker secrets（挂载到 /run/secrets）：

- pg_api_password
- s3_access_key
- s3_secret_key
- model_config_encryption_key

## 构建

```bash
docker build -t libiaolink/document-analysis-worker:local server/document-analysis-worker
```

## 运行

先对测试数据库执行迁移 `database/migrations/0113_project_document_analyses.sql`。

enqueue：

```bash
docker run --rm --network libiaolink-prod \
  -e DB_HOST=postgres -e DB_PORT=5432 -e DB_NAME=libiaolink \
  -e S3_ENDPOINT=https://test-pm.libiaorobot.com -e S3_REGION=us-east-1 \
  -e S3_BUCKET=libiaolink -e S3_FORCE_PATH_STYLE=auto \
  -v /opt/libiaolink/deploy/prod/secrets:/run/secrets:ro \
  libiaolink/document-analysis-worker:local enqueue --project LBGN23171-G1
```

一次处理一个队列 run：

```bash
docker run --rm --network libiaolink-prod ... libiaolink/document-analysis-worker:local poll --once
```

直接 enqueue 并立即处理：

```bash
docker run --rm --network libiaolink-prod ... libiaolink/document-analysis-worker:local run --project LBGN23171-G1
```

常驻轮询：

```bash
docker run -d --name libiaolink-document-analysis --restart unless-stopped --network libiaolink-prod ... libiaolink/document-analysis-worker:local poll --interval 30
```

## 数据表

- project_document_analysis_runs：project 级 run 状态、文件数、成功 / 失败 / 跳过数
- project_file_analyses：按当前文件版本缓存每文件摘要

## 安全边界

- 容器以 docworker（uid 10001）执行；entrypoint 读取 Secret 后降权
- 不挂载宿主业务目录
- 不支持 .docm / .xlsm 宏文件
- 单文件大小、单文档页数、模型超时和 LibreOffice 超时均有上限
- 失败只写 status=failed，不覆盖历史成功结果以外的其他项目数据

## API 与 AI 总结接入

- `POST /api/v1/projects/{id}/document-analysis` 只插入 queued run；
- worker 轮询 queued run，完成后写 `project_file_analyses`；
- `GET /api/v1/projects/{id}/document-analysis` 返回最近 run + 当前文件版本摘要；
- `GET /api/v1/projects/{id}/ai-context` 的 `fileAnalyses[]` 只消费当前文件版本的成功摘要；
- AI 项目总结 prompt 升为 v3，文件摘要只作补充证据，不覆盖结构化项目数据。
