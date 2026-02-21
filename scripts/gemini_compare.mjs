import fs from "fs";
import Papa from "papaparse";
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
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
    if (idx % 4 === 0 && name.length >= 2) noisy = name.slice(1); // 성 생략
    if (idx % 5 === 0 && name.length >= 3) noisy = `${name[1]}${name[0]}${name.slice(2)}`; // 자모 순서 교체
    if (idx % 7 === 0 && name.length >= 3) noisy = name.slice(0, -1); // 말미 1글자 누락
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

const responseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    students: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.STRING },
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
        normalization_notes: {
          type: SchemaType.ARRAY,
          items: { type: SchemaType.STRING },
        },
      },
      required: ["normalization_notes"],
    },
  },
  required: ["students", "relationships", "metadata"],
};

function buildPrompt(csvData) {
  return `당신은 학급 SNA 정규화 엔진입니다.
CSV를 분석하여 다음 JSON만 출력하세요.
- students: canonical 학생명 배열
- relationships: {from,to,type,weight}
- metadata.normalization_notes: 이름 보정 근거

규칙:
1) 성 생략/오타/유사 표기는 canonical 이름으로 통합
2) 없는 학생 임의 생성 금지
3) 관계 질문 셀의 다중 이름(콤마/세미콜론/줄바꿈) 분리
4) type은 friendship/collaboration/help/study/selection/together/preference/general 중 하나
5) weight 기본값 1

CSV:\n${csvData}`;
}

async function evaluateModel(genAI, modelName, noisyCsv, expectedNames) {
  const model = genAI.getGenerativeModel({ model: modelName });
  const started = performance.now();

  const result = await model.generateContent({
    contents: [{ role: "user", parts: [{ text: buildPrompt(noisyCsv) }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema,
    },
  });

  const elapsedMs = performance.now() - started;
  const parsed = JSON.parse(result.response.text());
  const normalized = normalizeResult(parsed);
  const quality = scoreQuality(normalized, expectedNames);

  return {
    model: modelName,
    latencyMs: Number(elapsedMs.toFixed(1)),
    ...quality,
  };
}

async function main() {
  const apiKey = readApiKey();
  const cleanCsv = fs.readFileSync("public/sample.csv", "utf8");
  const rows = parseRows(cleanCsv);
  const expectedNames = rows.map((r) => String(r["이름"] || "").trim()).filter(Boolean);
  const noisyCsv = buildNoisyCsv(cleanCsv);

  const genAI = new GoogleGenerativeAI(apiKey);
  const models = ["gemini-2.5-pro", "gemini-3-flash-preview"];

  const outputs = [];
  for (const model of models) {
    const row = await evaluateModel(genAI, model, noisyCsv, expectedNames);
    outputs.push(row);
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
