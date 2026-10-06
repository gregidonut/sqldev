import {
  DeleteObjectsCommand,
  paginateListObjectsV2,
  S3Client,
} from "@aws-sdk/client-s3";
import { Resource } from "sst";

function assertNotProduction(): void {
  const stage = process.env.STAGE ?? process.env.SST_STAGE;
  if (stage === "production" || stage === "prod") {
    throw new Error("refusing to modify SQLDevBucket on production");
  }
}

export async function deleteObjectKeys(
  keys: readonly string[],
): Promise<{ deleted: number }> {
  assertNotProduction();

  const unique = [...new Set(keys)].filter((key) => key.length > 0);
  if (unique.length === 0) {
    return { deleted: 0 };
  }

  const bucketName = Resource.SQLDevBucket.name;
  const client = new S3Client({});
  let deleted = 0;

  for (let offset = 0; offset < unique.length; offset += 1000) {
    const objects = unique
      .slice(offset, offset + 1000)
      .map((Key) => ({ Key }));
    const result = await client.send(
      new DeleteObjectsCommand({
        Bucket: bucketName,
        Delete: { Objects: objects, Quiet: true },
      }),
    );
    const firstError = result.Errors?.[0];
    if (firstError) {
      throw new Error(firstError.Message ?? "DeleteObjects failed");
    }
    deleted += objects.length;
  }

  return { deleted };
}

export async function emptyBucket(): Promise<{ deleted: number }> {
  assertNotProduction();

  const bucketName = Resource.SQLDevBucket.name;
  const client = new S3Client({});
  let deleted = 0;

  for await (const page of paginateListObjectsV2(
    { client },
    { Bucket: bucketName },
  )) {
    const objects = (page.Contents ?? []).flatMap((object) =>
      object.Key ? [{ Key: object.Key }] : [],
    );
    if (objects.length === 0) {
      continue;
    }

    const result = await client.send(
      new DeleteObjectsCommand({
        Bucket: bucketName,
        Delete: { Objects: objects, Quiet: true },
      }),
    );
    const firstError = result.Errors?.[0];
    if (firstError) {
      throw new Error(firstError.Message ?? "DeleteObjects failed");
    }

    deleted += objects.length;
  }

  return { deleted };
}
