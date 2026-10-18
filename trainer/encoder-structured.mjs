
/*
 * Structured Curriculum Encoder
 *
 * 問題を次の情報に分解する
 *
 * 1. 係数
 * 2. 指数
 * 3. 回答途中の文字列
 *
 * ここでは微分結果を計算しない
 */

function hashString(text) {
    let h = 2166136261;

    for (const char of text) {
        h ^= char.charCodeAt(0);
        h = Math.imul(h, 16777619);
    }

    return h >>> 0;
}


function mulberry32(seed) {
    return function () {
        let t = (seed += 0x6D2B79F5);
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}


// 特徴を決まったALPNの組み合わせへ変換
function addFeature(active, feature, alpnList, count) {
    const rng = mulberry32(hashString(feature));
    const chosen = new Set();

    while (chosen.size < Math.min(count, alpnList.length)) {
        const index = Math.floor(rng() * alpnList.length);
        chosen.add(alpnList[index]);
    }

    for (const idx of chosen) {
        active.set(idx, (active.get(idx) ?? 0) + 1);
    }
}


// ==========================================
// 数式を係数と指数に分解
// ==========================================

export function parseMonomial(expr) {
    const match = /^(?:(\d+)\*)?x\^(\d+)$/.exec(expr);

    if (!match) {
        throw new Error(`Unsupported monomial: ${expr}`);
    }

    const coefficient = Number(match[1] ?? 1);
    const exponent = Number(match[2]);

    if (
        !Number.isSafeInteger(coefficient) ||
        coefficient < 1 ||
        !Number.isSafeInteger(exponent) ||
        exponent > 12
    ) {
        throw new Error(`Out of range: ${expr}`);
    }

    return { coefficient, exponent };
}


// ==========================================
// ALPN入力を生成
// ==========================================

export function encodeState(expr, prefix, alpnList) {

    const { coefficient, exponent } = parseMonomial(expr);
    const active = new Map();

    // --------------------------------------
    // ① 数式の情報
    // --------------------------------------

    addFeature(active, "symbol:x", alpnList, 10);

    // 係数を桁ごとに入力
    addFeature(
        active,
        `coefficient:ones:${coefficient % 10}`,
        alpnList,
        10
    );

    addFeature(
        active,
        `coefficient:tens:${Math.floor(coefficient / 10)}`,
        alpnList,
        8
    );

    // 指数
    addFeature(
        active,
        `exponent:exact:${exponent}`,
        alpnList,
        25
    );

    // 指数の大小関係も一部共有させる
    if (exponent === 0) {
        addFeature(active, "exponent:zero", alpnList, 14);
    }

    for (let n = 1; n <= exponent; n++) {
        addFeature(
            active,
            `exponent:at-least:${n}`,
            alpnList,
            8
        );
    }

    // --------------------------------------
    // ② どこまで答えたか
    // --------------------------------------

    const progress = prefix === "" ? "<EMPTY>" : prefix;

    addFeature(
        active,
        `prefix:${progress}`,
        alpnList,
        16
    );

    addFeature(
        active,
        `prefix:length:${prefix.length}`,
        alpnList,
        8
    );

    // --------------------------------------
    // ③ 指数と回答段階の組み合わせ
    // --------------------------------------

    addFeature(
        active,
        `exponent:${exponent}|prefix:${progress}`,
        alpnList,
        72
    );

    return [...active.entries()].map(
        ([idx, strength]) => ({ idx, strength })
    );
}
