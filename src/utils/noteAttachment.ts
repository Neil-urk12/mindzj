/**
 * Note attachment utilities — image paste and delete for the markdown editor.
 *
 * Extracted from Editor.tsx / config.ts to separate domain concerns
 * (file I/O for note attachments) from the editor component.
 */

import { EditorView } from "@codemirror/view";
import { invoke } from "@tauri-apps/api/core";
import {
    DEFAULT_ATTACHMENT_FOLDER,
    getParentPath,
    joinVaultPath,
    normalizeVaultRelativePath,
} from "./vaultPaths";

/**
 * Handle pasting an image into the editor.
 *
 * Receives a pre-extracted File blob and extension (obtained
 * synchronously from the paste event handler), resolves the storage
 * path, writes the file via Tauri, inserts a markdown image reference
 * at the cursor, and cleans up stray `<br>` tags that Windows WebView2
 * may inject alongside the paste.
 */
export async function pasteImage(params: {
    blob: Blob;
    ext: string;
    currentNotePath: string;
    attachmentFolder: string;
    editorView: EditorView;
}): Promise<void> {
    const {
        blob,
        ext,
        currentNotePath,
        attachmentFolder,
        editorView,
    } = params;

    const now = new Date();
    const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}`;
    const fileName = `Pasted image ${ts}.${ext}`;

    const configuredFolder = normalizeVaultRelativePath(
        attachmentFolder || DEFAULT_ATTACHMENT_FOLDER,
    );
    const isNoteRelativeFolder =
        configuredFolder.startsWith("./") ||
        configuredFolder.startsWith("../");
    const storageDir = isNoteRelativeFolder
        ? joinVaultPath(getParentPath(currentNotePath), configuredFolder)
        : configuredFolder;
    const filePath = joinVaultPath(storageDir, fileName);
    const markdownImagePath = isNoteRelativeFolder
        ? joinVaultPath(configuredFolder, fileName)
        : `/${filePath}`;

    if (blob.size === 0) {
        return;
    }
    // Read blob as base64 and save via Rust backend
    const reader = new FileReader();
    reader.onerror = () => {
        console.error("[pasteImage] FileReader error:", reader.error);
    };
    reader.onload = async () => {
        try {
            const dataUrl = reader.result as string;
            // Strip the data:image/...;base64, prefix
            const base64Data = dataUrl.split(",")[1];
            if (!base64Data) { return; }

            await invoke("write_binary_file", {
                relativePath: filePath,
                base64Data,
            });

            // Insert markdown image reference at cursor
            const pos = editorView.state.selection.main.head;
            const imageRef = `![](${markdownImagePath})`;
            editorView.dispatch({
                changes: {
                    from: pos,
                    insert: imageRef,
                },
                selection: {
                    anchor: pos + imageRef.length,
                },
            });

            // Windows clipboard often carries a CF_HTML
            // representation of the same screenshot alongside the
            // raw bitmap — typically `<img …><br>` with a trailing
            // <br> tag added by the Windows shell. Even though we
            // preventDefault the paste and take the image/png path,
            // some WebView2 releases still drop the HTML fragment
            // into the contenteditable, leaving a stray `<br>`
            // immediately after our inserted image reference.
            // Sweep it up so the user never sees it in the source
            // markdown.
            const afterPos = pos + imageRef.length;
            const afterState = editorView.state;
            if (afterPos <= afterState.doc.length) {
                const tailLen = Math.min(
                    16,
                    afterState.doc.length - afterPos,
                );
                if (tailLen > 0) {
                    const tail = afterState.doc.sliceString(
                        afterPos,
                        afterPos + tailLen,
                    );
                    const brMatch = tail.match(
                        /^\s*<br\s*\/?\s*>/i,
                    );
                    if (brMatch) {
                        editorView.dispatch({
                            changes: {
                                from: afterPos,
                                to: afterPos + brMatch[0].length,
                                insert: "",
                            },
                        });
                    }
                }
            }
        } catch (e) {
            console.error(
                "[Editor] Failed to save pasted image:",
                e,
            );
        }
    };
    reader.readAsDataURL(blob);
}

/**
 * Delete an image from the editor and from the vault filesystem.
 *
 * Finds and removes the markdown image syntax referencing `imageSrc` from
 * the document via CM6 transaction, then deletes the file via Tauri.
 * This is triggered by the image context menu's delete action.
 */
export function deleteImage(params: {
    imageSrc: string;
    imagePath: string;
    editorView: EditorView;
}): void {
    const { imageSrc, imagePath, editorView } = params;

    // Find and remove the markdown image syntax from the document
    const doc = editorView.state.doc.toString();
    // Match ![...](...) or ![[...]] patterns containing the image src
    const escapedSrc = imageSrc.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const patterns = [
        new RegExp(`!\\[[^\\]]*\\]\\(${escapedSrc}\\)\\n?`),
        new RegExp(`!\\[\\[${escapedSrc}\\]\\]\\n?`),
    ];

    let matchFrom = -1;
    let matchTo = -1;
    for (const re of patterns) {
        const m = doc.match(re);
        if (m && m.index !== undefined) {
            matchFrom = m.index;
            matchTo = m.index + m[0].length;
            break;
        }
    }

    if (matchFrom >= 0) {
        editorView.dispatch({
            changes: { from: matchFrom, to: matchTo, insert: "" },
        });
    }

    // Delete the image file from the vault
    invoke("delete_file", { relativePath: imagePath }).catch((err) => {
        console.error("[Editor] Failed to delete image file:", err);
    });
}
