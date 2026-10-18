
/*
 * Structured Encoder V2
 *
 * 目的：
 * 係数・指数・回答段階を入力する。
 *
 * 指数ごとの専用IDや
 * 数式全体の暗記用IDは使わない。
 *
 * ここでは微分結果を計算しない。
 */


// ==========================================
// 特徴名を固定整数に変換
// ==========================================

function hashString(text) {
    let h = 2166136261;

    for (const ch of text) {
        h ^= ch.charCodeAt(0);
        h = Math.imul(h, 16777619);
    }

    return h >>> 0;
}


// ==========================================
// 固定seedの疑似乱数
// ==========================================

function mulberry32(seed) {
    return () => {
        let t = (seed += 0x6D2B79F5);

        t = Math.imul(t ^ (t >>> 15), t | 1);

        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}


// ==========================================
// 特徴をALPNの刺激へ変換
// ==========================================

function addFeature(active, label, alpnList, amount) {
    const rng = mulberry32(hashString(label));
    const chosen = new Set();

    const limit = Math.min(amount, alpnList.length);

    while (chosen.size < limit) {
        const index = Math.floor(rng() * alpnList.length);
        chosen.add(alpnList[index]);
    }

    for (const idx of chosen) {
        active.set(idx, (active.get(idx) ?? 0) + 1);
    }
}


// ==========================================
// 数式を係数と指数に分解
//
// 例：
// x^5     → 係数1、指数5
// 3*x^5   → 係数3、指数5
// 51*x^0  → 係数51、指数0
// ==========================================

export function parseMonomial(expr) {
    const match = /^(?:(\d+)\*)?x\^(\d+)$/.exec(expr);

    if (!match) {
        throw new Error(`未対応の単項式: ${expr}`);
    }

    const coefficient = Number(match[1] ?? 1);
    const exponent = Number(match[2]);

    if (
        !Number.isSafeInteger(coefficient) ||
        coefficient < 1 ||
        coefficient > 99 ||
        !Number.isSafeInteger(exponent) ||
        exponent < 0 ||
        exponent > 12
    ) {
        throw new Error(`係数または指数が対象範囲外: ${expr}`);
    }

    return { coefficient, exponent };
}


// ==========================================
// 回答の進行段階を認識
//
// 数値そのものではなく、
// 回答の形式から段階を調べる。
// ==========================================

function getPhase(prefix) {
    if (prefix === "") {
        return "start";
    }

    if (/^\d+$/.test(prefix)) {
        return "number";
    }

    if (/^\d+\*$/.test(prefix)) {
        return "times";
    }

    if (/^\d+\*x$/.test(prefix)) {
        return "variable";
    }

    if (/^\d+\*x\^$/.test(prefix)) {
        return "power-mark";
    }

    if (/^\d+\*x\^\d+$/.test(prefix)) {
        return "power-number";
    }

    // ハエが間違ったキーを押した場合
    return "unknown";
}


// ==========================================
// メイン：ALPN刺激を作る
// ==========================================

export function encodeState(expr, prefix, alpnList) {
    const { coefficient, exponent } = parseMonomial(expr);

    if (typeof prefix !== "string" || alpnList.length === 0) {
        throw new Error("prefix または ALPNリストが不正です");
    }

    const active = new Map();

    const group =
        exponent === 0 ? "constant" :
        exponent === 1 ? "linear" :
        "power";

    const phase = getPhase(prefix);


    // ======================================
    // ① 数式の基本情報
    // ======================================

    addFeature(
        active,
        "symbol:x",
        alpnList,
        8
    );

    addFeature(
        active,
        `degree-class:${group}`,
        alpnList,
        22
    );


    // ======================================
    // ② 係数を桁ごとに入力
    // ======================================

    addFeature(
        active,
        `coefficient:ones:${coefficient % 10}`,
        alpnList,
        6
    );

    addFeature(
        active,
        `coefficient:tens:${Math.floor(coefficient / 10)}`,
        alpnList,
        6
    );


    // ======================================
    // ③ 指数を段階的に表現
    //
    // 指数5なら
    //
    // exponent >= 1
    // exponent >= 2
    // exponent >= 3
    // exponent >= 4
    // exponent >= 5
    //
    // を入力する
    // ======================================

    for (let n = 1; n <= exponent; n++) {
        addFeature(
            active,
            `exponent:at-least:${n}`,
            alpnList,
            10
        );
    }


    // ======================================
    // ④ 回答の進行段階
    // ======================================

    addFeature(
        active,
        `phase:${phase}`,
        alpnList,
        35
    );


    // ======================================
    // ⑤ 問題の種類と回答段階
    //
    // exactな指数との組み合わせは作らない
    // ======================================

    addFeature(
        active,
        `phase:${phase}|degree-class:${group}`,
        alpnList,
        45
    );


    // ======================================
    // ⑥ 回答の長さ
    // ======================================

    addFeature(
        active,
        `prefix-length:${Math.min(prefix.length, 12)}`,
        alpnList,
        8
    );


    // ======================================
    // ⑦ 最後に押したキー
    // ======================================

    if (prefix.length > 0) {
        addFeature(
            active,
            `last-key:${prefix.at(-1)}`,
            alpnList,
            8
        );
    }


    // ======================================
    // ALPN刺激を返す
    // ======================================

    return [...active.entries()].map(
        ([idx, strength]) => ({
            idx,
            strength
        })
    );
}
