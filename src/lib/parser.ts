import Papa from "papaparse";
import { type Edge, type Node } from "@/types/network";

export interface ParseResult {
  nodes: Node[];
  edges: Edge[];
  metadata: {
    numStudents: number;
    numRelationships: number;
    modelUsed?: string;
    primaryModel?: string;
    fallbackTriggered?: boolean;
    qualitySignals?: {
      respondentCount?: number;
      unknownStudentCount?: number;
      studentCountRatio?: number;
    };
    rawCsvData?: string;
  };
}

interface GeminiAnalyzeResponse {
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

/**
 * Basic CSV Processor.
 * Replaces the Python pandas + data_processor.py behavior.
 */
export async function processCsvData(file: File): Promise<ParseResult> {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        try {
          const data = results.data as Record<string, string>[];
          if (data.length === 0) {
            throw new Error("CSV 파일이 비어 있습니다.");
          }

          const columns = Object.keys(data[0]).map(k => k.trim());
          if (columns.length < 2) {
            throw new Error("최소 2개 이상의 열이 필요합니다.");
          }

          // 1. Find Respondent Column
          const respondentKeywords = ['이름', '학생', '응답자', '본인', 'name', 'student', 'respondent'];
          let respondentCol = columns.find(col =>
            respondentKeywords.some(keyword => col.toLowerCase().includes(keyword))
          );
          if (!respondentCol) respondentCol = columns[0]; // Fallback to first col

          // 2. Find Relationship Columns
          const excludeKeywords = ['timestamp', '타임스탬프', '제출', '시간', 'time'];
          const metadataKeywords = ['학년', '반', '성별', 'gender', 'grade', 'class'];
          const relationshipCols = columns.filter(col =>
            col !== respondentCol &&
            !excludeKeywords.some(keyword => col.toLowerCase().includes(keyword)) &&
            !metadataKeywords.some(keyword => col.toLowerCase().includes(keyword))
          );

          if (relationshipCols.length === 0) {
            throw new Error("관계 질문 열을 찾을 수 없습니다.");
          }

          // 3. Extract Nodes & Edges
          const nodeSet = new Set<string>();
          const rawEdges: { source: string; target: string; type: string; weight: number }[] = [];

          // Type Keywords Mapping
          const typeMap: Record<string, string> = {
            '친구': 'friendship',
            '좋아': 'preference',
            '협업': 'collaboration',
            '도움': 'help',
            '공부': 'study',
            '선택': 'selection',
            '함께': 'together',
            '소통': 'communication',
            '신뢰': 'trust'
          };

          const getRelType = (colName: string) => {
            const lowerCol = colName.toLowerCase();
            for (const [key, val] of Object.entries(typeMap)) {
              if (lowerCol.includes(key)) return val;
            }
            return 'general';
          };

          data.forEach((row) => {
            const sourceName = (row[respondentCol] || "").trim();
            if (!sourceName) return;
            nodeSet.add(sourceName);

            relationshipCols.forEach(col => {
              const relType = getRelType(col);
              const response = (row[col] || "").trim();
              if (!response) return;

              // Parse multiple targets (comma, semicolon, newline separated)
              const targets = response.split(/[,;\n]+/).map(t => t.trim()).filter(Boolean);

              targets.forEach(targetName => {
                if (targetName && targetName !== sourceName) {
                  nodeSet.add(targetName);
                  rawEdges.push({
                    source: sourceName,
                    target: targetName,
                    type: relType,
                    weight: 1
                  });
                }
              });
            });
          });

          // Create Nodes array
          const nodes: Node[] = Array.from(nodeSet).map((name) => ({
            id: name, // Using name as ID for simplicity
            name: name,
            label: name,
            group: 1
          }));

          // Merge duplicate edges
          const edgeMap = new Map<string, Edge>();
          rawEdges.forEach(re => {
            const key = `${re.source}-${re.target}-${re.type}`;
            if (edgeMap.has(key)) {
              const existing = edgeMap.get(key)!;
              existing.weight += re.weight;
            } else {
              edgeMap.set(key, { ...re });
            }
          });

          const edges = Array.from(edgeMap.values());

          resolve({
            nodes,
            edges,
            metadata: {
              numStudents: nodes.length,
              numRelationships: edges.length,
            }
          });
        } catch (err: unknown) {
          reject(err);
        }
      },
      error: (err) => {
        reject(err);
      }
    });
  });
}

/**
 * Intelligent CSV Processor using Gemini API.
 */
export async function processWithGemini(file: File): Promise<ParseResult> {
  const text = await file.text();
  const response = await fetch("/api/analyze", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ csvData: text }),
  });

  if (!response.ok) {
    const errorData = (await response.json().catch(() => null)) as
      | { error?: string; details?: string }
      | null;
    throw new Error(errorData?.error || "Gemini 분석 요청에 실패했습니다.");
  }

  const payload = (await response.json()) as GeminiAnalyzeResponse;
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

  const nameToId = new Map<string, string>();
  const nodes: Node[] = Array.from(canonicalNameSet).map((name) => {
    const id = `STU_${crypto.randomUUID()}`;
    nameToId.set(name, id);
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
  const metadata = payload.metadata ?? {};
  const qualitySignals = metadata.quality_signals ?? {};

  return {
    nodes,
    edges,
    metadata: {
      numStudents: nodes.length,
      numRelationships: edges.length,
      modelUsed: typeof metadata.model_used === "string" ? metadata.model_used : undefined,
      primaryModel: typeof metadata.primary_model === "string" ? metadata.primary_model : undefined,
      fallbackTriggered:
        typeof metadata.fallback_triggered === "boolean" ? metadata.fallback_triggered : undefined,
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
      rawCsvData: text,
    },
  };
}
