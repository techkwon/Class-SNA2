"use client";

import { useEffect, useState } from "react";
import { UploadCloud, Loader2, Sparkles, ShieldCheck } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { processWithGemini, type ParseResult } from "../../lib/parser";
import { analyzeNetwork } from "../../lib/analyzer";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../ui/dialog";
import { Progress } from "../ui/progress";

const GOOGLE_FORM_REFERENCE_URL = "https://docs.google.com/forms/d/1OOpDNUMp3GIooYb0PgvTUHpMJqfHxY7fMGNRAM_Xez8/copy";
const SAMPLE_CSV_DOWNLOAD_URL = "/api/sample-csv";
const ANALYSIS_PROGRESS_SECONDS = 60;

export function UploadPage({ onAnalysisComplete }: { onAnalysisComplete: (data: ParseResult) => void }) {
    const [isProcessing, setIsProcessing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isPrivacyOpen, setIsPrivacyOpen] = useState(false);
    const [remainingSeconds, setRemainingSeconds] = useState(ANALYSIS_PROGRESS_SECONDS);

    useEffect(() => {
        if (!isProcessing) return;

        const timer = window.setInterval(() => {
            setRemainingSeconds((prev) => Math.max(prev - 1, 0));
        }, 1000);

        return () => window.clearInterval(timer);
    }, [isProcessing]);

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setRemainingSeconds(ANALYSIS_PROGRESS_SECONDS);
        setIsProcessing(true);
        setError(null);

        try {
            const result = await processWithGemini(file);
            const analyzedData = analyzeNetwork(result.nodes, result.edges);

            onAnalysisComplete({
                nodes: analyzedData.nodes,
                edges: analyzedData.edges,
                metadata: {
                    ...result.metadata,
                    numStudents: analyzedData.nodes.length,
                    numRelationships: analyzedData.edges.length,
                },
            });
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : "알 수 없는 오류가 발생했습니다.";
            setError(message);
        } finally {
            setIsProcessing(false);
        }
    };

    const handleSampleDownload = () => {
        window.location.href = SAMPLE_CSV_DOWNLOAD_URL;
    };

    const progressValue = Math.min(
        100,
        Math.round(((ANALYSIS_PROGRESS_SECONDS - remainingSeconds) / ANALYSIS_PROGRESS_SECONDS) * 100)
    );

    return (
        <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: "easeOut" }}
            className="w-full max-w-6xl grid lg:grid-cols-2 gap-5 sm:gap-6 relative"
        >
            <motion.div
                className="pointer-events-none absolute -top-10 left-8 h-28 w-28 rounded-full bg-primary/20 blur-2xl"
                animate={{ x: [0, 18, 0], y: [0, 10, 0], opacity: [0.5, 0.75, 0.5] }}
                transition={{ repeat: Infinity, duration: 7.5, ease: "easeInOut" }}
            />
            <motion.div
                className="pointer-events-none absolute -bottom-12 right-10 h-36 w-36 rounded-full bg-accent/20 blur-3xl"
                animate={{ x: [0, -22, 0], y: [0, -14, 0], opacity: [0.45, 0.72, 0.45] }}
                transition={{ repeat: Infinity, duration: 8.7, ease: "easeInOut" }}
            />
            <motion.section
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.4, delay: 0.05 }}
                className="rounded-3xl border border-border bg-card/85 backdrop-blur p-5 sm:p-7"
            >
                <div className="flex flex-wrap items-center gap-2">
                    <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                        <Sparkles className="h-3.5 w-3.5" />
                        교우관계 인사이트 리포트
                    </div>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setIsPrivacyOpen(true)}
                        className="h-7 rounded-full border-accent/35 text-accent hover:bg-accent/10"
                    >
                        <ShieldCheck className="h-3.5 w-3.5" />
                        개인정보보호
                    </Button>
                </div>
                <h2 className="mt-4 text-2xl sm:text-4xl font-black tracking-tight text-foreground leading-tight">
                    우리 반 교우관계
                    <br />
                    <span className="text-accent">네트워크 분석</span>
                </h2>
                <p className="mt-4 text-sm sm:text-base text-muted-foreground leading-relaxed">
                    설문 CSV를 올리면 학생 간 관계를 자동 파싱하고, 중심성 지표와 3D 네트워크로 시각화합니다.
                </p>

                <div className="mt-6 rounded-2xl border border-border bg-secondary/50 p-4 sm:p-5">
                    <h4 className="text-sm font-extrabold text-foreground mb-3">사용 순서</h4>
                    <ol className="space-y-2.5 text-sm text-muted-foreground">
                        <li>
                            1.{" "}
                            <a
                                href={GOOGLE_FORM_REFERENCE_URL}
                                target="_blank"
                                rel="noreferrer noopener"
                                className="font-semibold text-primary underline underline-offset-4 hover:text-accent transition-colors"
                            >
                                구글 설문
                            </a>
                            {" "}링크에서 응답 파일을 복사해 사용합니다.
                        </li>
                        <li>2. 업로드 후 AI 분석이 완료될 때까지 기다립니다.</li>
                        <li>3. 대시보드에서 인기도/활동성/관계망을 확인합니다.</li>
                    </ol>
                </div>
            </motion.section>

            <motion.section
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.4, delay: 0.1 }}
                className="flex items-stretch"
            >
                <Card className="w-full rounded-3xl border-border bg-card shadow-xl relative overflow-hidden">
                    <motion.div
                        className="pointer-events-none absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-primary/80 to-transparent"
                        animate={{ x: ["-18%", "18%", "-18%"] }}
                        transition={{ repeat: Infinity, duration: 6.2, ease: "linear" }}
                    />
                    <AnimatePresence>
                        {isProcessing && (
                            <motion.div
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                className="absolute inset-0 z-20 bg-background/95 backdrop-blur flex flex-col items-center justify-center p-6 text-center"
                            >
                                <Loader2 className="h-10 w-10 text-primary animate-spin mb-4" />
                                <h3 className="text-base sm:text-lg font-bold text-foreground">데이터 분석 진행 중...</h3>
                                <p className="text-sm text-muted-foreground mt-2">잠시만 기다려 주세요. 분석은 보통 1~2분 정도 소요됩니다.</p>
                                <div className="mt-4 w-full max-w-sm">
                                    <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                                        <span>진행률</span>
                                        <span className="font-semibold text-foreground">
                                            {progressValue}%
                                        </span>
                                    </div>
                                    <Progress value={progressValue} className="h-2.5" />
                                    <p className="mt-2 text-[11px] text-muted-foreground">
                                        진행률은 예상치이며 데이터량에 따라 완료 시점이 달라질 수 있습니다.
                                    </p>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>

                    <CardHeader className="border-b border-border bg-secondary/35 px-5 sm:px-7 py-5">
                        <CardTitle className="text-lg font-black text-foreground">파일 업로드</CardTitle>
                        <CardDescription>CSV 설문 파일을 선택해 분석을 시작합니다.</CardDescription>
                    </CardHeader>

                    <CardContent className="p-5 sm:p-7">
                        <motion.div
                            whileHover={{ scale: 1.01 }}
                            whileTap={{ scale: 0.995 }}
                            className="rounded-2xl border-2 border-dashed border-primary/25 hover:border-primary/55 bg-primary/5 transition-colors p-6 sm:p-8 cursor-pointer"
                            onClick={() => document.getElementById("csv-upload")?.click()}
                        >
                            <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-primary/15 text-primary">
                                <UploadCloud className="h-7 w-7" />
                            </div>
                            <p className="text-center font-bold text-foreground">파일 선택 또는 드래그 앤 드롭</p>
                            <p className="text-center text-sm text-muted-foreground mt-2">`.csv` 파일만 업로드할 수 있습니다.</p>

                            <input
                                id="csv-upload"
                                type="file"
                                accept=".csv"
                                className="hidden"
                                onChange={handleFileUpload}
                                disabled={isProcessing}
                            />

                            <div className="mt-6 grid gap-2.5 sm:grid-cols-2" onClick={(e) => e.stopPropagation()}>
                                <Button
                                    onClick={() => document.getElementById("csv-upload")?.click()}
                                    disabled={isProcessing}
                                    className="w-full rounded-xl bg-primary text-primary-foreground hover:bg-primary/90"
                                    size="lg"
                                >
                                    파일 업로드
                                </Button>
                                <Button
                                    variant="outline"
                                    onClick={handleSampleDownload}
                                    disabled={isProcessing}
                                    className="w-full rounded-xl border-accent/40 text-accent hover:bg-accent/10"
                                    size="lg"
                                >
                                    샘플 CSV 다운로드
                                </Button>
                            </div>
                            <p className="mt-2 text-xs text-muted-foreground text-center">샘플 파일은 30명 데이터로 기능 검증용으로 제공됩니다.</p>
                        </motion.div>

                        <AnimatePresence>
                            {error && (
                                <motion.div
                                    initial={{ opacity: 0, y: -8 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -8 }}
                                    className="mt-4 rounded-xl border border-accent/30 bg-accent/10 px-4 py-3 text-sm font-semibold text-accent"
                                >
                                    {error}
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </CardContent>
                </Card>
            </motion.section>

            <Dialog open={isPrivacyOpen} onOpenChange={setIsPrivacyOpen}>
                <DialogContent className="sm:max-w-[560px] bg-card border-border">
                    <DialogTitle className="flex items-center gap-2 text-foreground">
                        <ShieldCheck className="h-5 w-5 text-primary" />
                        개인정보 보호 안내
                    </DialogTitle>
                    <DialogDescription className="text-muted-foreground">
                        우리 사이트는 학생 실명 보호를 위해 업로드 직후 익명화 과정을 거칩니다.
                    </DialogDescription>
                    <div className="space-y-2 text-sm text-foreground">
                        <p>1. 설문 데이터는 Gemini API 정규화 단계에서 이름 오타/성 생략을 보정합니다.</p>
                        <p>2. 정규화 완료 후 브라우저 내부 그래프 계산은 UUID 기반 ID로 처리됩니다.</p>
                        <p>3. 화면/엑셀에는 보정된 실제 학생명만 복원해 표시됩니다.</p>
                        <p>4. 서버에는 영구 저장 로직이 없고 분석 요청 단위로만 처리됩니다.</p>
                        <p>5. `GEMINI_API_KEY`가 없으면 분석을 진행하지 않고 오류를 반환합니다.</p>
                    </div>
                </DialogContent>
            </Dialog>
        </motion.div>
    );
}
