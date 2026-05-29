import { Component, createSignal, For, onMount, onCleanup, Show } from "solid-js";
import { vaultStore } from "../../stores/vault";
import { t } from "../../i18n";
import { Z_DROPDOWN } from "@/constants/zIndex";

// Vault Switcher Popup (bottom-left of sidebar)
// ============================================================================

export const VaultSwitcher: Component<{
    onClose: () => void;
    onCloseVault: () => Promise<void>;
}> = (props) => {
    const [vaults, setVaults] = createSignal<{ name: string; path: string }[]>(
        [],
    );

    // Normalize path for comparison (handle Windows \\?\ prefix and slash differences)
    function normalizePath(p: string | undefined): string {
        if (!p) return "";
        return p
            .replace(/^\\\\?\?\\/i, "")
            .replace(/\\/g, "/")
            .toLowerCase();
    }

    onMount(() => {
        try {
            const saved = localStorage.getItem("mindzj-vault-list");
            if (saved) setVaults(JSON.parse(saved));
        } catch {}

        const handleClick = (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            if (!target.closest(".mz-vault-switcher")) props.onClose();
        };
        setTimeout(() => document.addEventListener("click", handleClick), 0);
        onCleanup(() => document.removeEventListener("click", handleClick));
    });

    async function openVaultInNewWindow(path: string, name: string) {
        try {
            const { invoke } = await import("@tauri-apps/api/core");
            await invoke("open_vault_window", {
                vaultPath: path,
                vaultName: name,
            });
        } catch (e) {
            console.error("Failed to open vault in new window:", e);
            // Fallback: open in current window
            await vaultStore.openVault(path, name);
        }
    }

    return (
        <div
            class="mz-vault-switcher"
            style={{
                position: "absolute",
                bottom: "100%",
                left: "0",
                "min-width": "220px",
                "margin-bottom": "4px",
                background: "var(--mz-bg-secondary)",
                border: "1px solid var(--mz-border-strong)",
                "border-radius": "var(--mz-radius-md)",
                "box-shadow": "0 8px 24px rgba(0,0,0,0.25)",
                padding: "4px 0",
                "z-index": Z_DROPDOWN,
            }}>
            {/* Vault list */}
            <For each={vaults()}>
                {(v) => {
                    const isCurrent =
                        normalizePath(v.path) ===
                        normalizePath(
                            vaultStore.vaultInfo()?.path as unknown as string,
                        );
                    return (
                        <button
                            onClick={async () => {
                                if (!isCurrent) {
                                    await openVaultInNewWindow(v.path, v.name);
                                }
                                props.onClose();
                            }}
                            style={{
                                display: "flex",
                                "align-items": "center",
                                "justify-content": "space-between",
                                width: "100%",
                                padding: "8px 12px",
                                border: "none",
                                background: "transparent",
                                color: "var(--mz-text-primary)",
                                cursor: "pointer",
                                "font-size": "var(--mz-font-size-sm)",
                                "font-family": "var(--mz-font-sans)",
                                "text-align": "left",
                                gap: "8px",
                            }}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.background =
                                    "var(--mz-bg-hover)";
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.background =
                                    "transparent";
                            }}>
                            <svg
                                width="14"
                                height="14"
                                viewBox="0 0 20 20"
                                fill="none"
                                style={{ "flex-shrink": "0" }}>
                                <rect
                                    x="2"
                                    y="4"
                                    width="16"
                                    height="13"
                                    rx="2"
                                    stroke={
                                        isCurrent
                                            ? "var(--mz-accent)"
                                            : "var(--mz-text-muted)"
                                    }
                                    stroke-width="1.5"
                                    fill="none"
                                />
                                <path
                                    d="M2 7H18"
                                    stroke={
                                        isCurrent
                                            ? "var(--mz-accent)"
                                            : "var(--mz-text-muted)"
                                    }
                                    stroke-width="1.5"
                                />
                            </svg>
                            <span
                                style={{
                                    overflow: "hidden",
                                    "text-overflow": "ellipsis",
                                    "white-space": "nowrap",
                                    flex: "1",
                                }}>
                                {v.name}
                            </span>
                            <Show when={isCurrent}>
                                <svg
                                    width="14"
                                    height="14"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="var(--mz-accent)"
                                    stroke-width="2.5"
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                    style={{ "flex-shrink": "0" }}>
                                    <path d="M20 6L9 17l-5-5" />
                                </svg>
                            </Show>
                            <Show when={!isCurrent}>
                                <svg
                                    width="12"
                                    height="12"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="var(--mz-text-muted)"
                                    stroke-width="2"
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                    style={{
                                        "flex-shrink": "0",
                                        opacity: "0.5",
                                    }}>
                                    <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" />
                                </svg>
                            </Show>
                        </button>
                    );
                }}
            </For>

            {/* Divider */}
            <Show when={vaults().length > 0}>
                <div
                    style={{
                        height: "1px",
                        background: "var(--mz-border)",
                        margin: "4px 8px",
                    }}
                />
            </Show>

            {/* Manage vaults */}
            <button
                onClick={async () => {
                    props.onClose();
                    await props.onCloseVault();
                }}
                style={{
                    display: "flex",
                    "align-items": "center",
                    gap: "8px",
                    width: "100%",
                    padding: "8px 12px",
                    border: "none",
                    background: "transparent",
                    color: "var(--mz-text-secondary)",
                    cursor: "pointer",
                    "font-size": "var(--mz-font-size-sm)",
                    "font-family": "var(--mz-font-sans)",
                    "text-align": "left",
                }}
                onMouseEnter={(e) => {
                    e.currentTarget.style.background = "var(--mz-bg-hover)";
                }}
                onMouseLeave={(e) => {
                    e.currentTarget.style.background = "transparent";
                }}>
                <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round">
                    <path d="M12 3h7a2 2 0 012 2v14a2 2 0 01-2 2h-7M19 12H5M5 12l4-4M5 12l4 4" />
                </svg>
                {t("common.manageVaults")}
            </button>
        </div>
    );
};
