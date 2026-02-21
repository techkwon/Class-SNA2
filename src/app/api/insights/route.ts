import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI, SchemaType, type Schema } from "@google/generative-ai";

interface InsightRequestBody {
    nodes?: Array<{
        id: string;
        name: string;
        inDegree?: number;
        outDegree?: number;
        betweenness?: number;
        community?: number;
    }>;
    edges?: Array<{
        source: string;
        target: string;
        type?: string;
        weight?: number;
    }>;
}

function buildFallbackInsights(body: InsightRequestBody) {
    const nodes = Array.isArray(body.nodes) ? body.nodes : [];
    const topPopular = [...nodes]
        .sort((a, b) => (b.inDegree || 0) - (a.inDegree || 0))
        .slice(0, 5);
    const isolated = nodes.filter((n) => (n.inDegree || 0) === 0).map((n) => n.name);

    const studentInsights = nodes.map((node) => {
        const inD = node.inDegree || 0;
        const outD = node.outDegree || 0;
        const between = node.betweenness || 0;
        let riskLevel = "보통";
        let comment = "현재 관계망이 비교적 안정적입니다. 협력 활동에서 강점을 살릴 수 있습니다.";
        let action = "역할 분담형 모둠 활동에서 긍정적 상호작용을 강화하세요.";

        if (inD === 0) {
            riskLevel = "높음";
            comment = "지목 수신이 없어 고립 위험이 관찰됩니다. 의도적 연결 개입이 필요합니다.";
            action = "1주 1회 짝 활동과 멘토 학생 연결을 권장합니다.";
        } else if (between > 0.4) {
            riskLevel = "낮음";
            comment = "다른 집단을 잇는 교량 역할을 수행합니다. 갈등 완충 자원으로 활용 가능합니다.";
            action = "혼합 모둠 구성 시 연결 허브 역할을 부여하세요.";
        } else if (outD > inD * 1.5) {
            riskLevel = "보통";
            comment = "외향적 상호작용이 높지만 상호성 점검이 필요합니다.";
            action = "상호 지목 균형을 위한 피드백 활동을 운영하세요.";
        }

        return {
            name: node.name,
            riskLevel,
            comment,
            action,
        };
    });

    return {
        summary:
            "AI 심화 분석(로컬 대체): 중심성 분포를 기준으로 학급 관계 안정성과 개입 우선순위를 도출했습니다.",
        classRecommendations: [
            `인기도 상위 학생: ${topPopular.map((n) => n.name).join(", ") || "데이터 부족"}`,
            isolated.length
                ? `관심 필요 학생: ${isolated.join(", ")}`
                : "고립 위험 학생이 관찰되지 않았습니다.",
            "모둠 편성 시 그룹 간 연결 학생을 각 모둠에 분산 배치하세요.",
        ],
        studentInsights,
    };
}

export async function POST(req: NextRequest) {
    let body: InsightRequestBody = {};
    try {
        body = (await req.json()) as InsightRequestBody;
    } catch {
        return NextResponse.json({ error: "요청 본문(JSON)을 읽을 수 없습니다." }, { status: 400 });
    }

    const nodes = Array.isArray(body.nodes) ? body.nodes : [];
    const edges = Array.isArray(body.edges) ? body.edges : [];
    if (nodes.length === 0) {
        return NextResponse.json({ error: "학생 데이터가 비어 있습니다." }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === "YOUR_API_KEY_HERE") {
        return NextResponse.json(buildFallbackInsights(body));
    }

    const responseSchema: Schema = {
        type: SchemaType.OBJECT,
        properties: {
            summary: { type: SchemaType.STRING },
            classRecommendations: {
                type: SchemaType.ARRAY,
                items: { type: SchemaType.STRING },
            },
            studentInsights: {
                type: SchemaType.ARRAY,
                items: {
                    type: SchemaType.OBJECT,
                    properties: {
                        name: { type: SchemaType.STRING },
                        riskLevel: { type: SchemaType.STRING },
                        comment: { type: SchemaType.STRING },
                        action: { type: SchemaType.STRING },
                    },
                    required: ["name", "riskLevel", "comment", "action"],
                },
            },
        },
        required: ["summary", "classRecommendations", "studentInsights"],
    };

    const prompt = `\n다음은 학급 SNA 지표 데이터입니다.\n\n학생 노드(JSON):\n${JSON.stringify(nodes)}\n\n관계 엣지(JSON):\n${JSON.stringify(edges)}\n\n요구사항:\n1) summary: 학급 전체 관계 구조를 3~4문장으로 심화 분석.\n2) classRecommendations: 담임이 바로 실행할 수 있는 개입 전략 3개.\n3) studentInsights: 모든 학생에 대해 name, riskLevel(낮음/보통/높음), comment, action 작성.\n4) comment와 action은 구체적이고 실행 가능한 한국어 문장으로 작성.\n5) JSON만 출력.\n`;

    try {
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-pro" });
        const result = await model.generateContent({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: {
                responseMimeType: "application/json",
                responseSchema,
            },
        });

        const parsed = JSON.parse(result.response.text()) as {
            summary?: string;
            classRecommendations?: string[];
            studentInsights?: Array<{ name?: string; riskLevel?: string; comment?: string; action?: string }>;
        };

        const normalized = {
            summary: String(parsed.summary || "").trim() || "AI 심화 분석 요약을 생성하지 못했습니다.",
            classRecommendations: Array.isArray(parsed.classRecommendations)
                ? parsed.classRecommendations.map((v) => String(v || "").trim()).filter(Boolean).slice(0, 5)
                : [],
            studentInsights: Array.isArray(parsed.studentInsights)
                ? parsed.studentInsights
                      .map((item) => ({
                          name: String(item?.name || "").trim(),
                          riskLevel: String(item?.riskLevel || "보통").trim(),
                          comment: String(item?.comment || "").trim(),
                          action: String(item?.action || "").trim(),
                      }))
                      .filter((item) => item.name && item.comment)
                : [],
        };

        if (!normalized.classRecommendations.length || !normalized.studentInsights.length) {
            return NextResponse.json(buildFallbackInsights(body));
        }

        return NextResponse.json(normalized);
    } catch {
        return NextResponse.json(buildFallbackInsights(body));
    }
}
