import fs from 'fs';
import Papa from 'papaparse';
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import { performance } from 'perf_hooks';

function readApiKey() {
  const env = fs.readFileSync('.env.local', 'utf8');
  const line = env.split(/\r?\n/).find((l) => l.startsWith('GEMINI_API_KEY='));
  if (!line) throw new Error('GEMINI_API_KEY not found');
  return line.slice('GEMINI_API_KEY='.length).trim();
}

function parseCsv(csvText) {
  const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true });
  return parsed.data;
}

function splitTargets(value) {
  return String(value || '').split(/[,;\n]+/).map((v) => v.trim()).filter(Boolean);
}

function buildNoisyCsv(cleanCsv) {
  const rows = parseCsv(cleanCsv);
  const nameCol = '이름';
  const relationCols = [
    '학교에서 공부할 때 함께 하고 싶은 친구를 3명 선택해주세요',
    '어려운 과제가 있을 때 도움을 청하고 싶은 친구를 3명 선택해주세요',
    '쉬는 시간에 주로 함께 시간을 보내는 친구를 3명 선택해주세요',
    '학교 밖에서도 자주 만나는 친구를 3명 선택해주세요',
    '조별 활동이나 프로젝트에서 함께 하고 싶은 친구를 3명 선택해주세요',
    '학급 행사나 이벤트를 준비할 때 함께 하고 싶은 친구를 3명 선택해주세요'
  ];

  const allNames = rows.map((r) => String(r[nameCol] || '').trim()).filter(Boolean);

  const typoMap = new Map();
  allNames.forEach((name, idx) => {
    let noisy = name;
    if (idx % 4 === 0 && name.length >= 2) {
      noisy = name.slice(1);
    } else if (idx % 5 === 0 && name.length >= 3) {
      const a = name[0];
      const b = name[1];
      noisy = b + a + name.slice(2);
    } else if (idx % 7 === 0 && name.length >= 3) {
      noisy = name.slice(0, -1);
    }
    typoMap.set(name, noisy);
  });

  const noisyRows = rows.map((row, rowIdx) => {
    const n = { ...row };
    const rawName = String(row[nameCol] || '').trim();
    if (rawName) {
      n[nameCol] = rowIdx % 3 === 0 ? (typoMap.get(rawName) || rawName) : rawName;
    }

    relationCols.forEach((col, colIdx) => {
      const targets = splitTargets(row[col]);
      const noisyTargets = targets.map((t, idx) => {
        if ((rowIdx + colIdx + idx) % 3 === 0) return typoMap.get(t) || t;
        return t;
      });
      n[col] = noisyTargets.join('; ');
    });

    return n;
  });

  return Papa.unparse(noisyRows);
}

function normalizePayload(payload) {
  const obj = payload && typeof payload === 'object' ? payload : {};
  const students = Array.isArray(obj.students) ? obj.students.map((v) => String(v ?? '').trim()).filter(Boolean) : [];
  const relationships = Array.isArray(obj.relationships)
    ? obj.relationships
      .map((rel) => {
        if (!rel || typeof rel !== 'object') return null;
        const from = String(rel.from ?? '').trim();
        const to = String(rel.to ?? '').trim();
        const type = String(rel.type ?? 'general').trim() || 'general';
        const rawWeight = Number(rel.weight);
        const weight = Number.isFinite(rawWeight) && rawWeight > 0 ? rawWeight : 1;
        if (!from || !to || from === to) return null;
        return { from, to, type, weight };
      })
      .filter(Boolean)
    : [];

  const studentSet = new Set(students);
  relationships.forEach((e) => {
    studentSet.add(e.from);
    studentSet.add(e.to);
  });

  return { students: Array.from(studentSet), relationships };
}

function score(result, expectedNames) {
  const expected = new Set(expectedNames);
  const out = new Set(result.students);

  let intersection = 0;
  for (const n of out) if (expected.has(n)) intersection += 1;

  const precision = out.size ? intersection / out.size : 0;
  const recall = expected.size ? intersection / expected.size : 0;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  const unknownStudents = Array.from(out).filter((n) => !expected.has(n)).length;

  const validEdges = result.relationships.filter((e) => expected.has(e.from) && expected.has(e.to)).length;
  const edgeValidity = result.relationships.length ? validEdges / result.relationships.length : 0;

  return {
    student_count: result.students.length,
    edge_count: result.relationships.length,
    precision,
    recall,
    f1,
    unknownStudents,
    edgeValidity,
  };
}

const responseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    students: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
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
        required: ['from', 'to', 'type', 'weight'],
      },
    },
    metadata: {
      type: SchemaType.OBJECT,
      properties: {
        question_types: { type: SchemaType.OBJECT, properties: { example_column: { type: SchemaType.STRING } } },
        normalization_notes: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
      },
      required: ['question_types', 'normalization_notes'],
    },
  },
  required: ['students', 'relationships', 'metadata'],
};

function buildPrompt(csvData) {
  return `당신은 학급 사회관계망(SNA) 데이터 정규화 엔진입니다.
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

[CSV 데이터]\n${csvData}`;
}

async function run() {
  const apiKey = readApiKey();
  const cleanCsv = fs.readFileSync('public/sample.csv', 'utf8');
  const rows = parseCsv(cleanCsv);
  const expectedNames = rows.map((r) => String(r['이름'] || '').trim()).filter(Boolean);
  const noisyCsv = buildNoisyCsv(cleanCsv);

  const genAI = new GoogleGenerativeAI(apiKey);
  const models = ['gemini-2.5-pro', 'gemini-3-flash-preview'];
  const repeats = 3;

  for (const modelName of models) {
    const results = [];

    for (let i = 0; i < repeats; i += 1) {
      const model = genAI.getGenerativeModel({ model: modelName });
      const started = performance.now();
      const response = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: buildPrompt(noisyCsv) }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema,
        },
      });
      const elapsedMs = performance.now() - started;
      const text = response.response.text();
      const parsed = JSON.parse(text);
      const normalized = normalizePayload(parsed);
      const scoreRow = score(normalized, expectedNames);
      results.push({ elapsedMs, ...scoreRow });
    }

    const avg = (k) => results.reduce((s, r) => s + r[k], 0) / results.length;
    const mins = Math.min(...results.map((r) => r.elapsedMs));
    const maxs = Math.max(...results.map((r) => r.elapsedMs));

    console.log(`MODEL=${modelName}`);
    console.log(JSON.stringify({
      runs: results,
      summary: {
        avg_latency_ms: Number(avg('elapsedMs').toFixed(1)),
        min_latency_ms: Number(mins.toFixed(1)),
        max_latency_ms: Number(maxs.toFixed(1)),
        avg_f1: Number(avg('f1').toFixed(4)),
        avg_precision: Number(avg('precision').toFixed(4)),
        avg_recall: Number(avg('recall').toFixed(4)),
        avg_edge_validity: Number(avg('edgeValidity').toFixed(4)),
        avg_unknown_students: Number(avg('unknownStudents').toFixed(2)),
        avg_student_count: Number(avg('student_count').toFixed(2)),
        avg_edge_count: Number(avg('edge_count').toFixed(2)),
      }
    }, null, 2));
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
