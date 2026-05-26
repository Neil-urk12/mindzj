import { type Component } from "solid-js";
import { t } from "../../i18n";
import { SettingSection } from "./controls";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const APP_VERSION = "0.1.7";
const APP_RELEASE_DATE = "2026-04";
const APP_REPO_URL = "https://github.com/zjok/mindzj";
const APP_ISSUE_URL = "https://github.com/zjok/mindzj/issues";
const APP_RELEASES_URL = "https://github.com/zjok/mindzj/releases";
const APP_DOCS_URL = "https://github.com/zjok/mindzj/tree/main/docs";
const DONATION_BMC_URL = "https://www.buymeacoffee.com/superjohn";
const DONATION_KOFI_URL = "https://ko-fi.com/superjohn";
const DONATION_PAYPAL_URL = "https://paypal.me/TanCat997";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function openExternalUrl(url: string) {
    try {
        const shell = await import("@tauri-apps/plugin-shell");
        await shell.open(url);
    } catch (e) {
        console.error("Failed to open external URL:", e);
    }
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const aboutRow = {
    display: "flex",
    "justify-content": "space-between",
    padding: "6px 0",
    "font-size": "var(--mz-font-size-sm)",
    color: "var(--mz-text-primary)",
};

// ---------------------------------------------------------------------------
// AboutLinkButton
// ---------------------------------------------------------------------------

export const AboutLinkButton: Component<{
    icon: string;
    label: string;
    onClick: () => void;
}> = (props) => (
    <button
        onClick={props.onClick}
        style={{
            display: "inline-flex",
            "align-items": "center",
            gap: "8px",
            padding: "8px 14px",
            background: "var(--mz-bg-tertiary)",
            border: "1px solid var(--mz-border)",
            "border-radius": "var(--mz-radius-md)",
            color: "var(--mz-text-primary)",
            cursor: "pointer",
            "font-size": "var(--mz-font-size-sm)",
            "font-family": "var(--mz-font-sans)",
        }}
        onMouseEnter={(e) => {
            e.currentTarget.style.background = "var(--mz-bg-hover)";
            e.currentTarget.style.borderColor = "var(--mz-accent)";
        }}
        onMouseLeave={(e) => {
            e.currentTarget.style.background = "var(--mz-bg-tertiary)";
            e.currentTarget.style.borderColor = "var(--mz-border)";
        }}>
        <span>{props.icon}</span>
        <span>{props.label}</span>
    </button>
);

// ---------------------------------------------------------------------------
// AboutPanel
// ---------------------------------------------------------------------------

export const AboutPanel: Component = () => {
    return (
        <div>
            {/* Hero card — logo, name, tagline, version */}
            <div
                style={{
                    display: "flex",
                    "flex-direction": "column",
                    "align-items": "center",
                    gap: "12px",
                    padding: "32px 24px",
                    background: "var(--mz-bg-secondary)",
                    border: "1px solid var(--mz-border)",
                    "border-radius": "var(--mz-radius-md)",
                    "margin-bottom": "24px",
                    "text-align": "center",
                }}>
                {/* Icon — the real 512×512 app icon from src-tauri/icons,
            copied into public/ at build-time so Vite can serve it.
            Rendered at a fixed 64×64 box per the design spec. */}
                <img
                    src="/mindzj-logo.png"
                    alt="MindZJ logo"
                    width="64"
                    height="64"
                    style={{
                        width: "64px",
                        height: "64px",
                        "border-radius": "12px",
                        "image-rendering": "auto",
                        "user-select": "none",
                        "-webkit-user-drag": "none",
                    }}
                />
                <h1
                    style={{
                        "font-size": "2em",
                        "font-weight": "800",
                        margin: "4px 0 0 0",
                        color: "var(--mz-text-primary)",
                        "letter-spacing": "0.5px",
                    }}>
                    MindZJ
                </h1>
                <div
                    style={{
                        "font-size": "var(--mz-font-size-sm)",
                        color: "var(--mz-text-muted)",
                    }}>
                    {t("common.version")} {APP_VERSION}
                </div>
                <div
                    style={{
                        "font-size": "var(--mz-font-size-sm)",
                        color: "var(--mz-text-muted)",
                    }}>
                    {t("common.author")}: SuperJohn
                </div>
                <p
                    style={{
                        "font-size": "var(--mz-font-size-base)",
                        color: "var(--mz-text-secondary)",
                        "line-height": "1.7",
                        "max-width": "520px",
                        margin: "8px 0 0 0",
                    }}>
                    {t("settings.aboutDescription")}
                </p>
                <div
                    style={{
                        "font-size": "var(--mz-font-size-sm)",
                        color: "var(--mz-accent)",
                        "font-weight": "600",
                        "margin-top": "4px",
                    }}>
                    {t("settings.aboutTagline")}
                </div>
                <button
                    onClick={() => void openExternalUrl(APP_REPO_URL)}
                    style={{
                        display: "inline-flex",
                        "align-items": "center",
                        gap: "8px",
                        padding: "8px 16px",
                        "margin-top": "8px",
                        background: "var(--mz-bg-tertiary)",
                        border: "1px solid var(--mz-border)",
                        "border-radius": "var(--mz-radius-md)",
                        color: "var(--mz-accent)",
                        cursor: "pointer",
                        "font-size": "var(--mz-font-size-sm)",
                        "font-weight": "600",
                        "font-family": "var(--mz-font-sans)",
                    }}
                    onMouseEnter={(e) => {
                        e.currentTarget.style.background = "var(--mz-bg-hover)";
                    }}
                    onMouseLeave={(e) => {
                        e.currentTarget.style.background =
                            "var(--mz-bg-tertiary)";
                    }}>
                    <span>📦</span>
                    <span>{t("settings.githubRepo")}</span>
                </button>
            </div>

            {/* Donation card */}
            <div
                style={{
                    display: "flex",
                    "flex-direction": "column",
                    "align-items": "center",
                    gap: "16px",
                    padding: "24px 24px 28px",
                    background: "var(--mz-bg-secondary)",
                    border: "1px solid var(--mz-border)",
                    "border-radius": "var(--mz-radius-md)",
                    "margin-bottom": "24px",
                }}>
                <div
                    style={{
                        "font-size": "1.05em",
                        "font-weight": "700",
                        color: "var(--mz-text-primary)",
                    }}>
                    ☕ {t("settings.support")}
                </div>
                <div
                    style={{
                        "font-size": "var(--mz-font-size-sm)",
                        color: "var(--mz-text-secondary)",
                        "text-align": "center",
                        "max-width": "520px",
                        "line-height": "1.6",
                    }}>
                    {t("settings.supportMessage")}
                </div>
                <div
                    style={{
                        display: "flex",
                        "flex-wrap": "wrap",
                        gap: "12px",
                        "justify-content": "center",
                    }}>
                    {/* Buy Me a Coffee */}
                    <button
                        onClick={() => void openExternalUrl(DONATION_BMC_URL)}
                        style={{
                            display: "inline-flex",
                            "align-items": "center",
                            gap: "8px",
                            padding: "10px 20px",
                            background: "#FFDD00",
                            color: "#000",
                            border: "none",
                            "border-radius": "8px",
                            cursor: "pointer",
                            "font-size": "var(--mz-font-size-sm)",
                            "font-weight": "700",
                            "font-family": "var(--mz-font-sans)",
                            "box-shadow": "0 2px 6px rgba(0,0,0,0.2)",
                        }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.transform =
                                "translateY(-1px)";
                            e.currentTarget.style.boxShadow =
                                "0 4px 10px rgba(0,0,0,0.25)";
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.transform = "translateY(0)";
                            e.currentTarget.style.boxShadow =
                                "0 2px 6px rgba(0,0,0,0.2)";
                        }}>
                        <span>☕</span>
                        <span>Buy Me a Coffee</span>
                    </button>

                    {/* Ko-fi */}
                    <button
                        onClick={() => void openExternalUrl(DONATION_KOFI_URL)}
                        style={{
                            display: "inline-flex",
                            "align-items": "center",
                            gap: "8px",
                            padding: "10px 20px",
                            background: "#FF5E5B",
                            color: "#fff",
                            border: "none",
                            "border-radius": "8px",
                            cursor: "pointer",
                            "font-size": "var(--mz-font-size-sm)",
                            "font-weight": "700",
                            "font-family": "var(--mz-font-sans)",
                            "box-shadow": "0 2px 6px rgba(0,0,0,0.2)",
                        }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.transform =
                                "translateY(-1px)";
                            e.currentTarget.style.boxShadow =
                                "0 4px 10px rgba(0,0,0,0.25)";
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.transform = "translateY(0)";
                            e.currentTarget.style.boxShadow =
                                "0 2px 6px rgba(0,0,0,0.2)";
                        }}>
                        <span>❤</span>
                        <span>Ko-fi</span>
                    </button>

                    {/* PayPal */}
                    <button
                        onClick={() =>
                            void openExternalUrl(DONATION_PAYPAL_URL)
                        }
                        style={{
                            display: "inline-flex",
                            "align-items": "center",
                            gap: "8px",
                            padding: "10px 20px",
                            background: "#0070ba",
                            color: "#fff",
                            border: "none",
                            "border-radius": "8px",
                            cursor: "pointer",
                            "font-size": "var(--mz-font-size-sm)",
                            "font-weight": "700",
                            "font-family": "var(--mz-font-sans)",
                            "box-shadow": "0 2px 6px rgba(0,0,0,0.2)",
                        }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.transform =
                                "translateY(-1px)";
                            e.currentTarget.style.boxShadow =
                                "0 4px 10px rgba(0,0,0,0.25)";
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.transform = "translateY(0)";
                            e.currentTarget.style.boxShadow =
                                "0 2px 6px rgba(0,0,0,0.2)";
                        }}>
                        <span>💰</span>
                        <span>PayPal</span>
                    </button>
                </div>
            </div>

            {/* Version info */}
            <SettingSection title={t("settings.versionInfo")}>
                <div style={aboutRow}>
                    <span style={{ color: "var(--mz-text-muted)" }}>
                        {t("common.version")}
                    </span>
                    <span>{APP_VERSION}</span>
                </div>
                <div style={aboutRow}>
                    <span style={{ color: "var(--mz-text-muted)" }}>
                        {t("settings.releaseDate")}
                    </span>
                    <span>{APP_RELEASE_DATE}</span>
                </div>
                <div style={aboutRow}>
                    <span style={{ color: "var(--mz-text-muted)" }}>
                        {t("settings.framework")}
                    </span>
                    <span>Tauri 2.0 + SolidJS</span>
                </div>
                <div style={aboutRow}>
                    <span style={{ color: "var(--mz-text-muted)" }}>
                        {t("settings.editorEngine")}
                    </span>
                    <span>CodeMirror 6</span>
                </div>
                <div style={aboutRow}>
                    <span style={{ color: "var(--mz-text-muted)" }}>
                        {t("settings.platform")}
                    </span>
                    <span>Windows · macOS · Linux · iOS · Android</span>
                </div>
                <div style={aboutRow}>
                    <span style={{ color: "var(--mz-text-muted)" }}>
                        {t("settings.license")}
                    </span>
                    <span>AGPL-3.0-or-later</span>
                </div>
                <div style={aboutRow}>
                    <span style={{ color: "var(--mz-text-muted)" }}>
                        {t("settings.developer")}
                    </span>
                    <span>SuperJohn</span>
                </div>
            </SettingSection>

            {/* Features */}
            <SettingSection title={t("settings.features")}>
                <ul
                    style={{
                        "list-style": "none",
                        padding: "0",
                        margin: "0",
                        display: "flex",
                        "flex-direction": "column",
                        gap: "6px",
                        "font-size": "var(--mz-font-size-sm)",
                        color: "var(--mz-text-secondary)",
                        "line-height": "1.6",
                    }}>
                    <li>• {t("settings.feature.local")}</li>
                    <li>• {t("settings.feature.ai")}</li>
                    <li>• {t("settings.feature.cli")}</li>
                    <li>• {t("settings.feature.sandbox")}</li>
                    <li>• {t("settings.feature.tauri")}</li>
                    <li>• {t("settings.feature.crossPlatform")}</li>
                </ul>
            </SettingSection>

            {/* Links */}
            <SettingSection title={t("settings.links")}>
                <div
                    style={{
                        display: "flex",
                        "flex-wrap": "wrap",
                        gap: "10px",
                        "padding-top": "4px",
                    }}>
                    <AboutLinkButton
                        icon="📦"
                        label={t("settings.githubRepo")}
                        onClick={() => void openExternalUrl(APP_REPO_URL)}
                    />
                    <AboutLinkButton
                        icon="📖"
                        label={t("settings.documentation")}
                        onClick={() => void openExternalUrl(APP_DOCS_URL)}
                    />
                    <AboutLinkButton
                        icon="🐛"
                        label={t("settings.reportIssue")}
                        onClick={() => void openExternalUrl(APP_ISSUE_URL)}
                    />
                    <AboutLinkButton
                        icon="✨"
                        label={t("settings.requestFeature")}
                        onClick={() => void openExternalUrl(APP_ISSUE_URL)}
                    />
                    <AboutLinkButton
                        icon="🔖"
                        label={t("settings.changelog")}
                        onClick={() => void openExternalUrl(APP_RELEASES_URL)}
                    />
                </div>
            </SettingSection>

            {/* Acknowledgements */}
            <SettingSection title={t("settings.thanks")}>
                <p
                    style={{
                        "font-size": "var(--mz-font-size-sm)",
                        color: "var(--mz-text-secondary)",
                        "line-height": "1.6",
                        margin: "0 0 12px 0",
                    }}>
                    {t("settings.thanksMessage")}
                </p>
                <div
                    style={{
                        "font-size": "var(--mz-font-size-xs)",
                        color: "var(--mz-text-muted)",
                    }}>
                    {t("settings.openSourceLibraries")}:{" "}
                    <span>
                        Tauri · SolidJS · CodeMirror · tantivy · KaTeX · Mermaid
                        · Shiki
                    </span>
                </div>
            </SettingSection>
        </div>
    );
};
