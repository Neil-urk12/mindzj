// ---------------------------------------------------------------------------
// Plugin data directory map — standalone module to avoid circular deps
// ---------------------------------------------------------------------------

const pluginDataDirMap = new Map<string, string>();

function isSafePathSegment(seg: string): boolean {
    return /^[a-zA-Z0-9._-]+$/.test(seg) && seg !== ".." && seg !== ".";
}

function getPluginDataDir(pluginId: string): string {
    const mapped = pluginDataDirMap.get(pluginId);
    if (mapped !== undefined) return mapped;
    // Fallback: return pluginId if it's safe, otherwise empty string
    return isSafePathSegment(pluginId) ? pluginId : "";
}
export { getPluginDataDir };

function setPluginDataDir(pluginId: string, dirName: string): boolean {
    // Reject unsafe pluginId — don't store at all
    if (!isSafePathSegment(pluginId)) {
        return false;
    }
    // Reject unsafe dirName — fall back to pluginId
    if (!isSafePathSegment(dirName)) {
        dirName = pluginId;
    }
    pluginDataDirMap.set(pluginId, dirName);
    return true;
}
export { setPluginDataDir };

function deletePluginDataDir(pluginId: string): void {
    pluginDataDirMap.delete(pluginId);
}
export { deletePluginDataDir };

function getAllPluginDataDirs(): ReadonlyMap<string, string> {
    return pluginDataDirMap;
}
export { getAllPluginDataDirs };
