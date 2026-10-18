
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { makeCurriculumReader } from "./math-reader-structured-v2.mjs";

const MODEL_DIR = new URL("../model/structured-v2/", import.meta.url);

const LEVEL1_EPOCHS = 5;
const LEVEL2_CYCLES = 80;

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
// キー予測（学習なし）
// ==========================================

function predict(reader, expr, prefix) {
    const seen = reader.look(expr, prefix);
    return reader.decide(seen.drive).action;
}

// ==========================================
// 正答率の測定
// ==========================================

function evaluate(reader, data) {
    let correct = 0;

    for (const row of data) {
        if (predict(reader, row.expr, row.prefix) === row.next) {
            correct++;
        }
    }

    return {
        correct,
        total: data.length,
        accuracy: 100 * correct / data.length
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

function stability(reader, data, trials) {
    let correct = 0;

    for (const row of data) {
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
        total: data.length * trials,
        accuracy: 100 * correct / (data.length * trials)
    };
}

// ==========================================
// 学習済みシナプスを保存
// ==========================================

async function saveBrain(reader, filename) {
    const gains = reader.exportGains();

    const buffer = Buffer.from(
        gains.buffer,
        gains.byteOffset,
        gains.byteLength
    );

    await writeFile(
        new URL(filename, MODEL_DIR),
        gzipSync(buffer)
    );

    console.log(`Saved: model/structured-v2/${filename}`);
}

// ==========================================
// 教材読み込み
// ==========================================

const level1Train = await loadJSONL(
    "../dataset/structured/level1/train_steps.jsonl"
);

const level1Validation = await loadJSONL(
    "../dataset/structured/level1/validation_steps.jsonl"
);

const level2Train = await loadJSONL(
    "../dataset/structured/level2/train_steps.jsonl"
);

// Level 1の問題ごとにステップをまとめる
const reviewMap = new Map();

for (const row of level1Train) {
    if (!reviewMap.has(row.expr)) {
        reviewMap.set(row.expr, []);
    }

    reviewMap.get(row.expr).push(row);
}

const reviews = [...reviewMap.values()];

if (
    level1Train.length !== 100 ||
    reviews.some(rows => rows.length !== 2) ||
    level2Train.length !== 2
) {
    throw new Error("教材の内容を確認してください");
}

await mkdir(MODEL_DIR, { recursive: true });

// ==========================================
// 新しい脳を作る
// ==========================================

const reader = await makeCurriculumReader();

console.log("\n========== BEFORE TRAINING ==========");

report("Level 1", evaluate(reader, level1Validation));
report("Level 2", evaluate(reader, level2Train));

// ==========================================
// STEP 1：Level 1
// ==========================================

console.log("\n========== LEVEL 1 TRAINING ==========");

for (let epoch = 1; epoch <= LEVEL1_EPOCHS; epoch++) {

    for (const row of level1Train) {
        reader.practise(
            row.expr,
            row.prefix,
            row.next
        );
    }

    console.log(`\nEpoch ${epoch}`);

    report(
        "Level 1 validation",
        evaluate(reader, level1Validation)
    );
}

await saveBrain(reader, "brain-after-level1.bin.gz");

// ==========================================
// STEP 2：Level 2の追加学習
// ==========================================

console.log("\n========== LEVEL 2 TRAINING ==========");

for (let cycle = 1; cycle <= LEVEL2_CYCLES; cycle++) {

    const review = reviews[
        (cycle - 1) % reviews.length
    ];

    // 毎回Level 1を復習しつつ、
    // Level 2を新しく学ぶ
    const batch = cycle % 2 === 0
        ? [...level2Train, ...review]
        : [...review, ...level2Train];

    for (const row of batch) {
        reader.practise(
            row.expr,
            row.prefix,
            row.next
        );
    }

    if (cycle % 10 === 0) {
        console.log(`\nCycle ${cycle}`);

        report(
            "Level 1",
            evaluate(reader, level1Validation)
        );

        report(
            "Level 2",
            evaluate(reader, level2Train)
        );
    }
}

// ==========================================
// 最終評価
// ==========================================

console.log("\n========== FINAL RESULT ==========");

const finalL1 = evaluate(reader, level1Validation);
const finalL2 = evaluate(reader, level2Train);

report("Level 1 validation", finalL1);
report("Level 2", finalL2);

// ==========================================
// 安定性テスト
// ==========================================

console.log("\n========== LEVEL 2 STABILITY ==========");

const stableL2 = stability(reader, level2Train, 50);

report("Level 2 stability", stableL2);

console.log("\n========== LEVEL 1 STABILITY ==========");

const stableL1 = stability(
    reader,
    level1Validation.slice(0, 10),
    20
);

report("Level 1 stability", stableL1);

// ==========================================
// V2の記憶を保存
// ==========================================

await saveBrain(
    reader,
    "brain-after-level2.bin.gz"
);

const metadata = {
    encoder: "structured-v2",
    trainedThrough: 2,
    level1Epochs: LEVEL1_EPOCHS,
    level2Cycles: LEVEL2_CYCLES,
    actions: reader.ACTIONS,
    learnedGains: reader.exportGains().length,
    level1Accuracy: finalL1.accuracy,
    level2Accuracy: finalL2.accuracy,
    level1Stability: stableL1.accuracy,
    level2Stability: stableL2.accuracy
};

await writeFile(
    new URL("metadata-level2.json", MODEL_DIR),
    JSON.stringify(metadata, null, 2),
    "utf8"
);

console.log("\nSTRUCTURED V2 BASICS FINISHED!");
