# -*- coding: utf-8 -*-
"""Cap nhat cau truc Ban CUDT (nhanh 5) va Phong QSB (nhanh 6) theo file mpp 'NVLG-PMD-SOP06.F01 MAU LAP MTL (CAP NHAT) - 7.10.2026'.
File mpp chi co CAU TRUC (moi tac vu 1 ngay, khong co lien ket) nen thoi luong/lien ket cua tac vu moi la GIA DINH DEMO (ghi trong README).
Chay: python scripts/update-template-5-6.py
"""
import json, os, re
HERE = os.path.dirname(__file__)
TPL = os.path.join(HERE, "..", "data", "wbs-template.json")
SRC = os.path.join(HERE, "mpp-7-10-2026-ban-5-6.json")
tpl = json.load(open(TPL, encoding="utf-8"))
nodes = json.load(open(SRC, encoding="utf-8"))
top = lambda c: c.split(".")[0]
WBS = re.compile(r"^\s*(\d+(?:\.\d+)+)\s+(.*)$")

has_child = {n["ol"].rsplit(".", 1)[0] for n in nodes if "." in n["ol"]}
LEAF_RULE = {  # ten tac vu -> (so ngay co so, dem, ten tac vu tien nhiem trong cung nhom)
    "Chọn thầu và phát hành LOA": (30, 3, None),
    "Hoàn thành hợp đồng": (10, 1, "Chọn thầu và phát hành LOA"),
    "Hoàn thành tạm ứng": (7, 1, "Hoàn thành hợp đồng"),
}
new = []
by_ol = {}
for n in nodes:
    m = WBS.match(n["name"])
    wbs, name = (m.group(1), m.group(2).strip()) if m else (n["ol"], n["name"])
    code = n["ol"]
    parent = ".".join(code.split(".")[:-1]) or None
    summ = code in has_child
    t = {"code": code, "wbs": wbs, "name": name, "level": n["lvl"], "parent": parent,
         "ban": "PTC" if top(code) == "5" else "QSB", "kind": "summary" if summ else "task"}
    if parent is None: t["wbs"] = code
    if summ:
        t["applies"] = {"low": False, "high": False, "hotel": False}; t["base"] = {"low": 0.0, "high": 0.0}
    else:
        low = "cao tầng" not in name.lower() and "cao tầng" not in (by_ol.get(parent, {}).get("name", "").lower())
        high = "thấp tầng" not in name.lower() and "thấp tầng" not in (by_ol.get(parent, {}).get("name", "").lower())
        if name in LEAF_RULE: days, buf, _ = LEAF_RULE[name]
        elif top(code) == "5": days, buf = 30, 3.0   # Lap ke hoach CUDT
        else: days, buf = {"6.1": (10, 1.0), "6.2": (15, 2.0)}.get(code, (10, 1.0))
        t["applies"] = {"low": low, "high": high, "hotel": high}
        t["base"] = {"low": float(days), "high": float(days), "hotel": float(days)}
        t["buffer"] = float(buf)
        t["pred"] = None
    by_ol[code] = t
    new.append(t)
# lien ket: 3 tac vu trong moi goi noi tiep nhau; BOQ A/B sau 6.2; 6.2 sau 6.1
for t in new:
    if t["kind"] != "task": continue
    if t["name"] in LEAF_RULE and LEAF_RULE[t["name"]][2]:
        sib = next(x for x in new if x["parent"] == t["parent"] and x["name"] == LEAF_RULE[t["name"]][2])
        t["pred"] = {"code": sib["code"], "rel": "FS"}
    elif t["code"] == "6.2": t["pred"] = {"code": "6.1", "rel": "FS"}
    elif t["parent"] == "6.3": t["pred"] = {"code": "6.2", "rel": "FS"}
    if t["pred"] is None: del t["pred"]
for t in new: t["assumed"] = True

old = tpl["tasks"]
i = next(k for k, x in enumerate(old) if top(x["code"]) == "5")
j = max(k for k, x in enumerate(old) if top(x["code"]) in ("5", "6"))
tpl["tasks"] = old[:i] + new + old[j + 1:]
tpl["count"] = len(tpl["tasks"])
tpl["structureUpdate"] = "Nhanh 5 (CUDT) va 6 (QSB) cap nhat theo mpp 7.10.2026 (cau truc); thoi luong/lien ket tac vu moi la gia dinh demo"
json.dump(tpl, open(TPL, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("old", len(old), "-> new", tpl["count"], "| thay", j - i + 1, "bang", len(new))
