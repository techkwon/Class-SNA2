import { type Node } from "@/types/network";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

const COLORS = [
    "bg-primary/15 text-primary border-primary/35",
    "bg-accent/15 text-accent border-accent/35",
];

export function StudentAnalysisTable({ nodes, onStudentClick }: { nodes: Node[], onStudentClick: (node: Node) => void }) {
    // Sort by In-Degree (Popularity) descending by default
    const sortedNodes = [...nodes].sort((a, b) => (b.inDegree || 0) - (a.inDegree || 0));

    return (
        <div className="rounded-xl border border-border bg-card overflow-x-auto shadow-sm">
            <Table>
                <TableHeader className="bg-secondary/60">
                    <TableRow>
                        <TableHead className="w-[70px]">순위</TableHead>
                        <TableHead>이름</TableHead>
                        <TableHead>그룹명</TableHead>
                        <TableHead className="text-right">인기도 (수신)</TableHead>
                        <TableHead className="text-right">활동성 (발신)</TableHead>
                        <TableHead className="text-right">매개 역할</TableHead>
                        <TableHead className="text-right">그룹 내 친밀도</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {sortedNodes.map((node, i) => {
                        const commColor = COLORS[(node.community || 0) % COLORS.length];
                        return (
                            <TableRow key={node.id} className="hover:bg-secondary/30">
                                <TableCell className="font-medium text-muted-foreground">{i + 1}</TableCell>
                                <TableCell>
                                    <button
                                        onClick={() => onStudentClick(node)}
                                        className="font-bold text-primary hover:text-accent hover:underline transition-colors text-left"
                                    >
                                        {node.name}
                                    </button>
                                </TableCell>
                                <TableCell>
                                    <Badge variant="outline" className={`${commColor}`}>
                                        그룹 {node.community}
                                    </Badge>
                                </TableCell>
                                <TableCell className="text-right">{((node.inDegree || 0)).toFixed(2)}</TableCell>
                                <TableCell className="text-right">{((node.outDegree || 0)).toFixed(2)}</TableCell>
                                <TableCell className="text-right">{((node.betweenness || 0)).toFixed(2)}</TableCell>
                                <TableCell className="text-right">{((node.eigenvector || 0)).toFixed(3)}</TableCell>
                            </TableRow>
                        );
                    })}
                </TableBody>
            </Table>
        </div>
    );
}
