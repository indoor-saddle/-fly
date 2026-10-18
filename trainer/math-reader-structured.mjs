import { readFile } from "node:fs/promises";

import {
    FlyBrain
} from "../brain/flybrain.js";

import { encodeState } from "./encoder-structured.mjs";


// ============================================================
// 今後ずっと固定するキー
//
// + と - は今回は入れない
// ============================================================

export const ACTIONS = [

    "0",
    "1",
    "2",
    "3",
    "4",
    "5",
    "6",
    "7",
    "8",
    "9",

    "x",
    "*",
    "^",

    "END"
];


const BASE_HZ = 80;

const LOOK_MS = 400;

const FEEDBACK_MS = 300;

const ETA = 6e-5;


// ============================================================
// Curriculum Brain
// ============================================================

export async function makeCurriculumReader() {

    console.log(
        "loading curriculum mushroom body..."
    );


    const brainBase =
        new URL(
            "../brain/",
            import.meta.url
        );


    const mb =
        JSON.parse(
            await readFile(
                new URL(
                    "data/mb783.json",
                    brainBase
                ),
                "utf8"
            )
        );


    const brain =
        await FlyBrain.load({

            graph:
                new URL(
                    "data/flywire783.fbg.gz",
                    brainBase
                ),

            wasm:
                new URL(
                    "flybrain.wasm",
                    brainBase
                )
        });


    console.log(
        "brain loaded"
    );


    // ========================================================
    // ニューロングループ取得
    // ========================================================

    const groups =
        mb.groups;


    function pick(prefix) {

        return Object
            .keys(groups)
            .filter(
                key =>
                    key.startsWith(prefix)
            )
            .sort();
    }


    function collect(keys) {

        return keys.flatMap(
            key =>
                groups[key].idx
        );
    }


    const KC =
        collect(
            pick("kc:")
        );

    const MBON =
        collect(
            pick("mbon:")
        );

    const DAN =
        collect(
            pick("dan:")
        );

    const MBIN =
        collect(
            pick("mbin:")
        );

    const ALPN =
        collect(
            pick("alpn:")
        );


    console.log(
        "KC:",
        KC.length
    );

    console.log(
        "MBON:",
        MBON.length
    );

    console.log(
        "DAN:",
        DAN.length
    );

    console.log(
        "MBIN:",
        MBIN.length
    );

    console.log(
        "ALPN:",
        ALPN.length
    );


    // ========================================================
    // キノコ体周辺以外を停止
    // ========================================================

    const inside =
        new Set([

            ...KC,
            ...MBON,
            ...DAN,
            ...MBIN,
            ...ALPN

        ]);


    const outside =
        [];


    for (
        let i = 0;
        i < brain.n;
        i++
    ) {

        if (
            !inside.has(i)
        ) {

            outside.push(i);
        }
    }


    brain.silence(
        outside,
        true,
        {
            byIndex: true
        }
    );


    console.log(
        "outside neurons silenced:",
        outside.length
    );


    // ========================================================
    // 各MBONが何個のKCから入力を受けるか
    // ========================================================

    const mbonSet =
        new Set(MBON);


    const kcInputCount =
        new Map();


    // 0から初期化
    for (
        const mbon
        of MBON
    ) {

        kcInputCount.set(
            mbon,
            0
        );
    }


    for (
        const kc
        of KC
    ) {

        const connection =
            brain.outgoing(
                kc,
                {
                    byIndex: true
                }
            );


        for (
            const post
            of connection.post
        ) {

            if (
                mbonSet.has(post)
            ) {

                kcInputCount.set(

                    post,

                    kcInputCount.get(post)
                    + 1
                );
            }
        }
    }


    // ========================================================
    // 14個の固定MBONグループ
    // ========================================================

    const actionGroups =
        ACTIONS.map(
            action => ({

                action,

                cells: [],

                inputs: 0
            })
        );


    // 入力数が多い順
    // 同点ならニューロンindex順
    //
    // → 毎回同じ配置になる
    const sortedMBON =
        [...MBON]
        .sort(
            (a, b) => {

                const difference =
                    kcInputCount.get(b)
                    -
                    kcInputCount.get(a);


                if (
                    difference !== 0
                ) {

                    return difference;
                }


                return a - b;
            }
        );


    // ========================================================
    // Greedy balancing
    //
    // KC入力総数が一番少ないグループに
    // 次のMBONを配置
    // ========================================================

    for (
        const mbon
        of sortedMBON
    ) {

        let targetIndex = 0;


        for (
            let i = 1;
            i < actionGroups.length;
            i++
        ) {

            if (
                actionGroups[i].inputs
                <
                actionGroups[targetIndex].inputs
            ) {

                targetIndex = i;
            }
        }


        const target =
            actionGroups[
                targetIndex
            ];


        target.cells.push(
            mbon
        );


        target.inputs +=
            kcInputCount.get(
                mbon
            );
    }


    // ========================================================
    // 配置確認
    // ========================================================

    console.log(
        "\nFIXED CURRICULUM MBON GROUPS"
    );


    for (
        const group
        of actionGroups
    ) {

        console.log(

            group.action,

            "MBON:",
            group.cells.length,

            "KC inputs:",
            group.inputs

        );
    }


    // ========================================================
    // KC → MBON 可塑性
    // ========================================================

    brain.setPlasticity({

        pre: KC,

        groups:
            actionGroups.map(
                group => ({

                    post:
                        group.cells,

                    modulators: []
                })
            ),

        eta: 0,

        tauTrace: 40,

        tauDopa: 1e7,

        gainMin: 0.05,

        gainMax: 2
    });


    let seed = 1;


    // ========================================================
    // 問題を見る
    // ========================================================

    function look(
        expr,
        prefix
    ) {

        brain.clearStimuli();


        const encoded =
            encodeState(
                expr,
                prefix,
                ALPN
            );


        // strengthごとにまとめる
        const buckets =
            new Map();


        for (
            const item
            of encoded
        ) {

            if (
                !buckets.has(
                    item.strength
                )
            ) {

                buckets.set(
                    item.strength,
                    []
                );
            }


            buckets
                .get(
                    item.strength
                )
                .push(
                    item.idx
                );
        }


        // ALPN刺激
        for (
            const [
                strength,
                neurons
            ]
            of buckets
        ) {

            brain.stimulate(

                neurons,

                BASE_HZ
                *
                strength,

                {
                    byIndex: true
                }
            );
        }


        // 今は観察だけ
        brain.setPlasticityParams({

            eta: 0,

            tauTrace: 40,

            tauDopa: 1e7,

            gainMin: 0.05,

            gainMax: 2
        });


        brain.reset(
            ++seed
        );


        brain.run(
            LOOK_MS,
            {
                events: false
            }
        );


        // ====================================================
        // KC発火数
        // ====================================================

        const counts =
            brain.counts();


        const kcSpikes =
            new Uint16Array(
                KC.length
            );


        let activeKC = 0;


        for (
            let i = 0;
            i < KC.length;
            i++
        ) {

            const count =
                counts[
                    KC[i]
                ];


            if (
                count > 0
            ) {

                kcSpikes[i] =
                    Math.min(
                        count,
                        65535
                    );

                activeKC++;
            }
        }


        const drive =
            brain.driveByGroup(
                KC,
                kcSpikes
            );


        return {

            drive,

            encoded,

            activeKC
        };
    }


    // ========================================================
    // 一番driveが低いキーを選択
    // ========================================================

    function decide(
        drive
    ) {

        let best = 0;


        for (
            let i = 1;
            i < drive.length;
            i++
        ) {

            if (
                drive[i]
                <
                drive[best]
            ) {

                best = i;
            }
        }


        // 2番目
        let second = -1;


        for (
            let i = 0;
            i < drive.length;
            i++
        ) {

            if (
                i === best
            ) {

                continue;
            }


            if (
                second === -1
                ||
                drive[i]
                <
                drive[second]
            ) {

                second = i;
            }
        }


        return {

            index:
                best,

            action:
                ACTIONS[
                    best
                ],

            drive:
                drive[
                    best
                ],

            margin:
                second === -1
                    ? 0
                    : Math.abs(
                        drive[second]
                        -
                        drive[best]
                    )
        };
    }


    // ========================================================
    // ドーパミン学習
    // ========================================================

    function feedback(
        correctIndex,
        wrongIndex
    ) {

        brain.setPlasticityParams({

            eta: ETA,

            tauTrace: 40,

            tauDopa: 1e7,

            gainMin: 0.05,

            gainMax: 2
        });


        // 正解
        brain.dopamine(
            correctIndex,
            1
        );


        // 間違った選択
        if (
            wrongIndex
            !==
            correctIndex
        ) {

            brain.dopamine(
                wrongIndex,
                -1
            );
        }


        brain.run(
            FEEDBACK_MS,
            {
                events: false
            }
        );


        brain.dopamine(
            correctIndex,
            0
        );


        if (
            wrongIndex
            !==
            correctIndex
        ) {

            brain.dopamine(
                wrongIndex,
                0
            );
        }


        brain.setPlasticityParams({

            eta: 0,

            tauTrace: 40,

            tauDopa: 1e7,

            gainMin: 0.05,

            gainMax: 2
        });
    }


    // ========================================================
    // 1回の練習
    // ========================================================

    function practise(
        expr,
        prefix,
        correctAction
    ) {

        const seen =
            look(
                expr,
                prefix
            );


        const decision =
            decide(
                seen.drive
            );


        const correctIndex =
            ACTIONS.indexOf(
                correctAction
            );


        if (
            correctIndex === -1
        ) {

            throw new Error(
                `Unknown action: ${correctAction}`
            );
        }


        const ok =
            decision.index
            ===
            correctIndex;


        // 正解・不正解に関係なく、
        // 正しい行動をドーパミンで学習する
        feedback(
            correctIndex,
            decision.index
        );


        return {

            ok,

            predicted:
                decision.action,

            correct:
                correctAction,

            activeKC:
                seen.activeKC,

            margin:
                decision.margin
        };
    }


    // ========================================================
    // 外から使うもの
    // ========================================================

    return {

        brain,

        KC,

        MBON,

        ALPN,

        ACTIONS,

        actionGroups,

        look,

        decide,

        feedback,

        practise,


        exportGains:
            () =>
                brain.exportGains(),


        importGains:
            gains =>
                brain.importGains(
                    gains
                ),


        forget:
            () =>
                brain.forget()
    };
}