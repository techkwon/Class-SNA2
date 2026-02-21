import fs from "fs";
import Papa from "papaparse";
import { performance } from "perf_hooks";

function readApiKey() {
  const envText = fs.readFileSync(".env.local", "utf8");
  const line = envText.split(/\r?\n/).find((l) => l.startsWith("GEMINI_API_KEY="));
  if (!line) throw new Error("GEMINI_API_KEY not found in .env.local");
  const key = line.slice("GEMINI_API_KEY=".length).trim();
  if (!key) throw new Error("GEMINI_API_KEY is empty");
  return key;
}

function splitTargets(value) {
  return String(value || "")
    .split(/[,;\n]+/)
    .map((v) => v.trim())
    .filter(Boolean);
}

function parseRows(csvText) {
  const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true });
  return Array.isArray(parsed.data) ? parsed.data : [];
}

function buildSlimCsv(rows, sampleSize) {
  if (!rows.length) return "";
  const benchmarkRows = rows.slice(0, sampleSize);
  const columns = Object.keys(rows[0] || {});
  const nameCol = columns.find((c) => c.includes("이름")) || columns[0];
  const relationCols = columns.filter(
    (c) =>
      c !== nameCol &&
      !["타임스탬프", "학년", "반", "성별", "timestamp", "gender", "grade", "class"].some((kw) =>
        c.toLowerCase().includes(kw.toLowerCase())
      )
  );

  const picked = relationCols.slice(0, 1);
  const slimRows = benchmarkRows.map((row) => ({
    [nameCol]: String(row[nameCol] || "").trim(),
    [picked[0]]: String(row[picked[0]] || "").trim(),
  }));

  return Papa.unparse(slimRows);
}

function buildNoisyCsv(cleanCsv) {
  const rows = parseRows(cleanCsv);
  if (!rows.length) return cleanCsv;

  const columns = Object.keys(rows[0] || {});
  const nameCol = columns.find((c) => c.includes("이름")) || columns[3] || columns[0];
  const relationCols = columns.filter(
    (c) =>
      c !== nameCol &&
      !["타임스탬프", "학년", "반", "성별", "timestamp", "gender", "grade", "class"].some((kw) =>
        c.toLowerCase().includes(kw.toLowerCase())
      )
  );

  const allNames = rows
    .map((r) => String(r[nameCol] || "").trim())
    .filter(Boolean);

  const typoMap = new Map();
  allNames.forEach((name, idx) => {
    let noisy = name;
    if (idx % 4 === 0 && name.length >= 2) noisy = name.slice(1);
    if (idx % 5 === 0 && name.length >= 3) noisy = `${name[1]}${name[0]}${name.slice(2)}`;
    if (idx % 7 === 0 && name.length >= 3) noisy = name.slice(0, -1);
    typoMap.set(name, noisy);
  });

  const noisyRows = rows.map((row, rowIdx) => {
    const out = { ...row };
    const source = String(row[nameCol] || "").trim();

    if (source && rowIdx % 2 === 0) out[nameCol] = typoMap.get(source) || source;

    relationCols.forEach((col, colIdx) => {
      const targets = splitTargets(row[col]);
      const noisyTargets = targets.map((name, idx) => {
        if ((rowIdx + colIdx + idx) % 3 === 0) return typoMap.get(name) || name;
        return name;
      });
      out[col] = noisyTargets.join("; ");
    });

    return out;
  });

  return Papa.unparse(noisyRows);
}

function normalizeResult(payload) {
  const result = payload && typeof payload === "object" ? payload : {};
  const students = Array.isArray(result.students)
    ? result.students.map((v) => String(v ?? "").trim()).filter(Boolean)
    : [];

  const relationships = Array.isArray(result.relationships)
    ? result.relationships
        .map((rel) => {
          if (!rel || typeof rel !== "object") return null;
          const from = String(rel.from ?? "").trim();
          const to = String(rel.to ?? "").trim();
          const type = String(rel.type ?? "general").trim() || "general";
          const weightRaw = Number(rel.weight);
          const weight = Number.isFinite(weightRaw) && weightRaw > 0 ? weightRaw : 1;
          if (!from || !to || from === to) return null;
          return { from, to, type, weight };
        })
        .filter(Boolean)
    : [];

  const set = new Set(students);
  relationships.forEach((e) => {
    set.add(e.from);
    set.add(e.to);
  });

  return { students: Array.from(set), relationships };
}

function scoreQuality(output, expectedNames) {
  const expected = new Set(expectedNames);
  const actual = new Set(output.students);

  let hit = 0;
  actual.forEach((name) => {
    if (expected.has(name)) hit += 1;
  });

  const precision = actual.size ? hit / actual.size : 0;
  const recall = expected.size ? hit / expected.size : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  const validEdges = output.relationships.filter((e) => expected.has(e.from) && expected.has(e.to)).length;
  const edgeValidity = output.relationships.length ? validEdges / output.relationships.length : 0;
  const qualityScore = (f1 * 0.7 + edgeValidity * 0.3) * 100;

  return {
    precision,
    recall,
    f1,
    edgeValidity,
    qualityScore,
    studentCount: output.students.length,
    edgeCount: output.relationships.length,
    unknownStudentCount: Array.from(actual).filter((name) => !expected.has(name)).length,
  };
}

function buildPrompt(csvData) {
  return `당신은 학급 SNA 정규화 엔진입니다.
CSV를 분석하여 JSON만 출력하세요.
필수 필드: students, relationships, metadata.normalization_notes
규칙:
1) 성 생략/오타/유사 표기는 canonical 이름으로 통합
2) 없는 학생 임의 생성 금지
3) 다중 이름은 콤마/세미콜론/줄바꿈 기준 분리
4) 관계 type은 friendship/collaboration/help/study/selection/together/preference/general 중 하나
5) weight 기본값 1
CSV:\n${csvData}`;
}

const responseSchema = {
  type: "OBJECT",
  properties: {
    students: {
      type: "ARRAY",
      items: { type: "STRING" },
    },
    relationships: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          from: { type: "STRING" },
          to: { type: "STRING" },
          type: { type: "STRING" },
          weight: { type: "NUMBER" },
        },
        required: ["from", "to", "type", "weight"],
      },
    },
    metadata: {
      type: "OBJECT",
      properties: {
        normalization_notes: {
          type: "ARRAY",
          items: { type: "STRING" },
        },
      },
      required: ["normalization_notes"],
    },
  },
  required: ["students", "relationships", "metadata"],
};

function extractJson(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) throw new Error("empty model text");

  try {
    return JSON.parse(trimmed);
  } catch {
    const first = trimmed.indexOf("{");
    const last = trimmed.lastIndexOf("}");
    if (first >= 0 && last > first) {
      return JSON.parse(trimmed.slice(first, last + 1));
    }
    throw new Error("no json found in model output");
  }
}

async function callGeminiRest({ apiKey, model, prompt, timeoutMs = 90000 }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema,
          maxOutputTokens: 16000,
          temperature: 0.1,
          thinkingConfig: {
            thinkingBudget: 256,
          },
        },
      }),
      signal: controller.signal,
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 500)}`);
    }

    const data = JSON.parse(text);
    const outputText = data?.candidates?.[0]?.content?.parts?.map((p) => p?.text || "").join("\n") || "";
    if (!outputText.trim()) {
      throw new Error(`empty model text: ${JSON.stringify(data).slice(0, 800)}`);
    }
    return extractJson(outputText);
  } finally {
    clearTimeout(timer);
  }
}

async function evaluateModel(apiKey, modelName, noisyCsv, expectedNames) {
  const prompt = buildPrompt(noisyCsv);
  const started = performance.now();
  const raw = await callGeminiRest({ apiKey, model: modelName, prompt, timeoutMs: 90000 });
  const latencyMs = performance.now() - started;

  const normalized = normalizeResult(raw);
  const quality = scoreQuality(normalized, expectedNames);

  return {
    model: modelName,
    latencyMs: Number(latencyMs.toFixed(1)),
    ...quality,
  };
}

async function main() {
  const apiKey = readApiKey();
  const cleanCsv = fs.readFileSync("public/sample.csv", "utf8");
  const rows = parseRows(cleanCsv);
  const sampleSizeRaw = Number(process.env.BENCH_SAMPLE_SIZE || "12");
  const sampleSize = Number.isFinite(sampleSizeRaw) && sampleSizeRaw > 0 ? Math.min(sampleSizeRaw, rows.length) : 12;
  const slimCsv = buildSlimCsv(rows, sampleSize);
  const expectedNames = rows.slice(0, sampleSize).map((r) => String(r["이름"] || "").trim()).filter(Boolean);
  const noisyCsv = buildNoisyCsv(slimCsv);

  const models = ["gemini-2.5-pro", "gemini-3-flash-preview"];
  const repeats = 2;
  const outputs = [];

  for (const model of models) {
    const runs = [];
    for (let i = 0; i < repeats; i += 1) {
      const row = await evaluateModel(apiKey, model, noisyCsv, expectedNames);
      runs.push(row);
    }

    const avgLatency = runs.reduce((sum, row) => sum + row.latencyMs, 0) / runs.length;
    const avgQuality = runs.reduce((sum, row) => sum + row.qualityScore, 0) / runs.length;
    const avgF1 = runs.reduce((sum, row) => sum + row.f1, 0) / runs.length;
    const avgEdgeValidity = runs.reduce((sum, row) => sum + row.edgeValidity, 0) / runs.length;

    outputs.push({
      model,
      repeats,
      summary: {
        avgLatencyMs: Number(avgLatency.toFixed(1)),
        avgQualityScore: Number(avgQuality.toFixed(2)),
        avgF1: Number(avgF1.toFixed(4)),
        avgEdgeValidity: Number(avgEdgeValidity.toFixed(4)),
      },
      runs,
    });
  }

  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    sampleStudents: expectedNames.length,
    results: outputs,
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
