import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";

type ExcelCell = string | number | boolean | null | undefined;

interface ExcelSheet {
    name: string;
    rows: ExcelCell[][];
}

interface ExportPayload {
    fileName?: string;
    sheets?: ExcelSheet[];
}

function sanitizeSheetName(name: string, fallback: string): string {
    const cleaned = name.replace(/[\\/:*?\[\]]/g, "").trim();
    if (!cleaned) return fallback;
    return cleaned.slice(0, 31);
}

function sanitizeDownloadFileName(fileName?: string): string {
    const fallback = "class-sna-export.xlsx";
    if (!fileName) return fallback;
    const cleaned = fileName.replace(/[^a-zA-Z0-9._-]/g, "").trim();
    if (!cleaned) return fallback;
    return cleaned.endsWith(".xlsx") ? cleaned : `${cleaned}.xlsx`;
}

function buildContentDisposition(fileName: string): string {
    const encoded = encodeURIComponent(fileName);
    return `attachment; filename="${fileName}"; filename*=UTF-8''${encoded}`;
}

export async function POST(req: NextRequest) {
    try {
        const formData = await req.formData();
        const rawPayload = formData.get("payload");
        if (typeof rawPayload !== "string" || !rawPayload.trim()) {
            return NextResponse.json({ error: "엑셀 내보내기 요청이 비어 있습니다." }, { status: 400 });
        }

        const parsed = JSON.parse(rawPayload) as ExportPayload;
        const sheets = Array.isArray(parsed.sheets) ? parsed.sheets : [];
        if (sheets.length === 0) {
            return NextResponse.json({ error: "내보낼 시트 데이터가 없습니다." }, { status: 400 });
        }

        const workbook = XLSX.utils.book_new();
        sheets.forEach((sheet, index) => {
            const sheetName = sanitizeSheetName(sheet.name, `Sheet${index + 1}`);
            const rows = Array.isArray(sheet.rows) ? sheet.rows : [];
            const worksheet = XLSX.utils.aoa_to_sheet(rows);
            XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
        });

        const xlsxArray = XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
        const xlsxBuffer = new Uint8Array(xlsxArray);
        const fileName = sanitizeDownloadFileName(parsed.fileName);

        return new NextResponse(xlsxBuffer, {
            status: 200,
            headers: {
                "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "Content-Disposition": buildContentDisposition(fileName),
                "Cache-Control": "no-store",
                "X-Content-Type-Options": "nosniff",
            },
        });
    } catch {
        return NextResponse.json({ error: "엑셀 파일 생성에 실패했습니다." }, { status: 500 });
    }
}
