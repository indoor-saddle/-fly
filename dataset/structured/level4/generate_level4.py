
import json
from pathlib import Path
import sympy as sp

x = sp.Symbol("x")

BASE = Path(__file__).resolve().parent


# ==========================================
# SymPyで正解を生成
# ==========================================

def make_problem(n):
    expression = x**n
    derivative = sp.diff(expression, x)

    return {
        "expr": f"x^{n}",
        "coefficient": 1,
        "exponent": n,
        "answer": str(derivative).replace("**", "^")
    }


# ==========================================
# 1キーずつに分解
# ==========================================

def make_steps(problem):
    expr = problem["expr"]
    answer = problem["answer"]

    steps = []

    for i, key in enumerate(answer):
        steps.append({
            "expr": expr,
            "prefix": answer[:i],
            "next": key
        })

    steps.append({
        "expr": expr,
        "prefix": answer,
        "next": "END"
    })

    return steps


# ==========================================
# JSONL保存
# ==========================================

def save_jsonl(path, rows):
    with path.open("w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")


def create_dataset(name, exponents):
    problems = [make_problem(n) for n in exponents]

    steps = []
    for problem in problems:
        steps.extend(make_steps(problem))

    save_jsonl(BASE / f"{name}.jsonl", problems)
    save_jsonl(BASE / f"{name}_steps.jsonl", steps)

    print(f"\n{name}: {len(problems)} problems, {len(steps)} steps")

    for problem in problems:
        print(f'  {problem["expr"]} -> {problem["answer"]}')


# ==========================================
# Level 4
# ==========================================

# 学習：指数2〜6
create_dataset("train", range(2, 7))

# 検証：未知の指数7
create_dataset("validation", [7])

# 最終テスト：未知の指数8
create_dataset("test", [8])

print("\nLevel 4 dataset completed!")
