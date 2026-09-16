import {
  DeleteObjectsCommand,
  paginateListObjectsV2,
  S3Client,
} from "@aws-sdk/client-s3";
import { Resource } from "sst";

export async function emptyBucket(): Promise<{ deleted: number }> {
  if (process.env.SST_STAGE === "production") {
    throw new Error("refusing to empty SQLDevBucket on production");
  }

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
