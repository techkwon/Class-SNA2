"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2 } from "lucide-react";
import { type ParseResult } from "@/lib/parser";
import { analyzeNetwork } from "@/lib/analyzer";
import { StudentAnalysisTable } from "./StudentAnalysisTable";
import NetworkGraph from "../network/NetworkGraph";
import { StudentDetailDialog } from "./StudentDetailDialog";
import { type Edge, type Node } from "@/types/network";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { downloadExcelWorkbook } from "@/lib/excel";

const EXPORT_PROGRESS_SECONDS = 60;
const PRECISION_PROGRESS_SECONDS = 100;

function formatModelDisplayName(modelName?: string): string {
    if (!modelName) return "Gemini 3.0 Flash";
    const normalized = modelName.trim().toLowerCase();
    if (normalized.includes("3.1-pro")) return "Gemini 3.1 Pro";
    if (normalized.includes("2.5-pro")) return "Gemini 2.5 Pro";
    if (normalized.includes("3-flash")) return "Gemini 3.0 Flash";
    if (normalized.includes("flash")) return "Gemini 3.0 Flash";
    return modelName.replace(/-preview/gi, "").replace(/gemini-/gi, "Gemini ").trim();
}

interface AnalyzeApiPayload {
    students?: unknown[];
    relationships?: unknown[];
    metadata?: {
        model_used?: unknown;
        primary_model?: unknown;
        fallback_triggered?: unknown;
        quality_signals?: {
            respondent_count?: unknown;
            unknown_student_count?: unknown;
            student_count_ratio?: unknown;
        };
    };
}

function normalizeStudentNameKey(name: string): string {
    return name.trim().replace(/\s+/g, " ").toLowerCase();
}

function buildStableStudentId(name: string): string {
    let hash = 2166136261;
    for (const char of name) {
        hash ^= char.charCodeAt(0);
        hash = Math.imul(hash, 16777619);
    }
    return `STU_${(hash >>> 0).toString(36)}`;
}

function resolveStudentIds(canonicalNames: string[], previousNodes?: Node[]): Map<string, string> {
    const previousIdByName = new Map<string, string>();
    (previousNodes || []).forEach((node) => {
        previousIdByName.set(normalizeStudentNameKey(node.name), node.id);
    });

    const usedIds = new Set<string>();
    const nameToId = new Map<string, string>();
    canonicalNames.forEach((name) => {
        const key = normalizeStudentNameKey(name);
        const reusedId = previousIdByName.get(key);
        let candidateId = reusedId || buildStableStudentId(name);

        if (usedIds.has(candidateId)) {
            let suffix = 2;
            while (usedIds.has(`${candidateId}_${suffix}`)) suffix += 1;
            candidateId = `${candidateId}_${suffix}`;
        }

        usedIds.add(candidateId);
        nameToId.set(name, candidateId);
    });

    return nameToId;
}

function buildParseResultFromAnalyzePayload(
    payload: AnalyzeApiPayload,
    rawCsvData: string,
    previousNodes?: Node[]
): ParseResult {
    const relationships = Array.isArray(payload.relationships) ? payload.relationships : [];
    const students = Array.isArray(payload.students) ? payload.students : [];

    const canonicalEdges = relationships
        .map((rel) => {
            if (!rel || typeof rel !== "object") return null;
            const row = rel as {
                from?: unknown;
                to?: unknown;
                type?: unknown;
                weight?: unknown;
            };

            const source = String(row.from ?? "").trim();
            const target = String(row.to ?? "").trim();
            const type = String(row.type ?? "general").trim() || "general";
            const rawWeight = Number(row.weight);
            const weight = Number.isFinite(rawWeight) && rawWeight > 0 ? rawWeight : 1;

            if (!source || !target || source === target) return null;
            return { source, target, type, weight };
        })
        .filter((edge): edge is { source: string; target: string; type: string; weight: number } => edge !== null);

    const canonicalNameSet = new Set<string>();
    students.forEach((student) => {
        const name = String(student ?? "").trim();
        if (name) canonicalNameSet.add(name);
    });
    canonicalEdges.forEach((edge) => {
        canonicalNameSet.add(edge.source);
        canonicalNameSet.add(edge.target);
    });

    const canonicalNames = Array.from(canonicalNameSet);
    const nameToId = resolveStudentIds(canonicalNames, previousNodes);
    const nodes: Node[] = canonicalNames.map((name) => {
        const id = nameToId.get(name) || buildStableStudentId(name);
        return {
            id,
            name,
            label: name,
            group: 1,
        };
    });

    const edgeMap = new Map<string, Edge>();
    canonicalEdges.forEach((edge) => {
        const sourceId = nameToId.get(edge.source);
        const targetId = nameToId.get(edge.target);
        if (!sourceId || !targetId || sourceId === targetId) return;

        const key = `${sourceId}::${targetId}::${edge.type}`;
        const existing = edgeMap.get(key);
        if (existing) {
            existing.weight += edge.weight;
        } else {
            edgeMap.set(key, {
                source: sourceId,
                target: targetId,
                type: edge.type,
                weight: edge.weight,
            });
        }
    });

    const edges = Array.from(edgeMap.values());
    const analyzedData = analyzeNetwork(nodes, edges);
    const apiMetadata = payload.metadata ?? {};
    const qualitySignals = apiMetadata.quality_signals ?? {};

    return {
        nodes: analyzedData.nodes,
        edges: analyzedData.edges,
        metadata: {
            numStudents: analyzedData.nodes.length,
            numRelationships: analyzedData.edges.length,
            modelUsed: typeof apiMetadata.model_used === "string" ? apiMetadata.model_used : undefined,
            primaryModel: typeof apiMetadata.primary_model === "string" ? apiMetadata.primary_model : undefined,
            fallbackTriggered:
                typeof apiMetadata.fallback_triggered === "boolean" ? apiMetadata.fallback_triggered : undefined,
            qualitySignals: {
                respondentCount:
                    Number.isFinite(Number(qualitySignals.respondent_count))
                        ? Number(qualitySignals.respondent_count)
                        : undefined,
                unknownStudentCount:
                    Number.isFinite(Number(qualitySignals.unknown_student_count))
                        ? Number(qualitySignals.unknown_student_count)
                        : undefined,
                studentCountRatio:
                    Number.isFinite(Number(qualitySignals.student_count_ratio))
                        ? Number(qualitySignals.student_count_ratio)
                        : undefined,
            },
            rawCsvData,
        },
    };
}

interface DashboardProps {
    data: ParseResult;
    onReset: () => void;
    onReplaceData: (data: ParseResult) => void;
}

export default function Dashboard({ data, onReset, onReplaceData }: DashboardProps) {
    const [activeTab, setActiveTab] = useState<"student" | "network">("student");
    const [graphMode, setGraphMode] = useState<"2d" | "3d">("3d");
    const [selectedStudent, setSelectedStudent] = useState<Node | null>(null);

    const [isExporting, setIsExporting] = useState(false);
    const [exportElapsedSeconds, setExportElapsedSeconds] = useState(0);
    const [exportJobLabel, setExportJobLabel] = useState<string | null>(null);
    const exportAbortControllerRef = useRef<AbortController | null>(null);

    const [isPrecisionDialogOpen, setIsPrecisionDialogOpen] = useState(false);
    const [isPrecisionRunning, setIsPrecisionRunning] = useState(false);
    const [precisionElapsedSeconds, setPrecisionElapsedSeconds] = useState(0);
    const precisionAbortControllerRef = useRef<AbortController | null>(null);

    const { nodes, edges, metadata } = data;
    const exportProgress = Math.min(100, Math.round((exportElapsedSeconds / EXPORT_PROGRESS_SECONDS) * 100));
    const precisionProgress = Math.min(100, Math.round((precisionElapsedSeconds / PRECISION_PROGRESS_SECONDS) * 100));

    const usedModel = metadata.modelUsed || metadata.primaryModel || "gemini-3-flash-preview";
    const modelBadgeText = formatModelDisplayName(usedModel);
    const showFallbackBadge = metadata.fallbackTriggered === true;

    useEffect(() => {
        if (!isExporting) {
            setExportElapsedSeconds(0);
            return;
        }

        const timer = window.setInterval(() => {
            setExportElapsedSeconds((prev) => prev + 1);
        }, 1000);

        return () => window.clearInterval(timer);
    }, [isExporting]);

    useEffect(() => {
        if (!isPrecisionRunning) {
            setPrecisionElapsedSeconds(0);
            return;
        }

        const timer = window.setInterval(() => {
            setPrecisionElapsedSeconds((prev) => prev + 1);
        }, 1000);

        return () => window.clearInterval(timer);
    }, [isPrecisionRunning]);

    const topPopular = [...nodes].sort((a, b) => (b.inDegree || 0) - (a.inDegree || 0)).slice(0, 3);
    const topBridge = [...nodes].sort((a, b) => (b.betweenness || 0) - (a.betweenness || 0)).slice(0, 3);
    const isolatedStudents = nodes.filter((n) => (n.inDegree || 0) === 0);
    const lowReciprocityStudents = nodes
        .filter((n) => (n.outDegree || 0) > (n.inDegree || 0) * 1.6)
        .sort((a, b) => (b.outDegree || 0) - (a.outDegree || 0))
        .slice(0, 4);
    const communityCounts: Record<number, number> = {};
    nodes.forEach((n) => {
        const cId = n.community || 0;
        communityCounts[cId] = (communityCounts[cId] || 0) + 1;
    });

    const buildFallbackInsightMap = () => {
        const map = new Map<string, { riskLevel: string; comment: string; action: string }>();
        nodes.forEach((node) => {
            const inD = node.inDegree || 0;
            const outD = node.outDegree || 0;
            const between = node.betweenness || 0;
            let riskLevel = "보통";
            let comment = "관계망이 비교적 안정적이며 협업 상황에서 긍정적 역할이 기대됩니다.";
            let action = "모둠 활동에서 역할 순환 기회를 제공해 사회적 상호작용을 유지하세요.";

            if (inD === 0) {
                riskLevel = "높음";
                comment = "수신 지목이 없어 고립 위험이 높습니다. 또래 연결 개입이 필요합니다.";
                action = "주 1회 멘토-멘티 짝 활동을 운영하고, 긍정적 상호작용 과제를 부여하세요.";
            } else if (between > 0.4) {
                riskLevel = "낮음";
                comment = "집단 간 연결 허브 역할을 수행하며 갈등 완충 자원입니다.";
                action = "혼합 모둠 구성 시 연결자 역할을 명시해 협업 브리지를 강화하세요.";
            } else if (outD > inD * 1.5) {
                comment = "발신 활동성이 높아 주도성은 좋지만 상호성 균형 점검이 필요합니다.";
                action = "상호 피드백 활동으로 일방향 관계를 줄이고 상호 지목을 유도하세요.";
            }

            map.set(node.name, { riskLevel, comment, action });
        });

        return {
            summary: "AI 심화 분석(로컬 대체): 중심성 분포와 관계 밀도를 바탕으로 학생별 코칭 포인트를 정리했습니다.",
            classRecommendations: [
                "고립 위험 학생은 연결 허브 학생과 짝을 구성해 관계 진입 장벽을 낮추세요.",
                "모둠 재편 시 커뮤니티 간 브리지 학생을 분산 배치해 집단 고착을 줄이세요.",
                "활동성 대비 인기도가 낮은 학생에게 상호 피드백 과제를 부여해 관계 균형을 강화하세요.",
            ],
            studentMap: map,
        };
    };

    const fetchAiInsights = async (signal?: AbortSignal) => {
        try {
            const response = await fetch("/api/insights", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                signal,
                body: JSON.stringify({
                    nodes: nodes.map((n) => ({
                        id: n.id,
                        name: n.name,
                        inDegree: n.inDegree,
                        outDegree: n.outDegree,
                        betweenness: n.betweenness,
                        community: n.community,
                    })),
                    edges,
                }),
            });

            if (!response.ok) throw new Error("insights failed");
            const payload = (await response.json()) as {
                summary?: string;
                classRecommendations?: string[];
                studentInsights?: Array<{ name?: string; riskLevel?: string; comment?: string; action?: string }>;
            };

            const studentMap = new Map<string, { riskLevel: string; comment: string; action: string }>();
            (payload.studentInsights || []).forEach((item) => {
                const name = String(item?.name || "").trim();
                const comment = String(item?.comment || "").trim();
                if (!name || !comment) return;
                studentMap.set(name, {
                    riskLevel: String(item?.riskLevel || "보통").trim() || "보통",
                    comment,
                    action: String(item?.action || "").trim(),
                });
            });

            if (!studentMap.size) throw new Error("empty insights");
            return {
                summary: String(payload.summary || "").trim() || "AI 심화 분석 요약을 생성했습니다.",
                classRecommendations: Array.isArray(payload.classRecommendations)
                    ? payload.classRecommendations.map((v) => String(v || "").trim()).filter(Boolean)
                    : [],
                studentMap,
            };
        } catch (error) {
            if (error instanceof DOMException && error.name === "AbortError") {
                throw error;
            }
            return buildFallbackInsightMap();
        }
    };

    const beginExport = (jobLabel: string) => {
        exportAbortControllerRef.current = new AbortController();
        setExportJobLabel(jobLabel);
        setExportElapsedSeconds(0);
        setIsExporting(true);
    };

    const finishExport = () => {
        setIsExporting(false);
        setExportElapsedSeconds(0);
        setExportJobLabel(null);
        exportAbortControllerRef.current = null;
    };

    const cancelExport = () => {
        exportAbortControllerRef.current?.abort();
        finishExport();
    };

    const exportSummaryExcel = async () => {
        beginExport("분석표 엑셀");
        try {
            const signal = exportAbortControllerRef.current?.signal;
            const aiInsights = await fetchAiInsights(signal);
            const sorted = [...nodes].sort((a, b) => (b.inDegree || 0) - (a.inDegree || 0));
            const summaryRows = [
                ["순위", "이름", "그룹", "인기도(수신)", "활동성(발신)", "매개역할", "그룹내친밀도", "AI 위험도", "AI 심화 코멘트", "AI 실행 제안"],
                ...sorted.map((node, index) => [
                    index + 1,
                    node.name,
                    `그룹 ${node.community ?? "-"}`,
                    Number((node.inDegree || 0).toFixed(2)),
                    Number((node.outDegree || 0).toFixed(2)),
                    Number((node.betweenness || 0).toFixed(2)),
                    Number((node.eigenvector || 0).toFixed(3)),
                    aiInsights.studentMap.get(node.name)?.riskLevel || "보통",
                    aiInsights.studentMap.get(node.name)?.comment || "",
                    aiInsights.studentMap.get(node.name)?.action || "",
                ]),
            ];

            const aiRows: (string | number)[][] = [
                ["AI 심화 분석 요약", aiInsights.summary],
                [""],
                ["학급 개입 권장 전략", ""],
                ...aiInsights.classRecommendations.map((item, index) => [index + 1, item]),
            ];

            await downloadExcelWorkbook(
                `class-sna-summary-${new Date().toISOString().slice(0, 10)}.xlsx`,
                [
                    { name: "학생분석표", rows: summaryRows },
                    { name: "AI심화분석", rows: aiRows },
                ],
                signal
            );
        } catch (error) {
            if (!(error instanceof DOMException && error.name === "AbortError")) {
                console.error("요약 엑셀 생성 실패:", error);
            }
        } finally {
            finishExport();
        }
    };

    const exportStudentDetailExcel = async () => {
        beginExport("학생별 엑셀");
        try {
            const signal = exportAbortControllerRef.current?.signal;
            const aiInsights = await fetchAiInsights(signal);
            const idToName = new Map(nodes.map((n) => [n.id, n.name]));
            const sheets = nodes.map((student) => {
                const outgoing = edges
                    .filter((edge) => edge.source === student.id)
                    .map((edge) => [idToName.get(edge.target) || edge.target, edge.weight]);
                const incoming = edges
                    .filter((edge) => edge.target === student.id)
                    .map((edge) => [idToName.get(edge.source) || edge.source, edge.weight]);

                const rows: (string | number)[][] = [
                    ["항목", "값"],
                    ["이름", student.name],
                    ["그룹", `그룹 ${student.community ?? "-"}`],
                    ["인기도(수신)", Number((student.inDegree || 0).toFixed(2))],
                    ["활동성(발신)", Number((student.outDegree || 0).toFixed(2))],
                    ["매개역할", Number((student.betweenness || 0).toFixed(2))],
                    ["AI 위험도", aiInsights.studentMap.get(student.name)?.riskLevel || "보통"],
                    ["AI 심화 코멘트", aiInsights.studentMap.get(student.name)?.comment || ""],
                    ["AI 실행 제안", aiInsights.studentMap.get(student.name)?.action || ""],
                    [""],
                    ["내가 지목한 친구", "가중치"],
                    ...(outgoing.length ? outgoing : [["없음", 0]]),
                    [""],
                    ["나를 지목한 친구", "가중치"],
                    ...(incoming.length ? incoming : [["없음", 0]]),
                ];

                return { name: student.name, rows };
            });

            await downloadExcelWorkbook(
                `class-sna-students-${new Date().toISOString().slice(0, 10)}.xlsx`,
                sheets,
                signal
            );
        } catch (error) {
            if (!(error instanceof DOMException && error.name === "AbortError")) {
                console.error("학생별 엑셀 생성 실패:", error);
            }
        } finally {
            finishExport();
        }
    };

    const runPrecisionDiagnosis = async () => {
        if (!metadata.rawCsvData) return;

        setIsPrecisionDialogOpen(false);
        setIsPrecisionRunning(true);
        setPrecisionElapsedSeconds(0);
        const controller = new AbortController();
        precisionAbortControllerRef.current = controller;

        try {
            const response = await fetch("/api/analyze", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                signal: controller.signal,
                body: JSON.stringify({
                    csvData: metadata.rawCsvData,
                    model: "gemini-3.1-pro-preview",
                }),
            });

            if (!response.ok) {
                throw new Error("정밀 진단 요청 실패");
            }

            const payload = (await response.json()) as AnalyzeApiPayload;
            const next = buildParseResultFromAnalyzePayload(payload, metadata.rawCsvData, nodes);
            onReplaceData(next);
        } catch (error) {
            if (!(error instanceof DOMException && error.name === "AbortError")) {
                console.error("정밀 진단 실패:", error);
            }
        } finally {
            setIsPrecisionRunning(false);
            precisionAbortControllerRef.current = null;
        }
    };

    const cancelPrecisionDiagnosis = () => {
        precisionAbortControllerRef.current?.abort();
        setIsPrecisionRunning(false);
    };

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4 }}
            className="min-h-screen bg-background text-foreground flex flex-col"
        >
            <AnimatePresence>
                {isExporting && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-[120] bg-background/85 backdrop-blur-sm flex items-center justify-center p-4"
                    >
                        <motion.div
                            initial={{ y: 8, opacity: 0 }}
                            animate={{ y: 0, opacity: 1 }}
                            exit={{ y: 8, opacity: 0 }}
                            className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl"
                        >
                            <div className="flex items-center gap-3">
                                <Loader2 className="h-6 w-6 text-primary animate-spin" />
                                <div>
                                    <h4 className="text-base font-black">{exportJobLabel || "엑셀 파일"} 생성 중</h4>
                                    <p className="text-xs text-muted-foreground">잠시만 기다려 주세요.</p>
                                </div>
                            </div>
                            <p className="mt-4 text-sm text-muted-foreground">
                                엑셀 생성은 데이터 크기에 따라 1~2분 정도 걸릴 수 있습니다.
                            </p>
                            <div className="mt-4">
                                <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                                    <span>진행률</span>
                                    <span className="font-semibold text-foreground">{exportProgress}%</span>
                                </div>
                                <Progress value={exportProgress} className="h-2.5" />
                                <p className="mt-2 text-[11px] text-muted-foreground">
                                    진행률은 예상치이며 데이터량에 따라 완료 시점이 달라질 수 있습니다.
                                </p>
                            </div>
                            <div className="mt-4 flex justify-end">
                                <Button type="button" variant="outline" onClick={cancelExport}>
                                    취소
                                </Button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            <AnimatePresence>
                {isPrecisionRunning && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-[121] bg-background/88 backdrop-blur-sm flex items-center justify-center p-4"
                    >
                        <motion.div
                            initial={{ y: 8, opacity: 0 }}
                            animate={{ y: 0, opacity: 1 }}
                            exit={{ y: 8, opacity: 0 }}
                            className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl"
                        >
                            <div className="flex items-center gap-3">
                                <Loader2 className="h-6 w-6 text-accent animate-spin" />
                                <div>
                                    <h4 className="text-base font-black">정밀 진단 재분석 진행 중</h4>
                                    <p className="text-xs text-muted-foreground">Gemini 3.1 Pro 모델을 사용합니다.</p>
                                </div>
                            </div>
                            <p className="mt-4 text-sm text-muted-foreground">
                                정밀 진단은 시간이 더 걸릴 수 있습니다. 필요하면 중간에 취소할 수 있습니다.
                            </p>
                            <div className="mt-4">
                                <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                                    <span>정밀 진단 진행률</span>
                                    <span className="font-semibold text-foreground">{precisionProgress}%</span>
                                </div>
                                <Progress value={precisionProgress} className="h-2.5" />
                                <p className="mt-2 text-[11px] text-muted-foreground">
                                    진행률은 예상치이며 데이터량 및 응답 상태에 따라 달라질 수 있습니다.
                                </p>
                            </div>
                            <div className="mt-4 flex justify-end">
                                <Button type="button" variant="outline" onClick={cancelPrecisionDiagnosis}>
                                    취소
                                </Button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            <header className="sticky top-0 z-40 border-b border-border/80 bg-background/85 backdrop-blur px-4 sm:px-6 py-3">
                <div className="mx-auto max-w-7xl flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-3 min-w-0">
                        <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary text-primary-foreground shadow-lg shadow-primary/25">
                            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z" /><path d="M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" /><path d="M12 2v2" /><path d="M12 22v-2" /><path d="m17 20.66-1-1.73" /><path d="M11 5.07 10 3.34" /><path d="m20.66 17-1.73-1" /><path d="m3.34 10 1.73 1" /><path d="M14 12h8" /><path d="M2 12h2" /><path d="m20.66 7-1.73 1" /><path d="m3.34 14 1.73-1" /><path d="m17 3.34-1 1.73" /><path d="m11 18.93-1 1.73" /></svg>
                        </div>
                        <div className="min-w-0">
                            <h1 className="truncate text-base sm:text-lg font-black">Class-SNA 리포트</h1>
                            <p className="truncate text-xs text-muted-foreground">학급 교우관계 분석 결과</p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2 w-full sm:w-auto">
                        <motion.div
                            animate={{ opacity: [0.8, 1, 0.8] }}
                            transition={{ repeat: Infinity, duration: 2.2 }}
                            className="flex items-center gap-2"
                        >
                            <Badge variant="outline" className="border-primary/35 text-primary bg-primary/10">Live</Badge>
                            <button
                                type="button"
                                onClick={() => setIsPrecisionDialogOpen(true)}
                                disabled={!metadata.rawCsvData || isExporting || isPrecisionRunning}
                                className="inline-flex items-center rounded-full border border-accent/35 bg-accent/10 px-3 py-1 text-xs font-semibold text-accent hover:bg-accent/15 transition-colors disabled:opacity-45 disabled:cursor-not-allowed"
                                title="정밀 진단 재분석"
                            >
                                모델: {modelBadgeText}
                            </button>
                            {showFallbackBadge ? (
                                <Badge variant="outline" className="border-primary/35 text-primary bg-primary/10">
                                    Auto-Pro 보정
                                </Badge>
                            ) : null}
                        </motion.div>
                        <ThemeToggle />
                        <Button
                            onClick={exportSummaryExcel}
                            variant="outline"
                            disabled={isExporting || isPrecisionRunning}
                            className="flex-1 sm:flex-none rounded-xl border-primary/35 text-primary hover:bg-primary/10"
                        >
                            {isExporting ? "엑셀 생성중..." : "분석표 엑셀"}
                        </Button>
                        <Button
                            onClick={exportStudentDetailExcel}
                            variant="outline"
                            disabled={isExporting || isPrecisionRunning}
                            className="flex-1 sm:flex-none rounded-xl border-primary/35 text-primary hover:bg-primary/10"
                        >
                            {isExporting ? "엑셀 생성중..." : "학생별 엑셀"}
                        </Button>
                        <Button
                            onClick={onReset}
                            variant="outline"
                            disabled={isExporting || isPrecisionRunning}
                            className="flex-1 sm:flex-none rounded-xl border-accent/35 text-accent hover:bg-accent/10"
                        >
                            새 분석 시작
                        </Button>
                    </div>
                </div>
            </header>

            <main className="mx-auto w-full max-w-7xl p-4 sm:p-6 grid grid-cols-1 xl:grid-cols-[320px_minmax(0,1fr)] gap-4 sm:gap-6">
                <aside className="space-y-4">
                    <section className="rounded-2xl border border-border bg-card p-5">
                        <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-4">네트워크 요약</h3>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="rounded-xl border border-primary/25 bg-primary/10 px-4 py-3">
                                <p className="text-xs text-muted-foreground font-semibold">학생 수</p>
                                <p className="mt-1 text-2xl font-black text-primary">{metadata.numStudents}</p>
                            </div>
                            <div className="rounded-xl border border-accent/25 bg-accent/10 px-4 py-3">
                                <p className="text-xs text-muted-foreground font-semibold">관계 수</p>
                                <p className="mt-1 text-2xl font-black text-accent">{metadata.numRelationships}</p>
                            </div>
                        </div>
                    </section>

                    <section className="rounded-2xl border border-border bg-card p-5 space-y-5">
                        <div>
                            <h4 className="text-sm font-extrabold text-primary mb-2">인기도 상위</h4>
                            <ul className="space-y-2">
                                {topPopular.map((n) => (
                                    <li key={n.id} className="flex items-center justify-between rounded-lg border border-primary/20 bg-primary/5 px-3 py-2">
                                        <span className="text-sm font-semibold">{n.name}</span>
                                        <span className="text-xs font-mono text-primary">{(n.inDegree || 0).toFixed(2)}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>

                        <div>
                            <h4 className="text-sm font-extrabold text-accent mb-2">매개력 상위</h4>
                            <ul className="space-y-2">
                                {topBridge.map((n) => (
                                    <li key={n.id} className="flex items-center justify-between rounded-lg border border-accent/20 bg-accent/5 px-3 py-2">
                                        <span className="text-sm font-semibold">{n.name}</span>
                                        <span className="text-xs font-mono text-accent">{(n.betweenness || 0).toFixed(2)}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </section>

                    <section className="rounded-2xl border border-border bg-card p-5">
                        <h4 className="text-sm font-extrabold mb-3">코칭 포인트</h4>
                        <div className="space-y-3 text-sm text-muted-foreground">
                            {isolatedStudents.length > 0 ? (
                                <div className="rounded-xl border border-accent/30 bg-accent/10 p-3">
                                    <p className="font-semibold text-accent">관심 필요 학생</p>
                                    <p className="mt-1 leading-relaxed">{isolatedStudents.map((s) => s.name).join(", ")} 학생의 관계 확장을 위한 모둠 활동 개입이 필요합니다.</p>
                                </div>
                            ) : (
                                <div className="rounded-xl border border-primary/30 bg-primary/10 p-3">
                                    <p className="font-semibold text-primary">안정적 관계망</p>
                                    <p className="mt-1 leading-relaxed">고립 학생 없이 비교적 균형 있는 관계 구조입니다.</p>
                                </div>
                            )}
                            <div className="rounded-xl border border-primary/25 bg-primary/10 p-3">
                                <p className="font-semibold text-primary">학급 리더·브리지 배치 전략</p>
                                <p className="mt-1 leading-relaxed">
                                    리더 후보: {topPopular.map((s) => s.name).join(", ")}. 브리지 후보: {topBridge.map((s) => s.name).join(", ")}.
                                    모둠 재구성 시 각 모둠에 분산 배치하면 집단 간 소통 단절을 줄이고 협업 안정성을 높일 수 있습니다.
                                </p>
                            </div>
                            {lowReciprocityStudents.length > 0 ? (
                                <div className="rounded-xl border border-accent/25 bg-accent/10 p-3">
                                    <p className="font-semibold text-accent">상호성 보강 필요 학생</p>
                                    <p className="mt-1 leading-relaxed">
                                        {lowReciprocityStudents.map((s) => s.name).join(", ")} 학생은 활동성 대비 인기도가 낮아
                                        일방향 관계 가능성이 있습니다. 짝 피드백 과제와 교차 칭찬 활동으로 상호 지목을 유도하세요.
                                    </p>
                                </div>
                            ) : null}
                            <p>현재 소그룹 수: <span className="font-semibold text-foreground">{Object.keys(communityCounts).length}</span></p>
                        </div>
                    </section>
                </aside>

                <section className="relative rounded-2xl border border-border bg-card overflow-hidden flex flex-col min-w-0">
                    <motion.div
                        className="pointer-events-none absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-primary/70 to-transparent"
                        animate={{ x: ["-20%", "20%", "-20%"] }}
                        transition={{ repeat: Infinity, duration: 6.5, ease: "linear" }}
                    />
                    <Tabs
                        value={activeTab}
                        onValueChange={(value) => setActiveTab(value as "student" | "network")}
                        className="h-full"
                    >
                        <div className="border-b border-border bg-secondary/45 px-3 sm:px-4 py-2">
                            <TabsList className="bg-secondary/85 w-full sm:w-auto">
                                <TabsTrigger value="student" className="data-[state=active]:text-primary">학생 분석 표</TabsTrigger>
                                <TabsTrigger value="network" className="data-[state=active]:text-accent">3D 네트워크</TabsTrigger>
                            </TabsList>
                        </div>

                        <TabsContent value="student" className="p-4 sm:p-6 overflow-y-auto">
                            <motion.div
                                key="student"
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.25 }}
                            >
                                <h3 className="text-lg sm:text-xl font-black">학생 중심성 지표</h3>
                                <p className="text-sm text-muted-foreground mt-1 mb-4">학생 클릭 시 상세 팝업에서 인기도/활동성 막대를 확인할 수 있습니다.</p>
                                <StudentAnalysisTable nodes={nodes} onStudentClick={(n) => setSelectedStudent(n)} />
                            </motion.div>
                        </TabsContent>

                        <TabsContent value="network" className="p-4 sm:p-6 overflow-y-auto">
                            <motion.div
                                key="network"
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.25 }}
                                className="h-full"
                            >
                                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                                    <div>
                                        <h3 className="text-lg sm:text-xl font-black">{graphMode === "3d" ? "3D 네트워크 시각화" : "2D 네트워크 시각화"}</h3>
                                        <p className="text-sm text-muted-foreground mt-1">노드 크기는 그룹내 친밀도, 연결선 굵기는 인기도/활동성 지수를 반영합니다.</p>
                                    </div>
                                    <div className="inline-flex items-center rounded-xl border border-border bg-secondary/60 p-1">
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant={graphMode === "2d" ? "default" : "ghost"}
                                            onClick={() => setGraphMode("2d")}
                                            className="h-8 rounded-lg"
                                        >
                                            2D
                                        </Button>
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant={graphMode === "3d" ? "default" : "ghost"}
                                            onClick={() => setGraphMode("3d")}
                                            className="h-8 rounded-lg"
                                        >
                                            3D
                                        </Button>
                                    </div>
                                </div>
                                <div className="relative rounded-2xl border border-border overflow-hidden min-h-[430px] sm:min-h-[560px] bg-secondary/30">
                                    <motion.div
                                        className="pointer-events-none absolute -top-16 -left-12 h-52 w-52 rounded-full bg-primary/20 blur-3xl"
                                        animate={{ x: [0, 24, 0], y: [0, 14, 0] }}
                                        transition={{ repeat: Infinity, duration: 8, ease: "easeInOut" }}
                                    />
                                    <motion.div
                                        className="pointer-events-none absolute -bottom-20 -right-12 h-56 w-56 rounded-full bg-accent/20 blur-3xl"
                                        animate={{ x: [0, -24, 0], y: [0, -12, 0] }}
                                        transition={{ repeat: Infinity, duration: 8.5, ease: "easeInOut" }}
                                    />
                                    <NetworkGraph
                                        nodes={nodes}
                                        edges={edges}
                                        mode={graphMode}
                                        isActive={activeTab === "network"}
                                        onStudentClick={(n) => setSelectedStudent(n)}
                                    />
                                </div>
                            </motion.div>
                        </TabsContent>
                    </Tabs>
                </section>
            </main>

            <Dialog open={isPrecisionDialogOpen} onOpenChange={setIsPrecisionDialogOpen}>
                <DialogContent className="sm:max-w-[520px] bg-card border-border">
                    <DialogTitle className="text-foreground">정밀 진단 재분석</DialogTitle>
                    <DialogDescription className="text-muted-foreground">
                        현재 결과를 `Gemini 3.1 Pro` 모델로 다시 분석하시겠습니까?
                    </DialogDescription>
                    <div className="rounded-xl border border-border bg-secondary/40 p-4 text-sm text-muted-foreground">
                        더 높은 정규화 품질을 기대할 수 있지만 처리 시간이 더 길어질 수 있습니다.
                    </div>
                    <div className="flex justify-end gap-2">
                        <Button type="button" variant="outline" onClick={() => setIsPrecisionDialogOpen(false)}>
                            취소
                        </Button>
                        <Button
                            type="button"
                            onClick={runPrecisionDiagnosis}
                            disabled={!metadata.rawCsvData || isPrecisionRunning}
                            className="bg-accent text-accent-foreground hover:bg-accent/90"
                        >
                            정밀진단 실시
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>

            <StudentDetailDialog
                student={selectedStudent}
                data={data}
                isOpen={!!selectedStudent}
                onClose={() => setSelectedStudent(null)}
            />
        </motion.div>
    );
}
