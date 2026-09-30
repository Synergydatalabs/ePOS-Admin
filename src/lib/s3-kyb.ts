// ============================================================================
// src/lib/s3-kyb.ts (tapapp-admin)
//
// Admin-side S3 wrapper — download only. Merchants upload via tap-app;
// admins never write KYB files. Same bucket + IAM as the merchant app,
// but a smaller surface area kept behind a dedicated helper so a future
// bucket split (admin-only bucket for audit copies?) has one file to
// change.
//
// Config comes from env vars stamped onto the admin's EC2 machine:
//   S3_BUCKET_NAME   — same bucket tap-app uploads to
//   AWS_REGION       — same region as the bucket
//   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY — via IAM role on EC2
//                     (SDK reads them automatically; don't hardcode).
//
// URL TTL is 5 minutes — long enough for a slow admin download, short
// enough that a leaked URL from browser history is effectively dead.
// ============================================================================

import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const KYB_URL_TTL_SECONDS = 300;
// Forward-bundle ZIPs point to the processor's onboarding team via email; a
// 7-day TTL means the recipient has a full working week to grab the file
// without us re-signing. Longer than the normal 5-min doc URL because email
// links routinely sit unread for a couple of days.
const KYB_FORWARD_URL_TTL_SECONDS = 60 * 60 * 24 * 7;

interface S3Env {
  bucket: string;
  region: string;
}

function getEnv(): S3Env {
  // tap-app uses AWS_S3_BUCKET / AWS_S3_REGION. Admin's own env may not
  // have those legacy names, so we support the plainer S3_BUCKET_NAME /
  // AWS_REGION forms too. Fail loud if neither is set — an admin trying
  // to view a doc with a missing config gets a clear error rather than
  // an AWS "InvalidBucketName" wall of text.
  const bucket = process.env.S3_BUCKET_NAME || process.env.AWS_S3_BUCKET;
  const region = process.env.AWS_REGION || process.env.AWS_S3_REGION;
  if (!bucket) throw new Error("S3_BUCKET_NAME (or AWS_S3_BUCKET) is not set");
  if (!region) throw new Error("AWS_REGION (or AWS_S3_REGION) is not set");
  return { bucket, region };
}

let cachedClient: S3Client | null = null;

// Singleton — reused across all admin doc downloads for the process life.
// Credentials come from the EC2 IAM role by default; if AWS_ACCESS_KEY_ID
// / AWS_SECRET_ACCESS_KEY are set the SDK picks those up automatically.
function getClient(): S3Client {
  if (cachedClient) return cachedClient;
  const { region } = getEnv();
  cachedClient = new S3Client({ region });
  return cachedClient;
}

/**
 * Presigned GET URL for admin preview / download of a KybDocument object.
 * Optional filename + disposition let us force a proper download filename
 * on the "Download" button (vs an inline preview in the modal).
 */
export async function getKybDownloadUrl(args: {
  s3Key: string;
  filename?: string;
  disposition?: "inline" | "attachment";
}): Promise<{ url: string; expiresAt: string }> {
  const { bucket } = getEnv();
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: args.s3Key,
    ...(args.filename && args.disposition
      ? {
          ResponseContentDisposition: `${args.disposition}; filename="${args.filename.replace(/"/g, "")}"`,
        }
      : {}),
  });

  const url = await getSignedUrl(getClient(), command, {
    expiresIn: KYB_URL_TTL_SECONDS,
  });
  return {
    url,
    expiresAt: new Date(Date.now() + KYB_URL_TTL_SECONDS * 1000).toISOString(),
  };
}

/**
 * Upload a fully-buffered blob (the PDF+docs ZIP built by kyb-bundle) to S3.
 * Returns the object's key + a presigned GET URL with the long forward TTL
 * so the email can inline the URL for the processor's onboarding team.
 *
 * We buffer the whole ZIP in memory rather than stream because Phase 2b
 * KYB uploads are capped at ~10MB total per application — well within a
 * Node handler's memory budget on the EC2 instance size we use.
 */
export async function uploadKybForwardBundle(args: {
  key: string;
  body: Buffer;
  contentType?: string;
}): Promise<{ s3Key: string; downloadUrl: string; expiresAt: string }> {
  const { bucket } = getEnv();
  const put = new PutObjectCommand({
    Bucket: bucket,
    Key: args.key,
    Body: args.body,
    ContentType: args.contentType || "application/zip",
    // Server-side encryption comes from the bucket default (SSE-S3 / KMS
    // depending on env), so we don't set it explicitly here.
  });
  await getClient().send(put);

  const filename = args.key.split("/").pop() || "kyb-bundle.zip";
  const get = new GetObjectCommand({
    Bucket: bucket,
    Key: args.key,
    ResponseContentDisposition: `attachment; filename="${filename.replace(/"/g, "")}"`,
  });
  const downloadUrl = await getSignedUrl(getClient(), get, {
    expiresIn: KYB_FORWARD_URL_TTL_SECONDS,
  });
  return {
    s3Key: args.key,
    downloadUrl,
    expiresAt: new Date(Date.now() + KYB_FORWARD_URL_TTL_SECONDS * 1000).toISOString(),
  };
}

/**
 * Fetch a document's raw bytes for the bundle builder (used to stream files
 * into the ZIP archive without hopping through a presigned URL round-trip).
 */
export async function getKybDocumentBuffer(s3Key: string): Promise<Buffer> {
  const { bucket } = getEnv();
  const res = await getClient().send(
    new GetObjectCommand({ Bucket: bucket, Key: s3Key })
  );
  const body = res.Body;
  if (!body) throw new Error(`S3 object body missing for key ${s3Key}`);
  // AWS SDK v3 gives us a stream; collect into a Buffer.
  // (Reader helper works for both Node Readable and web ReadableStream.)
  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Uint8Array>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
