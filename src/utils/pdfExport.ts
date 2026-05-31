export function ensurePdfExtension(path: string): string {
    return /\.pdf$/i.test(path) ? path : `${path}.pdf`;
}

export function waitForNextFrame(): Promise<void> {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

export async function waitForPdfExportAssets(root: HTMLElement): Promise<void> {
    const images = Array.from(root.querySelectorAll<HTMLImageElement>("img"));
    await Promise.all(
        images.map(
            (img) =>
                img.complete
                    ? Promise.resolve()
                    : new Promise<void>((resolve) => {
                          const done = () => resolve();
                          img.addEventListener("load", done, { once: true });
                          img.addEventListener("error", done, { once: true });
                      }),
        ),
    );
    try {
        await document.fonts?.ready;
    } catch (e) {
        console.warn('[PdfExport] fonts.ready failed:', e);
    }
    await waitForNextFrame();
}
