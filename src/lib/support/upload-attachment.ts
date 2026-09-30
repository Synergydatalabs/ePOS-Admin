// Mirror of tap-app/src/lib/support/upload-attachment.ts. Same two-step
// flow (presign → PUT to S3). Keep in lockstep with the tap-app copy.

export interface UploadedAttachment {
  s3Key: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
}

export async function uploadSupportAttachment(args: {
  threadId: string;
  file: File;
  presignUrl: string;
}): Promise<UploadedAttachment> {
  const presignRes = await fetch(args.presignUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      fileName: args.file.name,
      contentType: args.file.type || "application/octet-stream",
      sizeBytes: args.file.size,
    }),
  });
  if (!presignRes.ok) {
    const err = await presignRes.json().catch(() => ({}));
    throw new Error(err.error || `presign failed: HTTP ${presignRes.status}`);
  }
  const { uploadUrl, s3Key } = (await presignRes.json()) as {
    uploadUrl: string;
    s3Key: string;
  };

  const put = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "content-type": args.file.type || "application/octet-stream" },
    body: args.file,
  });
  if (!put.ok) {
    throw new Error(`S3 upload failed: HTTP ${put.status}`);
  }

  return {
    s3Key,
    fileName: args.file.name,
    contentType: args.file.type || "application/octet-stream",
    sizeBytes: args.file.size,
  };
}

export function humanFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
