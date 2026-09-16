import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const client = new S3Client({
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
});

export async function presignPutObject(
    bucketName: string,
    key: string,
): Promise<string> {
    const command = new PutObjectCommand({
        Bucket: bucketName,
        Key: key,
    });
    return getSignedUrl(client, command, { expiresIn: 900 });
}
