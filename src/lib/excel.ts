export type ExcelCell = string | number | boolean | null | undefined;

export interface ExcelSheet {
    name: string;
    rows: ExcelCell[][];
}

function sanitizeClientFileName(fileName: string): string {
    const fallback = "class-sna-export.xlsx";
    const cleaned = fileName.replace(/[^a-zA-Z0-9._-]/g, "").trim();
    if (!cleaned) return fallback;
    return cleaned.endsWith(".xlsx") ? cleaned : `${cleaned}.xlsx`;
}

export async function downloadExcelWorkbook(
    fileName: string,
    sheets: ExcelSheet[],
    signal?: AbortSignal
) {
    const safeFileName = sanitizeClientFileName(fileName);
    const formData = new FormData();
    formData.set(
        "payload",
        JSON.stringify({
            fileName: safeFileName,
            sheets,
        })
    );

    const response = await fetch("/api/export-excel", {
        method: "POST",
        body: formData,
        signal,
    });

    if (!response.ok) {
        throw new Error("엑셀 파일 생성 요청에 실패했습니다.");
    }

    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = blobUrl;
    anchor.download = safeFileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(blobUrl);
}
