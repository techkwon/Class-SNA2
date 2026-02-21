import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI, SchemaType, type Schema } from "@google/generative-ai";
import Papa from "papaparse";

interface AnalyzeRequestBody {
    csvData?: string;
    model?: string;
}

interface AnalyzeRelationship {
    from: string;
    to: string;
    type: string;
    weight: number;
}

interface AnalyzeResult {
    students: string[];
    relationships: AnalyzeRelationship[];
    metadata: {
        question_types: Record<string, string>;
        normalization_notes: string[];
    };
}

interface CsvQualitySignals {
    respondentCount: number;
    rawNameSet: Set<string>;
}

interface QualityReport {
    unknownStudentCount: number;
    studentCountRatio: number;
}

function normalizeGeminiPayload(payload: unknown): AnalyzeResult {
    const obj = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};

    const students = Array.isArray(obj.students)
        ? obj.students.map((v) => String(v ?? "").trim()).filter(Boolean)
        : [];

    const relationships = Array.isArray(obj.relationships)
        ? obj.relationships
              .map((rel) => {
                  if (!rel || typeof rel !== "object") return null;
                  const row = rel as Record<string, unknown>;
                  const from = String(row.from ?? "").trim();
                  const to = String(row.to ?? "").trim();
                  const type = String(row.type ?? "general").trim() || "general";
                  const rawWeight = Number(row.weight);
                  const weight = Number.isFinite(rawWeight) && rawWeight > 0 ? rawWeight : 1;
                  if (!from || !to || from === to) return null;
                  return { from, to, type, weight };
              })
              .filter((edge): edge is AnalyzeRelationship => edge !== null)
        : [];

    const questionTypesRaw =
        obj.metadata && typeof obj.metadata === "object"
            ? (obj.metadata as Record<string, unknown>).question_types
            : undefined;

    const question_types: Record<string, string> = {};
    if (questionTypesRaw && typeof questionTypesRaw === "object") {
        Object.entries(questionTypesRaw as Record<string, unknown>).forEach(([key, value]) => {
            const k = String(key ?? "").trim();
            const v = String(value ?? "").trim();
            if (k && v) question_types[k] = v;
        });
    }

    const notesRaw =
        obj.metadata && typeof obj.metadata === "object"
            ? (obj.metadata as Record<string, unknown>).normalization_notes
            : undefined;

    const normalization_notes = Array.isArray(notesRaw)
        ? notesRaw.map((v) => String(v ?? "").trim()).filter(Boolean)
        : [];

    const studentSet = new Set(students);
    relationships.forEach((edge) => {
        studentSet.add(edge.from);
        studentSet.add(edge.to);
    });

    return {
        students: Array.from(studentSet),
        relationships,
        metadata: {
            question_types,
            normalization_notes,
        },
    };
}

function resolveGeminiModel(model?: string): string {
    const normalized = String(model ?? "").trim().toLowerCase();
    if (!normalized) return "gemini-3-flash-preview";

    const aliasMap: Record<string, string> = {
        pro: "gemini-2.5-pro",
        "2.5-pro": "gemini-2.5-pro",
        "gemini-2.5-pro": "gemini-2.5-pro",
        "3.1-pro": "gemini-3.1-pro-preview",
        "3.1-pro-preview": "gemini-3.1-pro-preview",
        "gemini-3.1-pro-preview": "gemini-3.1-pro-preview",
        "pro-preview": "gemini-3.1-pro-preview",
        "3.0-flash": "gemini-3-flash-preview",
        "3-flash": "gemini-3-flash-preview",
        flash: "gemini-3-flash-preview",
        "gemini-3-flash-preview": "gemini-3-flash-preview",
    };

    return aliasMap[normalized] || "gemini-3-flash-preview";
}

function parseCsvQualitySignals(csvData: string): CsvQualitySignals {
    const parsed = Papa.parse<Record<string, string>>(csvData, {
        header: true,
        skipEmptyLines: true,
    });
    const rows = Array.isArray(parsed.data) ? parsed.data : [];
    if (!rows.length) {
        return {
            respondentCount: 0,
            rawNameSet: new Set<string>(),
        };
    }

    const columns = Object.keys(rows[0] || {}).map((k) => k.trim());
    const respondentKeywords = ["이름", "학생", "응답자", "본인", "name", "student", "respondent"];
    let respondentCol = columns.find((col) =>
        respondentKeywords.some((keyword) => col.toLowerCase().includes(keyword))
    );
    if (!respondentCol) respondentCol = columns[0];

    const excludeKeywords = ["timestamp", "타임스탬프", "제출", "시간", "time"];
    const metadataKeywords = ["학년", "반", "성별", "gender", "grade", "class"];
    const relationCols = columns.filter(
        (col) =>
            col !== respondentCol &&
            !excludeKeywords.some((keyword) => col.toLowerCase().includes(keyword)) &&
            !metadataKeywords.some((keyword) => col.toLowerCase().includes(keyword))
    );

    const rawNameSet = new Set<string>();
    const respondentSet = new Set<string>();
    rows.forEach((row) => {
        const respondent = String(row[respondentCol] || "").trim();
        if (respondent) {
            respondentSet.add(respondent);
            rawNameSet.add(respondent);
        }

        relationCols.forEach((col) => {
            const value = String(row[col] || "").trim();
            if (!value) return;
            value
                .split(/[,;\n]+/)
                .map((name) => name.trim())
                .filter(Boolean)
                .forEach((name) => rawNameSet.add(name));
        });
    });

    return {
        respondentCount: respondentSet.size,
        rawNameSet,
    };
}

function evaluateQuality(result: AnalyzeResult, signals: CsvQualitySignals): QualityReport {
    const respondentCount = Math.max(signals.respondentCount, 1);
    const unknownStudentCount = result.students.filter((name) => !signals.rawNameSet.has(name)).length;
    const studentCountRatio = result.students.length / respondentCount;
    return {
        unknownStudentCount,
        studentCountRatio,
    };
}

function shouldFallbackToPro(report: QualityReport, respondentCount: number): boolean {
    const unknownLimit = Math.max(1, Math.round(respondentCount * 0.05));
    if (report.unknownStudentCount > unknownLimit) return true;
    if (report.studentCountRatio < 0.75) return true;
    if (report.studentCountRatio > 1.25) return true;
    return false;
}

export async function POST(req: NextRequest) {
    let csvData = "";
    let requestedModel = "";
    try {
        const body = (await req.json()) as AnalyzeRequestBody;
        csvData = typeof body?.csvData === "string" ? body.csvData : "";
        requestedModel = typeof body?.model === "string" ? body.model : "";
    } catch {
        return NextResponse.json(
            { error: "요청 본문(JSON)을 읽을 수 없습니다." },
            { status: 400 }
        );
    }

    if (!csvData.trim()) {
        return NextResponse.json(
            { error: "CSV 데이터가 제공되지 않았습니다." },
            { status: 400 }
        );
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === "YOUR_API_KEY_HERE") {
        return NextResponse.json(
            { error: "Gemini 정규화 분석이 필수입니다. GEMINI_API_KEY를 설정해주세요." },
            { status: 503 }
        );
    }

    try {
        const genAI = new GoogleGenerativeAI(apiKey);
        const requestedModelName = resolveGeminiModel(requestedModel);
        const preferFlashFirst = !requestedModel || requestedModelName === "gemini-3-flash-preview";
        const qualitySignals = parseCsvQualitySignals(csvData);

        const responseSchema: Schema = {
            type: SchemaType.OBJECT,
            properties: {
                students: {
                    type: SchemaType.ARRAY,
                    items: { type: SchemaType.STRING },
                    description: "정규화된 학생명 배열(중복 없음)",
                },
                relationships: {
                    type: SchemaType.ARRAY,
                    items: {
                        type: SchemaType.OBJECT,
                        properties: {
                            from: { type: SchemaType.STRING },
                            to: { type: SchemaType.STRING },
                            type: { type: SchemaType.STRING },
                            weight: { type: SchemaType.NUMBER },
                        },
                        required: ["from", "to", "type", "weight"],
                    },
                },
                metadata: {
                    type: SchemaType.OBJECT,
                    properties: {
                        question_types: {
                            type: SchemaType.OBJECT,
                            properties: {
                                example_column: { type: SchemaType.STRING },
                            },
                        },
                        normalization_notes: {
                            type: SchemaType.ARRAY,
                            items: { type: SchemaType.STRING },
                        },
                    },
                    required: ["question_types", "normalization_notes"],
                },
            },
            required: ["students", "relationships", "metadata"],
        };

        const prompt = `
당신은 학급 사회관계망(SNA) 데이터 정규화 엔진입니다.
CSV 설문 데이터를 분석해 관계 그래프용 JSON으로 변환하세요.

[핵심 목표]
- 학생 이름 표기 오류를 정규화합니다.
- 같은 학생의 서로 다른 표기(성 생략, 띄어쓰기, 오타, 유사 표기)를 하나의 canonical 이름으로 통합합니다.

[정규화 규칙]
1. 동일 인물 후보는 문맥과 빈도를 기준으로 하나로 합칩니다.
2. 성이 빠진 이름(예: "하늘")은 유일하게 매칭되는 전체 이름(예: "김하늘")으로 통합합니다.
3. 한글 오타/유사 표기(예: 받침 누락, 인접 자모 오타)는 가장 자연스러운 표준 이름으로 보정합니다.
4. 존재하지 않는 학생을 임의 생성하지 않습니다.
5. 확신이 낮으면 원문 표기를 유지하고 normalization_notes에 근거를 남깁니다.

[관계 추출 규칙]
1. 응답자 컬럼(예: 이름/학생/응답자)과 관계 질문 컬럼을 식별하세요.
2. 한 셀에 여러 명이 있으면 콤마/세미콜론/줄바꿈으로 분리해 개별 edge로 만드세요.
3. 관계 유형(type)은 질문 문구를 기반으로 friendship/collaboration/help/study/selection/together/preference/general 중 하나를 사용하세요.
4. weight는 기본 1로 하세요.
5. from/to는 반드시 canonical 이름을 사용하세요.

[출력 규칙]
- JSON만 출력합니다.
- students, relationships, metadata.question_types, metadata.normalization_notes를 반드시 채웁니다.

[CSV 데이터]
${csvData}
`;

        const runModel = async (modelName: string) => {
            const model = genAI.getGenerativeModel({ model: modelName });
            const result = await model.generateContent({
                contents: [{ role: "user", parts: [{ text: prompt }] }],
                generationConfig: {
                    responseMimeType: "application/json",
                    responseSchema,
                },
            });

            const responseText = result.response.text();
            const parsed = JSON.parse(responseText) as unknown;
            return normalizeGeminiPayload(parsed);
        };

        let primaryModel = requestedModelName;
        if (preferFlashFirst) primaryModel = "gemini-3-flash-preview";

        let normalized = await runModel(primaryModel);
        let usedModel = primaryModel;
        let fallbackTriggered = false;
        let qualityReport = evaluateQuality(normalized, qualitySignals);

        if (
            preferFlashFirst &&
            shouldFallbackToPro(qualityReport, qualitySignals.respondentCount)
        ) {
            normalized = await runModel("gemini-2.5-pro");
            usedModel = "gemini-2.5-pro";
            fallbackTriggered = true;
            qualityReport = evaluateQuality(normalized, qualitySignals);
        }

        return NextResponse.json({
            ...normalized,
            metadata: {
                ...normalized.metadata,
                model_used: usedModel,
                primary_model: primaryModel,
                fallback_triggered: fallbackTriggered,
                quality_signals: {
                    respondent_count: qualitySignals.respondentCount,
                    unknown_student_count: qualityReport.unknownStudentCount,
                    student_count_ratio: Number(qualityReport.studentCountRatio.toFixed(4)),
                },
            },
        });
    } catch (error: unknown) {
        console.error("Gemini 분석 중 오류 발생:", error);
        return NextResponse.json(
            {
                error: "AI 데이터 분석에 실패했습니다.",
                details: error instanceof Error ? error.message : String(error),
            },
            { status: 500 }
        );
    }
}
