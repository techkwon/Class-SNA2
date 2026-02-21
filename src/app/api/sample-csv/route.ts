import { promises as fs } from "fs";
import path from "path";
import { NextResponse } from "next/server";

const FILE_NAME = "class-sna-sample-30.csv";

function buildContentDisposition(fileName: string): string {
    const encoded = encodeURIComponent(fileName);
    return `attachment; filename="${fileName}"; filename*=UTF-8''${encoded}`;
}

export async function GET() {
    try {
        const samplePath = path.join(process.cwd(), "public", "sample.csv");
        const csv = await fs.readFile(samplePath, "utf-8");

        return new NextResponse(`\uFEFF${csv}`, {
            status: 200,
            headers: {
                "Content-Type": "text/csv; charset=utf-8",
                "Content-Disposition": buildContentDisposition(FILE_NAME),
                "Cache-Control": "no-store",
                "X-Content-Type-Options": "nosniff",
            },
        });
    } catch {
        return NextResponse.json(
            { error: "샘플 CSV 파일을 찾을 수 없습니다." },
            { status: 404 }
        );
    }
}
