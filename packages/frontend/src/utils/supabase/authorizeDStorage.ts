import type { APIContext } from "astro";
import { getSupabaseBrowserClient } from "@/utils/supabase/browserClient";
import type { Database } from "@/utils/supabase/models";
import {
    parseObjectKey,
    toObjectKeyRef,
    toQueryParams,
    type ObjectKeyParts,
} from "@/utils/storage/objectKey";
import { parseObjectsTab, type ObjectsTab } from "@/utils/storage/objectsTab";

type SupabaseBrowserClient = ReturnType<typeof getSupabaseBrowserClient>;
type StoragePermission =
    Database["public"]["Enums"]["d_storage_objects_permission"];
type StorageObjectLookupRow = {
    storage_object_id: string;
    public: boolean;
};

export type PendingUpload = {
    storageObjectId: string;
    storageObjectDataId: string;
    fileName: string;
    isNewObject: boolean;
    s3ObjectKey: string;
};

export type AuthorizeDStorageContinue = {
    continue: true;
    upstreamQueryParams?: URLSearchParams;
    upstreamBody?: string;
    pendingUpload?: PendingUpload;
    bufferedBody?: ArrayBuffer;
};

export type AuthorizeDStorageResult = Response | AuthorizeDStorageContinue;

type StorageRoute =
    | { kind: "head" }
    | { kind: "objects" }
    | { kind: "download" }
    | { kind: "copy" }
    | { kind: "object" };

type PrepareUploadRow = {
    user_id: string;
    storage_object_id: string;
    storage_object_data_id: string;
    file_name: string;
    s3_object_key: string;
    is_new_object: boolean;
};

const JSON_HEADERS = { "Content-Type": "application/json" } as const;

function jsonMessage(message: string, status: number): Response {
    return new Response(JSON.stringify({ message }), {
        status,
        headers: JSON_HEADERS,
    });
}

function forbidden(): Response {
    return jsonMessage("Forbidden", 403);
}

function allowProxy(
    partial?: Partial<Omit<AuthorizeDStorageContinue, "continue">>,
): AuthorizeDStorageContinue {
    return {
        continue: true,
        ...partial,
    };
}

function matchStorageRoute(path: string): StorageRoute | null {
    if (/^buckets\/[^/]+\/objects\/download$/.test(path)) {
        return { kind: "download" };
    }
    if (/^buckets\/[^/]+\/objects\/copy$/.test(path)) {
        return { kind: "copy" };
    }
    if (/^buckets\/[^/]+\/objects\/object$/.test(path)) {
        return { kind: "object" };
    }
    if (/^buckets\/[^/]+\/objects$/.test(path)) {
        return { kind: "objects" };
    }
    if (/^buckets\/[^/]+$/.test(path)) {
        return { kind: "head" };
    }
    return null;
}

function requiredKey(request: Request): string | Response {
    const key = new URL(request.url).searchParams.get("key");
    if (!key) {
        return jsonMessage("key is required", 400);
    }
    return key;
}

function requiredFileName(request: Request): string | Response {
    const fileName = new URL(request.url).searchParams.get("fileName");
    if (!fileName) {
        return jsonMessage("fileName is required", 400);
    }
    return fileName;
}

function parseKeyOrError(key: string): ObjectKeyParts | Response {
    try {
        return parseObjectKey(key);
    } catch (error) {
        const message =
            error instanceof Error ? error.message : "Invalid object key";
        return jsonMessage(message, 400);
    }
}

function requiredTab(request: Request): ObjectsTab | Response {
    try {
        return parseObjectsTab(new URL(request.url).searchParams.get("tab"));
    } catch (error) {
        const message = error instanceof Error ? error.message : "Invalid tab";
        return jsonMessage(message, 400);
    }
}

async function readJsonBody(
    request: Request,
): Promise<
    | { ok: true; body: unknown; buffer: ArrayBuffer }
    | { ok: false; response: Response }
> {
    const buffer = await request.arrayBuffer();
    try {
        const text = new TextDecoder().decode(buffer);
        return { ok: true, body: JSON.parse(text) as unknown, buffer };
    } catch {
        return { ok: false, response: jsonMessage("Invalid JSON body", 400) };
    }
}

async function lookupByKey(
    client: SupabaseBrowserClient,
    key: string,
): Promise<{ row: StorageObjectLookupRow | null } | { error: Response }> {
    const { data, error } = await client.rpc("get_d_storage_object_by_key", {
        p_s3_object_key: key,
    });

    if (error) {
        return { error: jsonMessage(error.message, 500) };
    }

    return { row: (data as StorageObjectLookupRow[] | null)?.[0] ?? null };
}

async function authorizePermission(
    client: SupabaseBrowserClient,
    userId: string,
    permission: StoragePermission,
    storageObjectId: string,
): Promise<Response | null> {
    const { data, error } = await client.rpc("authorize_d_storage_object", {
        p_requested_user_id: userId,
        p_requested_permission: permission,
        p_requested_storage_object_id: storageObjectId,
    });

    if (error) {
        return jsonMessage(error.message, 500);
    }
    if (!data) {
        return forbidden();
    }
    return null;
}

async function authorizeExistingKey(
    client: SupabaseBrowserClient,
    userId: string,
    key: string,
    permission: StoragePermission,
): Promise<
    { storageObjectId: string } | { error: Response } | { missing: true }
> {
    const lookup = await lookupByKey(client, key);
    if ("error" in lookup) {
        return lookup;
    }
    if (!lookup.row?.storage_object_id) {
        return { missing: true };
    }

    const denied = await authorizePermission(
        client,
        userId,
        permission,
        lookup.row.storage_object_id,
    );
    if (denied) {
        return { error: denied };
    }

    return { storageObjectId: lookup.row.storage_object_id };
}

async function prepareUpload(
    client: SupabaseBrowserClient,
    fileName: string,
): Promise<{ row: PrepareUploadRow } | { error: Response }> {
    const { data, error } = await client.rpc("prepare_d_storage_upload", {
        p_file_name: fileName,
    });

    if (error) {
        if (error.message.includes("forbidden")) {
            return { error: forbidden() };
        }
        return { error: jsonMessage(error.message, 500) };
    }

    const row = (data as PrepareUploadRow[] | null)?.[0];
    if (!row) {
        return { error: jsonMessage("prepare_d_storage_upload returned no rows", 500) };
    }

    return { row };
}

async function listViewKeys(
    client: SupabaseBrowserClient,
    tab: ObjectsTab,
): Promise<Response> {
    const { data, error } = await client.rpc("get_d_storage_objects", {
        p_tab: tab,
    });

    if (error) {
        return jsonMessage(error.message, 500);
    }

    const objects = (data ?? [])
        .map((row) => row.s3_object_key)
        .filter(
            (key): key is string => typeof key === "string" && key.length > 0,
        )
        .map((key) => ({ key }));

    return new Response(JSON.stringify(objects), {
        status: 200,
        headers: JSON_HEADERS,
    });
}

async function authorizeDownload(
    client: SupabaseBrowserClient,
    userId: string,
    request: Request,
): Promise<AuthorizeDStorageResult> {
    const keyOrError = requiredKey(request);
    if (keyOrError instanceof Response) {
        return keyOrError;
    }

    const lookup = await lookupByKey(client, keyOrError);
    if ("error" in lookup) {
        return lookup.error;
    }
    if (!lookup.row?.storage_object_id) {
        return forbidden();
    }
    if (lookup.row.public === true) {
        const parts = parseKeyOrError(keyOrError);
        if (parts instanceof Response) {
            return parts;
        }
        return allowProxy({ upstreamQueryParams: toQueryParams(parts) });
    }

    const denied = await authorizePermission(
        client,
        userId,
        "d_storage_objects.read",
        lookup.row.storage_object_id,
    );
    if (denied) {
        return denied;
    }

    const parts = parseKeyOrError(keyOrError);
    if (parts instanceof Response) {
        return parts;
    }
    return allowProxy({ upstreamQueryParams: toQueryParams(parts) });
}

async function authorizeUpload(
    client: SupabaseBrowserClient,
    _userId: string,
    request: Request,
): Promise<AuthorizeDStorageResult> {
    const fileNameOrError = requiredFileName(request);
    if (fileNameOrError instanceof Response) {
        return fileNameOrError;
    }

    const prepared = await prepareUpload(client, fileNameOrError);
    if ("error" in prepared) {
        return prepared.error;
    }

    const { row } = prepared;
    const upstreamQueryParams = toQueryParams({
        userId: row.user_id,
        storageObjectId: row.storage_object_id,
        storageObjectDataId: row.storage_object_data_id,
        fileName: row.file_name,
    });

    return allowProxy({
        upstreamQueryParams,
        pendingUpload: {
            storageObjectId: row.storage_object_id,
            storageObjectDataId: row.storage_object_data_id,
            fileName: row.file_name,
            isNewObject: row.is_new_object,
            s3ObjectKey: row.s3_object_key,
        },
    });
}

async function authorizeSingleDelete(
    client: SupabaseBrowserClient,
    userId: string,
    request: Request,
): Promise<AuthorizeDStorageResult> {
    const keyOrError = requiredKey(request);
    if (keyOrError instanceof Response) {
        return keyOrError;
    }

    const result = await authorizeExistingKey(
        client,
        userId,
        keyOrError,
        "d_storage_objects.delete",
    );
    if ("error" in result) {
        return result.error;
    }
    if ("missing" in result) {
        return forbidden();
    }

    const parts = parseKeyOrError(keyOrError);
    if (parts instanceof Response) {
        return parts;
    }
    return allowProxy({ upstreamQueryParams: toQueryParams(parts) });
}

function isBatchDeleteBody(body: unknown): body is { keys: string[] } {
    return (
        typeof body === "object" &&
        body !== null &&
        "keys" in body &&
        Array.isArray((body as { keys: unknown }).keys) &&
        (body as { keys: unknown[] }).keys.every(
            (key) => typeof key === "string",
        )
    );
}

async function authorizeBatchDelete(
    client: SupabaseBrowserClient,
    userId: string,
    request: Request,
): Promise<AuthorizeDStorageResult> {
    const parsed = await readJsonBody(request);
    if (!parsed.ok) {
        return parsed.response;
    }
    if (!isBatchDeleteBody(parsed.body)) {
        return jsonMessage("keys is required", 400);
    }

    const uniqueKeys = [...new Set(parsed.body.keys.filter((key) => key))];
    const refs = [];
    for (const key of uniqueKeys) {
        const result = await authorizeExistingKey(
            client,
            userId,
            key,
            "d_storage_objects.delete",
        );
        if ("error" in result) {
            return result.error;
        }
        if ("missing" in result) {
            return forbidden();
        }

        const parts = parseKeyOrError(key);
        if (parts instanceof Response) {
            return parts;
        }
        refs.push(toObjectKeyRef(parts));
    }

    return allowProxy({
        upstreamBody: JSON.stringify({ keys: refs }),
    });
}

function isCopyBody(
    body: unknown,
): body is { destinationBucket: string; destinationFileName: string } {
    return (
        typeof body === "object" &&
        body !== null &&
        "destinationBucket" in body &&
        typeof (body as { destinationBucket: unknown }).destinationBucket ===
            "string" &&
        (body as { destinationBucket: string }).destinationBucket.length > 0 &&
        "destinationFileName" in body &&
        typeof (body as { destinationFileName: unknown }).destinationFileName ===
            "string" &&
        (body as { destinationFileName: string }).destinationFileName.length > 0
    );
}

async function authorizeCopy(
    client: SupabaseBrowserClient,
    userId: string,
    request: Request,
): Promise<AuthorizeDStorageResult> {
    const sourceKeyOrError = requiredKey(request);
    if (sourceKeyOrError instanceof Response) {
        return sourceKeyOrError;
    }

    const parsed = await readJsonBody(request);
    if (!parsed.ok) {
        return parsed.response;
    }
    if (!isCopyBody(parsed.body)) {
        return jsonMessage(
            "destinationBucket and destinationFileName are required",
            400,
        );
    }

    const source = await authorizeExistingKey(
        client,
        userId,
        sourceKeyOrError,
        "d_storage_objects.read",
    );
    if ("error" in source) {
        return source.error;
    }
    if ("missing" in source) {
        return forbidden();
    }

    const sourceParts = parseKeyOrError(sourceKeyOrError);
    if (sourceParts instanceof Response) {
        return sourceParts;
    }

    const destinationPrepared = await prepareUpload(
        client,
        parsed.body.destinationFileName,
    );
    if ("error" in destinationPrepared) {
        return destinationPrepared.error;
    }

    const destination = destinationPrepared.row;
    const upstreamBody = JSON.stringify({
        destinationBucket: parsed.body.destinationBucket,
        destinationUserId: destination.user_id,
        destinationStorageObjectId: destination.storage_object_id,
        destinationStorageObjectDataId: destination.storage_object_data_id,
        destinationFileName: destination.file_name,
    });

    return allowProxy({
        upstreamQueryParams: toQueryParams(sourceParts),
        upstreamBody,
        pendingUpload: {
            storageObjectId: destination.storage_object_id,
            storageObjectDataId: destination.storage_object_data_id,
            fileName: destination.file_name,
            isNewObject: destination.is_new_object,
            s3ObjectKey: destination.s3_object_key,
        },
    });
}

export async function authorizeDStorage(
    context: APIContext,
    path: string,
): Promise<AuthorizeDStorageResult> {
    const route = matchStorageRoute(path);
    if (!route) {
        return forbidden();
    }

    const client = getSupabaseBrowserClient(context);
    const { data: userId, error: ownerError } = await client.rpc("set_owner");

    if (ownerError) {
        return jsonMessage(ownerError.message, 500);
    }

    if (!userId) {
        return forbidden();
    }

    const method = context.request.method.toUpperCase();

    if (route.kind === "head" && (method === "GET" || method === "HEAD")) {
        return allowProxy();
    }

    if (route.kind === "objects" && method === "GET") {
        const tabOrError = requiredTab(context.request);
        if (tabOrError instanceof Response) {
            return tabOrError;
        }
        return listViewKeys(client, tabOrError);
    }

    if (route.kind === "objects" && method === "POST") {
        return authorizeUpload(client, userId, context.request);
    }

    if (route.kind === "objects" && method === "DELETE") {
        return authorizeBatchDelete(client, userId, context.request);
    }

    if (route.kind === "download" && method === "GET") {
        return authorizeDownload(client, userId, context.request);
    }

    if (route.kind === "copy" && method === "POST") {
        return authorizeCopy(client, userId, context.request);
    }

    if (route.kind === "object" && method === "DELETE") {
        return authorizeSingleDelete(client, userId, context.request);
    }

    return forbidden();
}

export async function commitPendingUpload(
    context: APIContext,
    pending: PendingUpload,
): Promise<Response | null> {
    const client = getSupabaseBrowserClient(context);
    const { error } = await client.rpc("commit_d_storage_upload", {
        p_storage_object_id: pending.storageObjectId,
        p_storage_object_data_id: pending.storageObjectDataId,
        p_file_name: pending.fileName,
    });

    if (error) {
        return jsonMessage(error.message, 500);
    }

    return null;
}

export async function abortPendingUpload(
    context: APIContext,
    pending: PendingUpload,
): Promise<void> {
    const client = getSupabaseBrowserClient(context);
    await client.rpc("abort_d_storage_upload", {
        p_storage_object_id: pending.storageObjectId,
        p_is_new_object: pending.isNewObject,
    });
}

export async function deleteOrphanedObject(
    goApiUrl: string,
    bucketPath: string,
    pending: PendingUpload,
): Promise<void> {
    let parts;
    try {
        parts = parseObjectKey(pending.s3ObjectKey);
    } catch {
        return;
    }

    const search = toQueryParams(parts);
    const deletePath = bucketPath.replace(/\/objects$/, "/objects/object");
    const url = `${goApiUrl}/${deletePath}?${search.toString()}`;

    try {
        await fetch(url, { method: "DELETE" });
    } catch {
        // Best-effort cleanup when commit fails after a successful S3 upload.
    }
}
