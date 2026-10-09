# -*- coding: utf-8 -*-
"""Chuyen sheet '1.Duration & He so' trong Excel mau thanh data/wbs-template.json
Chay: python scripts/build-template.py "<duong dan file xlsx>"
"""
import sys, json, re, os, warnings
import openpyxl
from openpyxl.utils import column_index_from_string as ci
warnings.filterwarnings("ignore")

SRC = sys.argv[1] if len(sys.argv) > 1 else r"..\Project MTL\2. TIEN DO & CAU TRUC DATA_01102026.xlsx"
OUT = os.path.join(os.path.dirname(__file__), "..", "data", "wbs-template.json")

wb = openpyxl.load_workbook(SRC, data_only=True)
ws = wb["1.Duration & He so"]

def v(r, c):
    x = ws.cell(r, ci(c)).value
    return None if x in (None, "") else x

def num(r, c):
    x = v(r, c)
    return float(x) if isinstance(x, (int, float)) else None

def arr(r, cols):
    return [num(r, c) for c in cols]

HM = {"Q": "san_lap", "R": "xu_ly_nen", "S": "htkt", "T": "ke", "U": "coc", "V": "nha_thap_tang",
      "W": "nha_cao_tang", "X": "tien_ich", "Y": "canh_quan", "Z": "tram_dien", "AA": "tram_xlnt"}
WBS_PREFIX = re.compile(r"^\s*(\d+(?:\.\d+)+)\s+(.*)$")

tasks = []
for r in range(5, ws.max_row + 1):
    code = v(r, "C")
    if code is None:
        continue
    code = str(code).strip()
    raw = str(v(r, "D") or "").strip()
    m = WBS_PREFIX.match(raw)
    wbs, name = (m.group(1), m.group(2)) if m else (code, raw)
    parent = ".".join(code.split(".")[:-1]) or None
    loai = v(r, "F")
    pred = v(r, "H")
    t = {
        "code": code, "wbs": wbs, "name": name, "level": int(v(r, "B") or code.count(".") + 1),
        "parent": parent, "ban": v(r, "E"),
        "kind": "periodic" if loai == "Báo cáo định kỳ" else ("task" if loai else "summary"),
        "pred": ({"code": str(pred).strip(), "rel": v(r, "I") or "FS"} if pred else None),
        "buffer": num(r, "J"), "maxDays": num(r, "K"),
        "applies": {"low": v(r, "AB") == "Có", "high": v(r, "AM") == "Có", "hotel": v(r, "AW") == "Có"},
        "base": {"low": num(r, "AC"), "high": num(r, "AN"), "hotel": num(r, "AX")},
        "coef": {
            "low": {"land": arr(r, ["AD", "AE", "AF"]), "qty": arr(r, ["AG", "AH", "AI"]), "std": arr(r, ["AJ", "AK", "AL"])},
            "high": {"land": arr(r, ["AO", "AP"]), "floors": arr(r, ["AQ", "AR", "AS"]), "std": arr(r, ["AT", "AU", "AV"])},
            "hotel": {"land": arr(r, ["AY", "AZ"]), "rooms": arr(r, ["BA", "BB", "BC"]), "std": arr(r, ["BD"])},
        },
        "hangmuc": [k for c, k in HM.items() if v(r, c) is not None],
    }
    tasks.append(t)

# bo he so rong de file gon
def prune(d):
    if isinstance(d, dict):
        out = {k: prune(x) for k, x in d.items()}
        return {k: x for k, x in out.items() if x not in (None, [], {}) and not (isinstance(x, list) and all(i is None for i in x))}
    return d
tasks = [prune(t) for t in tasks]

os.makedirs(os.path.dirname(OUT), exist_ok=True)
json.dump({"source": os.path.basename(SRC), "sheet": "1.Duration & He so", "count": len(tasks), "tasks": tasks},
          open(OUT, "w", encoding="utf-8"), ensure_ascii=False)
print("OK", len(tasks), "task ->", OUT, "| kich thuoc", os.path.getsize(OUT) // 1024, "KB")
