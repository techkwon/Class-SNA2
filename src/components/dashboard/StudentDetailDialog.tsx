import { type Node } from "@/types/network";
import { type ParseResult } from "@/lib/parser";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { User, Target, ArrowRight, ArrowLeft } from "lucide-react";

interface StudentDetailDialogProps {
    student: Node | null;
    data: ParseResult | null;
    isOpen: boolean;
    onClose: () => void;
}

function buildTeacherGuide(
    student: Node,
    stats: {
        maxInDeg: number;
        maxOutDeg: number;
        maxBetween: number;
        maxIntimacy: number;
    }
) {
    const inDeg = student.inDegree || 0;
    const outDeg = student.outDegree || 0;
    const between = student.betweenness || 0;
    const intimacy = student.eigenvector || 0;

    const popularityRatio = Math.min(inDeg / Math.max(stats.maxInDeg, 0.01), 1);
    const activityRatio = Math.min(outDeg / Math.max(stats.maxOutDeg, 0.01), 1);
    const bridgeRatio = Math.min(between / Math.max(stats.maxBetween, 0.01), 1);
    const intimacyRatio = Math.min(intimacy / Math.max(stats.maxIntimacy, 0.01), 1);

    let level: "관찰" | "주의" | "집중" = "관찰";
    if (inDeg === 0 || (popularityRatio < 0.15 && intimacyRatio < 0.2)) level = "집중";
    else if (activityRatio > 0.75 && popularityRatio < 0.35) level = "주의";

    const summary =
        level === "집중"
            ? "수신 관계가 매우 제한적이어서 의도적인 관계 개입이 필요한 상태입니다."
            : level === "주의"
                ? "활동성 대비 상호성 불균형이 있어 관계 피로 또는 일방향 상호작용 점검이 필요합니다."
                : "관계망이 비교적 안정적이며 역할 확장에 따른 성장 기회를 설계할 수 있는 상태입니다.";

    const strengths: string[] = [];
    if (popularityRatio >= 0.65) strengths.push("또래 신뢰도가 높아 학급 규칙 확산·또래 멘토 역할에 적합합니다.");
    if (bridgeRatio >= 0.6) strengths.push("집단 간 연결성이 높아 갈등 중재 또는 혼합 모둠 연결자 역할에 유리합니다.");
    if (intimacyRatio >= 0.6) strengths.push("그룹 내 친밀도가 높아 신규 학생 적응 지원 파트너로 배치하기 좋습니다.");
    if (!strengths.length) strengths.push("현재 관계망이 작지만 안정적이므로 소규모 성공경험 중심 개입이 효과적입니다.");

    const concernSignals: string[] = [];
    if (inDeg === 0) concernSignals.push("수신 지목 0건으로 고립 위험이 높습니다.");
    if (activityRatio > 0.75 && popularityRatio < 0.35) concernSignals.push("발신 활동성 대비 수신 인기도가 낮아 상호성 불균형이 보입니다.");
    if (activityRatio < 0.2) concernSignals.push("발신 활동성이 낮아 관계 시도 자체가 제한적입니다.");
    if (intimacyRatio < 0.2) concernSignals.push("그룹 내 친밀도 지수가 낮아 소속감 강화 활동이 필요합니다.");
    if (!concernSignals.length) concernSignals.push("뚜렷한 위험 신호는 낮으나 학기 중 관계 변화 추적이 필요합니다.");

    const actionPlan: string[] =
        level === "집중"
            ? [
                  "영향력 높은 학생 1명과 2주 고정 버디를 지정하고 매일 1회 협력 과제를 부여하세요.",
                  "수업 내 발언·피드백을 구조화(질문 카드, 순서 발언)해 관계 진입 장벽을 낮추세요.",
                  "좌석/모둠 재배치 시 브리지 학생과 같은 소그룹으로 배치해 자연 상호작용을 늘리세요.",
              ]
            : level === "주의"
                ? [
                      "상호 지목 과제를 적용해 일방향 지목을 양방향 상호작용으로 전환하세요.",
                      "팀 활동에서 역할을 교차 배정(발표↔기록↔조율)해 관계 균형을 맞추세요.",
                      "주간 체크인에서 긍정 피드백을 구조화해 수신 경험을 증가시키세요.",
                  ]
                : [
                      "리더·도우미·조율자 역할을 순환 배정해 관계 확장과 책임 경험을 동시에 제공합니다.",
                      "타 그룹 학생과의 협업 미션을 월 1~2회 설계해 관계망 폭을 넓히세요.",
                      "강점을 학급 전체에 기여하는 역할(멘토링, 중재, 안내)로 연결하세요.",
                  ];

    const monitoring: string[] = [
        "2주 단위로 수신 지목 수(인기도) 변화 추이를 기록하세요.",
        "한 달 내 상호 지목 학생 수(쌍방향 관계) 증가 여부를 확인하세요.",
        "모둠 활동 종료 후 또래 피드백에서 협력 경험 언급 빈도를 체크하세요.",
    ];

    return {
        level,
        summary,
        strengths,
        concernSignals,
        actionPlan,
        monitoring,
        popularityRatio,
        activityRatio,
    };
}

export function StudentDetailDialog({ student, data, isOpen, onClose }: StudentDetailDialogProps) {
    if (!student || !data) return null;

    const { edges, nodes } = data;

    const outgoingEdges = edges.filter((e) => e.source === student.id);
    const outgoingNames = outgoingEdges.map((e) => {
        const targetNode = nodes.find((n) => n.id === e.target);
        return { name: targetNode?.name || e.target, weight: e.weight };
    });

    const incomingEdges = edges.filter((e) => e.target === student.id);
    const incomingNames = incomingEdges.map((e) => {
        const sourceNode = nodes.find((n) => n.id === e.source);
        return { name: sourceNode?.name || e.source, weight: e.weight };
    });

    const inDeg = student.inDegree || 0;
    const outDeg = student.outDegree || 0;
    const between = student.betweenness || 0;
    const intimacy = student.eigenvector || 0;

    const maxInDeg = Math.max(...nodes.map((n) => n.inDegree || 0), 0.01);
    const maxOutDeg = Math.max(...nodes.map((n) => n.outDegree || 0), 0.01);
    const maxBetween = Math.max(...nodes.map((n) => n.betweenness || 0), 0.01);
    const maxIntimacy = Math.max(...nodes.map((n) => n.eigenvector || 0), 0.01);

    const guide = buildTeacherGuide(student, {
        maxInDeg,
        maxOutDeg,
        maxBetween,
        maxIntimacy,
    });

    const popularityBarWidth = `${Math.max(12, guide.popularityRatio * 100)}%`;
    const activityBarWidth = `${Math.max(12, guide.activityRatio * 100)}%`;
    const popularityBarThickness = `${(4 + guide.popularityRatio * 8).toFixed(1)}px`;
    const activityBarThickness = `${(4 + guide.activityRatio * 8).toFixed(1)}px`;

    const levelClass =
        guide.level === "집중"
            ? "text-accent border-accent/30 bg-accent/10"
            : guide.level === "주의"
                ? "text-accent border-accent/25 bg-accent/10"
                : "text-primary border-primary/25 bg-primary/10";

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="sm:max-w-[760px] max-h-[88vh] bg-card/95 backdrop-blur-xl border border-border shadow-xl overflow-hidden rounded-2xl p-0 flex flex-col">
                <div className="bg-secondary/55 px-6 py-5 border-b border-border flex items-center gap-4">
                    <div className="bg-primary/15 text-primary p-3 rounded-full shadow-inner">
                        <User size={28} strokeWidth={2.5} />
                    </div>
                    <div>
                        <DialogTitle className="text-2xl font-extrabold text-foreground flex items-center gap-2">
                            {student.name} 학생 심층 분석
                            <Badge variant="outline" className="bg-card border-border text-muted-foreground font-normal">
                                그룹 {student.community}
                            </Badge>
                        </DialogTitle>
                        <DialogDescription className="text-muted-foreground mt-1 font-medium">
                            담임교사용 관계 지표 해석 및 개입 가이드
                        </DialogDescription>
                    </div>
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto">
                    <div className="p-6 space-y-6">
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                            <div className="bg-secondary/55 p-4 rounded-xl border border-border flex flex-col items-center justify-center text-center">
                                <span className="text-muted-foreground text-xs font-bold uppercase tracking-wider mb-1">인기도 (수신)</span>
                                <span className="text-2xl font-black text-accent">{inDeg.toFixed(2)}</span>
                            </div>
                            <div className="bg-secondary/55 p-4 rounded-xl border border-border flex flex-col items-center justify-center text-center">
                                <span className="text-muted-foreground text-xs font-bold uppercase tracking-wider mb-1">활동성 (발신)</span>
                                <span className="text-2xl font-black text-primary">{outDeg.toFixed(2)}</span>
                            </div>
                            <div className="bg-secondary/55 p-4 rounded-xl border border-border flex flex-col items-center justify-center text-center">
                                <span className="text-muted-foreground text-xs font-bold uppercase tracking-wider mb-1">매개역할</span>
                                <span className="text-2xl font-black text-primary">{between.toFixed(2)}</span>
                            </div>
                            <div className="bg-secondary/55 p-4 rounded-xl border border-border flex flex-col items-center justify-center text-center">
                                <span className="text-muted-foreground text-xs font-bold uppercase tracking-wider mb-1">그룹내 친밀도</span>
                                <span className="text-2xl font-black text-primary">{intimacy.toFixed(3)}</span>
                            </div>
                        </div>

                        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
                            <h4 className="text-sm font-extrabold text-foreground mb-4">인기도·활동성 연결 막대</h4>
                            <div className="space-y-4">
                                <div>
                                    <div className="flex items-center justify-between text-xs font-bold text-muted-foreground mb-2">
                                        <span className="text-accent">인기도 연결막대</span>
                                        <span>{inDeg.toFixed(2)}</span>
                                    </div>
                                    <div className="h-5 rounded-full bg-accent/10 px-1.5 flex items-center">
                                        <div
                                            className="rounded-full bg-accent shadow-[0_0_0_1px_hsl(var(--accent)/0.15)]"
                                            style={{ width: popularityBarWidth, height: popularityBarThickness }}
                                        />
                                    </div>
                                </div>
                                <div>
                                    <div className="flex items-center justify-between text-xs font-bold text-muted-foreground mb-2">
                                        <span className="text-primary">활동성 연결막대</span>
                                        <span>{outDeg.toFixed(2)}</span>
                                    </div>
                                    <div className="h-5 rounded-full bg-primary/10 px-1.5 flex items-center">
                                        <div
                                            className="rounded-full bg-primary shadow-[0_0_0_1px_hsl(var(--primary)/0.15)]"
                                            style={{ width: activityBarWidth, height: activityBarThickness }}
                                        />
                                    </div>
                                </div>
                            </div>
                            <p className="text-[11px] text-muted-foreground mt-3">막대 길이/굵기는 학급 내 상대 수치(정규화)입니다.</p>
                        </div>

                        <div className={`p-5 rounded-xl border ${levelClass}`}>
                            <h4 className="font-extrabold text-base mb-2 flex items-center gap-2">
                                <Target size={16} /> 교사용 심화 코칭 요약 ({guide.level})
                            </h4>
                            <p className="text-sm leading-relaxed">{guide.summary}</p>
                            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="rounded-lg border border-border/60 bg-card/70 p-3">
                                    <p className="text-xs font-bold text-primary mb-2">강점 포인트</p>
                                    <ul className="space-y-1.5 text-sm text-foreground/90">
                                        {guide.strengths.map((item, idx) => (
                                            <li key={`strength-${idx}`}>- {item}</li>
                                        ))}
                                    </ul>
                                </div>
                                <div className="rounded-lg border border-border/60 bg-card/70 p-3">
                                    <p className="text-xs font-bold text-accent mb-2">주의 신호</p>
                                    <ul className="space-y-1.5 text-sm text-foreground/90">
                                        {guide.concernSignals.map((item, idx) => (
                                            <li key={`risk-${idx}`}>- {item}</li>
                                        ))}
                                    </ul>
                                </div>
                            </div>
                            <div className="mt-4 rounded-lg border border-border/60 bg-card/70 p-3">
                                <p className="text-xs font-bold text-primary mb-2">즉시 실행 개입안</p>
                                <ul className="space-y-1.5 text-sm text-foreground/90">
                                    {guide.actionPlan.map((item, idx) => (
                                        <li key={`action-${idx}`}>- {item}</li>
                                    ))}
                                </ul>
                            </div>
                            <div className="mt-3 rounded-lg border border-border/60 bg-card/70 p-3">
                                <p className="text-xs font-bold text-primary mb-2">추적 관찰 지표</p>
                                <ul className="space-y-1.5 text-sm text-foreground/90">
                                    {guide.monitoring.map((item, idx) => (
                                        <li key={`monitor-${idx}`}>- {item}</li>
                                    ))}
                                </ul>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                                <h4 className="font-bold text-primary flex items-center gap-2 mb-3 px-1">
                                    <ArrowRight size={16} className="text-primary" /> 활동성 연결 ({outgoingNames.length})
                                </h4>
                                <ScrollArea className="h-44 rounded-xl border border-primary/25 bg-primary/5 p-3">
                                    {outgoingNames.length > 0 ? (
                                        <ul className="space-y-2">
                                            {outgoingNames.map((n, i) => (
                                                <li key={i} className="flex justify-between items-center bg-card border border-primary/20 px-3 py-2 rounded-lg text-sm shadow-[0_2px_10px_hsl(var(--primary)/0.08)]">
                                                    <span className="font-bold text-primary">{n.name}</span>
                                                    <Badge variant="secondary" className="bg-primary/10 text-primary border-primary/20 font-mono">가중치 {n.weight}</Badge>
                                                </li>
                                            ))}
                                        </ul>
                                    ) : (
                                        <p className="text-muted-foreground text-sm italic text-center mt-14">지목한 친구가 없습니다.</p>
                                    )}
                                </ScrollArea>
                            </div>

                            <div>
                                <h4 className="font-bold text-accent flex items-center gap-2 mb-3 px-1">
                                    <ArrowLeft size={16} className="text-accent" /> 인기도 연결 ({incomingNames.length})
                                </h4>
                                <ScrollArea className="h-44 rounded-xl border border-accent/25 bg-accent/5 p-3">
                                    {incomingNames.length > 0 ? (
                                        <ul className="space-y-2">
                                            {incomingNames.map((n, i) => (
                                                <li key={i} className="flex justify-between items-center bg-card border border-accent/20 px-3 py-2 rounded-lg text-sm shadow-[0_2px_10px_hsl(var(--accent)/0.08)]">
                                                    <span className="font-bold text-accent">{n.name}</span>
                                                    <Badge variant="secondary" className="bg-accent/10 text-accent border-accent/20 font-mono">가중치 {n.weight}</Badge>
                                                </li>
                                            ))}
                                        </ul>
                                    ) : (
                                        <p className="text-muted-foreground text-sm italic text-center mt-14">지목받은 내역이 없습니다.</p>
                                    )}
                                </ScrollArea>
                            </div>
                        </div>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
