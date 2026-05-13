export type ClientPlatform = "windows" | "macos" | "linux" | "unknown";

let cachedPlatform: ClientPlatform | null = null;

export function getClientPlatform(): ClientPlatform {
    if (cachedPlatform) return cachedPlatform;
    const value = [
        typeof navigator !== "undefined" ? navigator.userAgent : "",
        typeof navigator !== "undefined" ? navigator.platform : "",
    ]
        .join(" ")
        .toLowerCase();

    if (/\bwin/.test(value)) cachedPlatform = "windows";
    else if (/mac|iphone|ipad|ipod/.test(value)) cachedPlatform = "macos";
    else if (/linux|x11|wayland/.test(value)) cachedPlatform = "linux";
    else cachedPlatform = "unknown";

    return cachedPlatform;
}

export function installPlatformAttributes() {
    if (typeof document === "undefined") return;
    document.documentElement.setAttribute(
        "data-mz-platform",
        getClientPlatform(),
    );
}
