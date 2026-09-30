// S3 helper for support-chat attachments (private, presigned in and out).
// Same bucket as KYB docs; keys sit under a `support/` prefix so lifecycle
// rules and audit paths stay separable. Uploads are direct-to-S3 via a
// presigned PUT so the Node handler never buffers the file.
//
// TTLs:
//   PUT (upload)   → 5 minutes. Long enough for a slow phone upload,
//                    short enough that a stolen URL is dead by the time
//                    it surfaces. The URL is single-use for a specific
//                    (bucket, key, content-type, content-length) tuple.
//   GET (download) → 5 minutes. Fresh URL is minted on every thread
//                    fetch, so an old browser tab won't cache a valid
//                    link past that window.

import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import crypto from "crypto";

const UPLOAD_TTL_SECONDS = 300;
const DOWNLOAD_TTL_SECONDS = 300;

// 25 MB per file. Balances "attach a photo of the receipt" against
// "single upload blocks Node for minutes on slow links." Anything larger
// belongs in a share link, not an inline attachment.
export const SUPPORT_ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;

// MIME whitelist. Deliberately excludes scripts, executables, HTML —
// admin operators may open attachments on a work laptop, so we're
// conservative about drive-by risk. Anything not on this list is 400.
export const SUPPORT_ATTACHMENT_ALLOWED_MIME = new Set<string>([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/heic",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",       // .xlsx
  "application/msword",   // .doc
  "application/vnd.ms-excel", // .xls
  "application/zip",
]);

function getEnv(): { bucket: string; region: string } {
  const bucket = process.env.S3_BUCKET_NAME || process.env.AWS_S3_BUCKET;
  const region = process.env.AWS_REGION || process.env.AWS_S3_REGION;
  if (!bucket) throw new Error("S3_BUCKET_NAME (or AWS_S3_BUCKET) is not set");
  if (!region) throw new Error("AWS_REGION (or AWS_S3_REGION) is not set");
  return { bucket, region };
}

let cachedClient: S3Client | null = null;
function client(): S3Client {
  if (!cachedClient) cachedClient = new S3Client({ region: getEnv().region });
  return cachedClient;
}

// s3 keys look like: support/<threadId>/<uuid>-<safeName>
// Grouping by thread keeps CloudTrail/S3 access logs greppable per-case.
export function buildSupportAttachmentKey(args: {
  threadId: string;
  fileName: string;
}): string {
  const safe = args.fileName
    .replace(/[^\w.\-]/g, "_")
    .slice(-120); // cap length to keep the whole key under S3's 1024
  const id = crypto.randomBytes(8).toString("hex");
  return `support/${args.threadId}/${id}-${safe}`;
}

export async function presignSupportUpload(args: {
  key: string;
  contentType: string;
}): Promise<{ url: string; expiresAt: string }> {
  const { bucket } = getEnv();
  const url = await getSignedUrl(
    client(),
    new PutObjectCommand({
      Bucket: bucket,
      Key: args.key,
      ContentType: args.contentType,
    }),
    { expiresIn: UPLOAD_TTL_SECONDS }
  );
  return {
    url,
    expiresAt: new Date(Date.now() + UPLOAD_TTL_SECONDS * 1000).toISOString(),
  };
}

export async function presignSupportDownload(args: {
  s3Key: string;
  fileName: string;
}): Promise<string> {
  const { bucket } = getEnv();
  return getSignedUrl(
    client(),
    new GetObjectCommand({
      Bucket: bucket,
      Key: args.s3Key,
      ResponseContentDisposition: `attachment; filename="${args.fileName.replace(/"/g, "")}"`,
    }),
    { expiresIn: DOWNLOAD_TTL_SECONDS }
  );
}
