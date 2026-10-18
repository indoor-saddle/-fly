
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { gzipSync, gunzipSync } from "node:zlib";
import { makeCurriculumReader } from "./math-reader-structured-v2.mjs";

// ==========================================
// Structured V2：指数5を除外する実験
// ==========================================

const CYCLES = 80;
const CHECK_EVERY = 10;
const STABILITY_TRIALS = 20;
const FULL_TRIALS = 30;
const MAX_KEYS = 12;

const MODEL_DIR = new URL(
    "../model/structured-v2/",
    import.meta.url
);

// ==========================================
// JSONL読み込み
// ==========================================

async function loadJSONL(path) {
    const text = await readFile(
        new URL(path, import.meta.url),
        "utf8"
    );

    return text.split(/\r?\n/)
        .filter(line => line.trim())
        .map(JSON.parse);
}

// ==========================================
// 脳の予測（学習なし）
// ==========================================

function predict(reader, expr, prefix) {
    const seen = reader.look(expr, prefix);
    return reader.decide(seen.drive).action;
}

function evaluate(reader, rows) {
    let correct = 0;

    for (const row of rows) {
        if (predict(reader, row.expr, row.prefix) === row.next) {
            correct++;
        }
    }

    return {
        correct,
        total: rows.length,
        accuracy: 100 * correct / rows.length
    };
}

function report(label, result) {
    console.log(
        `${label}: ${result.correct}/${result.total} = ${result.accuracy.toFixed(2)}%`
    );
}

// ==========================================
// 安定性テスト
// ==========================================

function stability(reader, rows, trials) {
    let correct = 0;

    for (const row of rows) {
        let hits = 0;
        const choices = {};

        for (let i = 0; i < trials; i++) {
            const action = predict(reader, row.expr, row.prefix);

            choices[action] = (choices[action] ?? 0) + 1;

            if (action === row.next) {
                hits++;
            }
        }

        correct += hits;

        console.log(
            `${row.expr} | "${row.prefix}" → ${row.next}: ${hits}/${trials}`,
            choices
        );
    }

    return {
        correct,
        total: rows.length * trials,
        accuracy: 100 * correct / (rows.length * trials)
    };
}

// ==========================================
// 自力で答えを完成させる
// ==========================================

function generateAnswer(reader, expr) {
    let prefix = "";

    for (let i = 0; i < MAX_KEYS; i++) {
        const key = predict(reader, expr, prefix);

        if (key === "END") {
            return { answer: prefix, ended: true };
        }

        prefix += key;
    }

    return { answer: prefix, ended: false };
}

function fullTest(reader, problems, trials) {
    let totalCorrect = 0;

    for (const problem of problems) {
        let correct = 0;
        const outputs = {};

        for (let i = 0; i < trials; i++) {
            const result = generateAnswer(reader, problem.expr);

            const output = result.ended
                ? result.answer
                : `${result.answer} (ENDなし)`;

            outputs[output] = (outputs[output] ?? 0) + 1;

            if (
                result.ended &&
                result.answer === problem.answer
            ) {
                correct++;
            }
        }

        totalCorrect += correct;

        const top = Object.entries(outputs)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3);

        console.log(
            `${problem.expr} → ${problem.answer}: ${correct}/${trials}`,
            top
        );
    }

    return {
        correct: totalCorrect,
        total: problems.length * trials,
        accuracy: 100 * totalCorrect / (problems.length * trials)
    };
}

// ==========================================
// 学習順序シャッフル
// ==========================================

function shuffle(rows, seed) {
    const result = [...rows];
    let state = seed >>> 0;

    function random() {
        state = (
            Math.imul(state, 1664525) + 1013904223
        ) >>> 0;

        return state / 4294967296;
    }

    for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));

        [result[i], result[j]] = [result[j], result[i]];
    }

    return result;
}

// ==========================================
// 教材読み込み
// ==========================================

const level1 = await loadJSONL(
    "../dataset/structured/level1/train_steps.jsonl"
);

const level1Validation = await loadJSONL(
    "../dataset/structured/level1/validation_steps.jsonl"
);

const level2 = await loadJSONL(
    "../dataset/structured/level2/train_steps.jsonl"
);

const allProblems = await loadJSONL(
    "../dataset/structured/level4/train.jsonl"
);

const allSteps = await loadJSONL(
    "../dataset/structured/level4/train_steps.jsonl"
);

// ==========================================
// 指数5だけを完全に除外
// ==========================================

const trainingExpressions = new Set([
    "x^2",
    "x^3",
    "x^4",
    "x^6"
]);

const trainingProblems = allProblems.filter(
    p => trainingExpressions.has(p.expr)
);

const trainingSteps = allSteps.filter(
    row => trainingExpressions.has(row.expr)
);

// x^5は検証専用
const holdoutProblems = allProblems.filter(
    p => p.expr === "x^5"
);

const holdoutSteps = allSteps.filter(
    row => row.expr === "x^5"
);

// 教材の取り違えや漏洩を防ぐ
if (
    trainingProblems.length !== 4 ||
    trainingSteps.length !== 22 ||
    holdoutProblems.length !== 1 ||
    holdoutSteps.length !== 6 ||
    level2.length !== 2
) {
    throw new Error("教材の内容・ステップ数が想定と違います");
}

if (trainingSteps.some(row => row.expr === "x^5")) {
    throw new Error("学習データにx^5が混入しています！");
}

const reviewMap = new Map();

for (const row of level1) {
    if (!reviewMap.has(row.expr)) {
        reviewMap.set(row.expr, []);
    }

    reviewMap.get(row.expr).push(row);
}

const reviews = [...reviewMap.values()];

console.log("Training:", [...trainingExpressions]);
console.log("Training steps:", trainingSteps.length);
console.log("Held out:", holdoutProblems[0].expr);
console.log("Held-out steps:", holdoutSteps.length);

// ==========================================
// Level 2まで学習済みのV2脳をロード
// ==========================================

const reader = await makeCurriculumReader();

const raw = gunzipSync(
    await readFile(
        new URL("brain-after-level2.bin.gz", MODEL_DIR)
    )
);

if (raw.length % 4 !== 0) {
    throw new Error("モデルファイルのサイズが不正です");
}

const gains = new Float32Array(raw.length / 4);

for (let i = 0; i < gains.length; i++) {
    gains[i] = raw.readFloatLE(i * 4);
}

reader.importGains(gains);

console.log("\nLoaded V2 Level 2 brain:", gains.length, "gains");

// ==========================================
// 学習前の正答率
// ==========================================

console.log("\n========== BEFORE TRAINING ==========");

report("Level 1", evaluate(reader, level1Validation));
report("Level 2", evaluate(reader, level2));
report("Training exponents", evaluate(reader, trainingSteps));
report("Unknown x^5", evaluate(reader, holdoutSteps));

// ==========================================
// 学習開始
// ==========================================

for (let cycle = 1; cycle <= CYCLES; cycle++) {

    const review = reviews[
        (cycle - 1) % reviews.length
    ];

    const newLessons = shuffle(
        trainingSteps,
        20261015 + cycle
    );

    // 古い知識を復習しつつ新しい指数を学習
    const oldLessons = [...review, ...level2];

    const batch = cycle % 2 === 0
        ? [...newLessons, ...oldLessons]
        : [...oldLessons, ...newLessons];

    for (const row of batch) {
        reader.practise(
            row.expr,
            row.prefix,
            row.next
        );
    }

    if (cycle % CHECK_EVERY === 0) {
        console.log(`\n========== CYCLE ${cycle} ==========`);

        report("Level 1", evaluate(reader, level1Validation));
        report("Level 2", evaluate(reader, level2));

        report(
            "Training exponents",
            evaluate(reader, trainingSteps)
        );

        // 観察だけ。学習させない
        report(
            "Unknown x^5",
            evaluate(reader, holdoutSteps)
        );
    }
}

// ==========================================
// 最終評価
// ==========================================

console.log("\n========== FINAL RESULT ==========");

const finalL1 = evaluate(reader, level1Validation);
const finalL2 = evaluate(reader, level2);
const finalTrain = evaluate(reader, trainingSteps);
const finalHoldout = evaluate(reader, holdoutSteps);

report("Level 1", finalL1);
report("Level 2", finalL2);
report("Training exponents", finalTrain);
report("Unknown x^5", finalHoldout);

// ==========================================
// 未知のx^5を20回ずつ調べる
// ==========================================

console.log("\n========== UNKNOWN x^5 STABILITY ==========");

const holdoutStability = stability(
    reader,
    holdoutSteps,
    STABILITY_TRIALS
);

report("Unknown x^5 stability", holdoutStability);

// ==========================================
// 学習済み問題の全文回答
// ==========================================

console.log("\n========== LEARNED FULL ANSWERS ==========");

const learnedFull = fullTest(
    reader,
    trainingProblems,
    FULL_TRIALS
);

report("Learned full answers", learnedFull);

// ==========================================
// 未知のx^5を自力で微分
// ==========================================

console.log("\n========== UNKNOWN x^5 FULL ANSWER ==========");

const unknownFull = fullTest(
    reader,
    holdoutProblems,
    FULL_TRIALS
);

report("Unknown x^5 full answer", unknownFull);

// ==========================================
// モデルを別名で保存
// ==========================================

const learned = reader.exportGains();

const buffer = Buffer.from(
    learned.buffer,
    learned.byteOffset,
    learned.byteLength
);

await mkdir(MODEL_DIR, { recursive: true });

await writeFile(
    new URL("brain-holdout5.bin.gz", MODEL_DIR),
    gzipSync(buffer)
);

const metadata = {
    encoder: "structured-v2",
    experiment: "holdout-exponent-5",
    sourceModel: "brain-after-level2.bin.gz",
    trainingExponents: [2, 3, 4, 6],
    validationExponent: 5,
    cycles: CYCLES,
    level1Accuracy: finalL1.accuracy,
    level2Accuracy: finalL2.accuracy,
    trainingAccuracy: finalTrain.accuracy,
    holdoutAccuracy: finalHoldout.accuracy,
    holdoutStability: holdoutStability.accuracy,
    learnedFullAccuracy: learnedFull.accuracy,
    holdoutFullAccuracy: unknownFull.accuracy,
    learnedGains: learned.length
};

await writeFile(
    new URL("metadata-holdout5.json", MODEL_DIR),
    JSON.stringify(metadata, null, 2),
    "utf8"
);

console.log("\nSaved: model/structured-v2/brain-holdout5.bin.gz");
console.log("Saved: model/structured-v2/metadata-holdout5.json");
