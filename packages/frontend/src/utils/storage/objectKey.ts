export type ObjectKeyParts = {
    userId: string;
    storageObjectId: string;
    storageObjectDataId: string;
    fileName: string;
};

export type ObjectKeyRef = ObjectKeyParts;

const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUuid(value: string, label: string): void {
    if (!UUID_PATTERN.test(value)) {
        throw new Error(`${label} must be a valid UUID`);
    }
}

export function parseObjectKey(key: string): ObjectKeyParts {
    const trimmed = key.trim();
    if (!trimmed) {
        throw new Error("object key is required");
    }

    const slashIndexes: number[] = [];
    for (let i = 0; i < trimmed.length && slashIndexes.length < 3; i++) {
        if (trimmed[i] === "/") {
            slashIndexes.push(i);
        }
    }

    if (slashIndexes.length < 3) {
        throw new Error(
            "object key must contain userId, storageObjectId, storageObjectDataId, and fileName segments",
        );
    }

    const parts: ObjectKeyParts = {
        userId: trimmed.slice(0, slashIndexes[0]),
        storageObjectId: trimmed.slice(slashIndexes[0] + 1, slashIndexes[1]),
        storageObjectDataId: trimmed.slice(
            slashIndexes[1] + 1,
            slashIndexes[2],
        ),
        fileName: trimmed.slice(slashIndexes[2] + 1),
    };

    assertUuid(parts.userId, "userId");
    assertUuid(parts.storageObjectId, "storageObjectId");
    assertUuid(parts.storageObjectDataId, "storageObjectDataId");
    if (!parts.fileName.trim()) {
        throw new Error("fileName is required");
    }

    return parts;
}

export function toQueryParams(parts: ObjectKeyParts): URLSearchParams {
    const params = new URLSearchParams();
    params.set("userId", parts.userId);
    params.set("storageObjectId", parts.storageObjectId);
    params.set("storageObjectDataId", parts.storageObjectDataId);
    params.set("fileName", parts.fileName);
    return params;
}

export function toObjectKeyRef(parts: ObjectKeyParts): ObjectKeyRef {
    return {
        userId: parts.userId,
        storageObjectId: parts.storageObjectId,
        storageObjectDataId: parts.storageObjectDataId,
        fileName: parts.fileName,
    };
}
