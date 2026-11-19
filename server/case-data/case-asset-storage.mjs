import { createHash } from "node:crypto";
import { CompleteMultipartUploadCommand, CreateMultipartUploadCommand, GetBucketVersioningCommand, GetObjectCommand,
  HeadObjectCommand, ListObjectVersionsCommand, ListPartsCommand, PutObjectCommand, S3Client, UploadPartCommand } from "@aws-sdk/client-s3";
import { caseSingleUploadMaxBytes, caseUploadMaxParts } from "@libiaolink/contracts/case-data/assets";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { CaseDataError, readCredential } from "./database-credentials.mjs";
import { createStorageCircuit } from "./gateway-controls.mjs";

export class CaseAssetError extends Error {
  constructor(status, code, message) {
    super(message);
    Object.assign(this, { status, code });
  }
}

const unavailable = () => new CaseAssetError(503, "ASSET_STORAGE_UNAVAILABLE", "案例对象存储暂不可用");
const mismatch = () => new CaseAssetError(422, "ASSET_OBJECT_MISMATCH", "实际对象版本、大小、类型或 SHA-256 与上传会话不一致");
const putLifetimeSeconds = 120;
const maxDownloadLifetimeSeconds = 60;

function mimeMatches(prefix, mimeType) {
  switch (mimeType) {
    case "image/png": return prefix.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"));
    case "image/jpeg": return prefix.subarray(0, 3).equals(Buffer.from("ffd8ff", "hex"));
    case "image/webp": return prefix.toString("ascii", 0, 4) === "RIFF" && prefix.toString("ascii", 8, 12) === "WEBP";
    case "video/mp4": return prefix.length >= 12 && prefix.toString("ascii", 4, 8) === "ftyp";
    case "application/pdf": return prefix.toString("ascii", 0, 5) === "%PDF-";
    default: return false;
  }
}

function signedTime(ttl, expiry) {
  const signingDate = new Date(Math.floor(Date.now() / 1000) * 1000);
  const expiresIn = expiry ? Math.min(ttl, Math.floor((expiry - signingDate) / 1000)) : ttl;
  if (expiresIn < 1 || (expiry && expiry <= Date.now())) {
    throw new CaseAssetError(410, "UPLOAD_SESSION_EXPIRED", "上传会话已过期");
  }
  return { signingDate, expiresIn, expiresAt: new Date(+signingDate + expiresIn * 1000) };
}

function objectMatches(stored, expected, version) {
  return stored.VersionId === version && stored.ContentLength === expected.sizeBytes && stored.ContentType === expected.mimeType
    && (stored.ContentEncoding === undefined || stored.ContentEncoding === "identity");
}

function downloadName(fileName) {
  const encoded = encodeURIComponent(fileName).replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="asset"; filename*=UTF-8''${encoded}`;
}

export async function readCaseAssetStorage() {
  const bucket = process.env.CASE_GATEWAY_ASSET_BUCKET;
  const endpoint = URL.parse(process.env.CASE_GATEWAY_S3_ENDPOINT ?? "");
  if (bucket === undefined && process.env.CASE_GATEWAY_S3_ENDPOINT === undefined) return null;
  if (!bucket || !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket) || !endpoint
      || endpoint.username || endpoint.password || endpoint.search || endpoint.hash
      || !(endpoint.protocol === "https:" || (endpoint.protocol === "http:" && endpoint.hostname === "127.0.0.1"))) {
    throw new CaseDataError("案例桶需要有效桶名和 HTTPS 地址，本地允许 127.0.0.1 的 HTTP");
  }
  const [accessKeyId, secretAccessKey] = await Promise.all([
    readCredential("CASE_GATEWAY_SECRET_DIR", "case_s3_access_key"),
    readCredential("CASE_GATEWAY_SECRET_DIR", "case_s3_secret_key"),
  ]);
  if (!accessKeyId || !secretAccessKey) throw new CaseDataError("案例桶凭据不能为空");
  const downloadLifetimeSeconds = Number(process.env.CASE_GATEWAY_ASSET_DOWNLOAD_SECONDS ?? maxDownloadLifetimeSeconds);
  if (!Number.isInteger(downloadLifetimeSeconds) || downloadLifetimeSeconds < 1
      || downloadLifetimeSeconds > maxDownloadLifetimeSeconds) {
    throw new CaseDataError("案例下载票据有效期必须是 1 至 60 秒");
  }
  return createCaseAssetStorage(new S3Client({
    endpoint: endpoint.href, region: process.env.CASE_GATEWAY_S3_REGION ?? "us-east-1",
    forcePathStyle: true, credentials: { accessKeyId, secretAccessKey }, maxAttempts: 1,
    requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED",
  }), bucket, downloadLifetimeSeconds);
}

function createCaseAssetStorage(client, bucket, downloadLifetimeSeconds) {
  const admit = createStorageCircuit();
  let verifying = false;

  async function send(command, signal, recoverConditionalWrite = false) {
    const report = admit();
    if (!report) throw unavailable();
    try {
      const result = await client.send(command, { abortSignal: signal });
      report(true);
      return result;
    } catch (error) {
      const status = error?.$metadata?.httpStatusCode;
      report(status >= 400 && status < 500 && ![401, 403, 429].includes(status));
      if (status === 404 || (recoverConditionalWrite && [409, 412].includes(status))) return null;
      throw unavailable();
    }
  }

  async function probe() {
    const result = await send(new GetBucketVersioningCommand({ Bucket: bucket }), AbortSignal.timeout(2000));
    if (result?.Status !== "Enabled") throw unavailable();
  }

  const multipartKey = (upload) => ({ Bucket: bucket, Key: upload.objectKey, UploadId: upload.multipartUploadId });

  return {
    probe,
    async uploadTarget(upload) {
      await probe();
      const { expiresAt, ...timing } = signedTime(putLifetimeSeconds, upload.expiresAt);
      const checksum = Buffer.from(upload.sha256, "hex").toString("base64");
      const headers = { "content-type": upload.mimeType, "content-length": String(upload.sizeBytes),
        "if-none-match": "*", "x-amz-checksum-sha256": checksum };
      const url = await getSignedUrl(client, new PutObjectCommand({
        Bucket: bucket, Key: upload.objectKey, ContentType: upload.mimeType,
        ContentLength: upload.sizeBytes, IfNoneMatch: "*", ChecksumSHA256: checksum,
      }), { ...timing, signableHeaders: new Set(Object.keys(headers)),
        unhoistableHeaders: new Set(["x-amz-checksum-sha256"]) });
      return { method: "PUT", url, expiresAt, headers };
    },
    async openMultipart(upload) {
      await probe();
      const result = await send(new CreateMultipartUploadCommand({
        Bucket: bucket, Key: upload.objectKey, ContentType: upload.mimeType,
      }), AbortSignal.timeout(3000));
      if (!result?.UploadId) throw unavailable();
      return result.UploadId;
    },
    async listParts(upload) {
      const result = await send(new ListPartsCommand({ ...multipartKey(upload), MaxParts: caseUploadMaxParts + 1 }),
        AbortSignal.timeout(3000));
      if (!result) return null;
      if (result.IsTruncated || (result.Parts?.length ?? 0) > caseUploadMaxParts) {
        throw new CaseAssetError(422, "ASSET_OBJECT_MISMATCH", "对象存储返回了不合法的分片清单");
      }
      const parts = (result.Parts ?? []).map(({ PartNumber, ETag, Size }) => {
        if (!PartNumber || !ETag || !Number.isSafeInteger(Size)) throw unavailable();
        return { partNumber: PartNumber, eTag: ETag, sizeBytes: Size };
      });
      return parts.sort((left, right) => left.partNumber - right.partNumber);
    },
    async partTarget(upload, partNumber, sizeBytes) {
      const { expiresAt, ...timing } = signedTime(putLifetimeSeconds, upload.expiresAt);
      const url = await getSignedUrl(client, new UploadPartCommand({
        ...multipartKey(upload), PartNumber: partNumber, ContentLength: sizeBytes,
      }), { ...timing, signableHeaders: new Set(["content-length"]) });
      return { method: "PUT", url, expiresAt, headers: { "content-length": String(sizeBytes) } };
    },
    async mergeParts(upload, parts) {
      const result = await send(new CompleteMultipartUploadCommand({
        ...multipartKey(upload), IfNoneMatch: "*",
        MultipartUpload: { Parts: parts.map(({ partNumber, eTag }) => ({ PartNumber: partNumber, ETag: eTag })) },
      }), AbortSignal.timeout(8000), true);
      return result?.VersionId && result.VersionId !== "null" ? result.VersionId : null;
    },
    async locateUploadVersion(upload) {
      const result = await send(new ListObjectVersionsCommand({ Bucket: bucket, Prefix: upload.objectKey, MaxKeys: 2 }),
        AbortSignal.timeout(3000));
      const matches = (result?.Versions ?? []).filter((entry) => entry.Key === upload.objectKey);
      if (result?.IsTruncated || matches.length > 1 || result?.DeleteMarkers?.some((entry) => entry.Key === upload.objectKey)) {
        throw new CaseAssetError(409, "UPLOAD_VERSION_AMBIGUOUS", "不能确定该会话唯一的对象版本");
      }
      const id = matches[0]?.VersionId;
      return id && id !== "null" ? id : null;
    },
    async verify(upload, version, deadline) {
      // 命中慢对象时最多占用一个网关数据库连接，其他请求仍有连接可用。
      if (verifying) throw new CaseAssetError(503, "ASSET_VERIFICATION_BUSY", "素材校验处理中，请用原操作标识重试");
      verifying = true;
      try {
        const timeout = AbortSignal.timeout(upload.sizeBytes > caseSingleUploadMaxBytes ? 45_000 : 10_000);
        const signal = deadline ? AbortSignal.any([timeout, deadline]) : timeout;
        const found = await send(new GetObjectCommand({ Bucket: bucket, Key: upload.objectKey, VersionId: version }), signal);
        if (!found) throw new CaseAssetError(409, "UPLOAD_OBJECT_MISSING", "对象版本尚不可读取");
        const stream = found.Body;
        if (!stream) throw unavailable();
        const abort = () => stream.destroy(signal.reason);
        signal.addEventListener("abort", abort, { once: true });
        try {
          signal.throwIfAborted();
          if (!objectMatches(found, upload, version)) throw mismatch();
          const hash = createHash("sha256");
          let size = 0;
          let prefix = Buffer.alloc(0);
          for await (const chunk of stream) {
            signal.throwIfAborted();
            size += chunk.length;
            if (size > upload.sizeBytes) throw mismatch();
            if (prefix.length < 16) prefix = Buffer.concat([prefix, chunk.subarray(0, 16 - prefix.length)]);
            hash.update(chunk);
          }
          if (size !== upload.sizeBytes || hash.digest("hex") !== upload.sha256 || !mimeMatches(prefix, upload.mimeType)) {
            throw mismatch();
          }
        } catch (error) {
          if (error instanceof CaseAssetError) throw error;
          throw unavailable();
        } finally {
          signal.removeEventListener("abort", abort);
          stream.destroy();
        }
      } finally {
        verifying = false;
      }
    },
    async downloadTicket(asset) {
      const key = { Bucket: bucket, Key: asset.objectKey, VersionId: asset.objectVersionId };
      const found = await send(new HeadObjectCommand(key), AbortSignal.timeout(2000));
      if (!found) throw new CaseAssetError(404, "NOT_FOUND", "素材对象版本不存在");
      if (!objectMatches(found, asset, asset.objectVersionId)) throw mismatch();
      const { expiresAt, ...timing } = signedTime(downloadLifetimeSeconds);
      const url = await getSignedUrl(client, new GetObjectCommand({
        ...key, ResponseContentDisposition: downloadName(asset.fileName),
        ResponseContentType: "application/octet-stream", ResponseCacheControl: "private, no-store",
      }), timing);
      return { method: "GET", url, expiresAt, objectVersionId: asset.objectVersionId };
    },
  };
}
