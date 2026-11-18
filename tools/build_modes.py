"""Regenerate modes-data.js (data for the Quote, Spell, Potion, Description and Location modes).

Usage: python3 tools/build_modes.py

Sources:
  tools/data/spells.json  from theDavidBarton/the-harry-potter-database (MIT)
  tools/potions.source.json       {"name", "book", "d"}           potions from the books, hand-written clues
  tools/quotes.source.json        {"q", "who", "book"}            who = a character name from characters.source.json
  tools/descriptions.source.json  {"who", "job", "d"}             book comes from the character's First book
  tools/locations.source.json     {"name", "book", "area", "d"}
"""
import json, pathlib, re, sys

root = pathlib.Path(__file__).resolve().parent.parent
tools = root / "tools"
load = lambda p: json.loads((tools / p).read_text())

chars = {}
for c in load("characters.source.json"):
    full = " ".join(c["name"])
    chars[full] = c
    # Also accept the name without its (alias), e.g. "Sirius Black" for "Sirius Black (Padfoot)".
    chars.setdefault(re.sub(r"\s*\(.*?\)", "", full).strip(), c)
full_name = lambda who: " ".join(chars[who]["name"])

# Spells that show up in the books or are widely known. These can be the answer;
# every spell with a description can still be guessed.
FAMOUS_SPELLS = """Accio Aguamenti Alohomora Anapneo Aparecium Ascendio Avis Bombarda Brackium Emendo Colloportus
Confringo Confundo Crucio Defodio Deletrius Densaugeo Deprimo Depulso Descendo Diffindo Dissendium Duro Engorgio
Episkey Erecto Evanesco Expecto Patronum Expelliarmus Expulso Ferula Fidelius Charm Fiendfyre Finite Incantatem
Flagrate Furnunculus Geminio Glisseo Homenum Revelio Impedimenta Imperio Impervius Incarcerous Incendio Langlock
Levicorpus Liberacorpus Locomotor Locomotor Wibbly Locomotor Mortis Lumos Mobiliarbus Mobilicorpus Morsmordre
Muffliato Nox Obliviate Oppugno Orchideous Petrificus Totalus Piertotum Locomotor Point Me Portus Prior Incantato
Protego Protego Horribilis Protego Maxima Protego totalum Quietus Reducio Reducto Relashio Rennervate Reparo
Repello Muggletum Rictusempra Riddikulus Salvio Hexia Scourgify Sectumsempra Serpensortia Silencio Sonorus
Specialis Revelio Stupefy Tarantallegra Tergeo Unbreakable Vow Vipera Evanesca Waddiwasi Wingardium Leviosa
Apparition Disillusionment Charm Taboo Age Line Imperturbable Charm Bat-Bogey Hex Cave inimicum Repello Inimicum
Anti-Disapparition Jinx Sonorous Charm Bubble-Head Charm Cheering Charm Hover Charm Permanent Sticking Charm
Mimblewimble Avenseguim Cribbing Spell Horcrux-making spell Obscuro Oculus Reparo Partis Temporus"""
WORD = re.compile(r"[A-Za-z][A-Za-z'-]+")


def famous_spell_names(all_names):
    text = " " + " ".join(FAMOUS_SPELLS.split()) + " "
    # Longest names first so "Protego Maxima" wins over "Protego".
    out = set()
    for n in sorted(all_names, key=len, reverse=True):
        if f" {n} " in text:
            out.add(n)
            text = text.replace(f" {n} ", " ")
    return out


def redact(text, names):
    """Hide the answer's own words (and close variants) in a clue."""
    if not text:
        return text
    words = set()
    for n in names:
        if not n:
            continue
        for w in WORD.findall(n):
            if len(w) >= 4 and w.lower() not in {"spell", "charm", "curse", "jinx", "hex", "potion", "draught", "solution", "elixir", "essence", "with", "that", "from"}:
                words.add(w.lower())
    for w in sorted(words, key=len, reverse=True):
        stem = re.escape(w[:-1] if len(w) > 5 else w)
        text = re.sub(rf"\b{stem}\w*", "▁▁▁", text, flags=re.I)
    return text


def tidy(s, limit=420):
    if not s:
        return ""
    s = re.sub(r"\s+", " ", s).strip()
    if len(s) <= limit:
        return s
    cut = s[:limit]
    end = max(cut.rfind(". "), cut.rfind("; "))
    return (cut[: end + 1] if end > 120 else cut.rsplit(" ", 1)[0] + "…").strip()


overrides = load("clue_overrides.json")
BLANK = "▁▁▁"
NOT_FAMOUS = {"Sonorous Charm", "Cribbing Spell", "Avenseguim", "Repello Inimicum"}


def clue(kind, name, text, names):
    """A hand-written clue if we have one, else the database text with the answer hidden.
    Returns (clue, usable): a clue that had to hide words reads badly, so it's never the answer."""
    if name in overrides.get(kind, {}):
        return overrides[kind][name], True
    text = re.split(r"\s*Seen/Mentioned:", text or "")[0]
    out = redact(tidy(text), names)
    return out, BLANK not in out


spells = []
# Spells named in plain English ("Hover Charm", "Teapot to tortoise") say what they do, so the clue
# gives them away. Only incantations are kept (user request 2026-11-18).
DESCRIPTIVE_WORDS = {"charm", "jinx", "hex", "curse", "spell", "line", "vow", "sparks", "flames", "fog", "quill",
                     "torture", "snowballs", "firecrackers", "fire", "flight"}
KEEP_NAMED = {"Fidelius Charm", "Protean Charm", "Homorphus Charm", "Homonculous Charm", "Flagrante Curse"}
DROP_NAMED = {"Apparition", "Point Me", "Pack", "Taboo", "Badgering", "Cauldron to Sieve", "Cauldron to badger",
              "Ears to kumquats", "Firestorm", "Desk Into Pig", "Ferret to human", "Rose Growth"}


def says_what_it_does(name):
    if name in KEEP_NAMED:
        return False
    if name in DROP_NAMED:
        return True
    return any(w.lower() in DESCRIPTIVE_WORDS for w in re.findall(r"[A-Za-z]+", name))


src = [s for s in load("data/spells.json")
       if s.get("description") and not s["name"].startswith("Type:") and not says_what_it_does(s["name"])]
famous = famous_spell_names([s["name"] for s in src])
for s in src:
    names = [s["name"], s.get("other_name")]
    d, usable = clue("spells", s["name"], s["description"], names)
    hint = redact(tidy(s.get("mention") or "", 300), names)
    spells.append({
        "name": s["name"],
        "alt": s.get("other_name") or "",
        "type": s.get("spell_type") or "Spell",
        "d": d,
        "hint": "" if BLANK in hint else hint,
        "famous": s["name"] in famous and usable and s["name"] not in NOT_FAMOUS,
        "pickable": usable,
    })

# Potions: only ones from the seven books, with hand-written clues (tools/potions.source.json).
potions = []
for p in load("potions.source.json"):
    if not (1 <= p["book"] <= 7):
        sys.exit(f"potion {p['name']}: bad book")
    potions.append({"name": p["name"], "alt": p.get("alt", ""), "d": p["d"], "book": p["book"], "famous": True, "pickable": True})

def need_char(who, where):
    if who not in chars:
        sys.exit(f"{where}: '{who}' is not in characters.source.json")
    return full_name(who)

quotes = [{"q": q["q"], "who": need_char(q["who"], "quotes"), "book": q["book"]} for q in load("quotes.source.json")]
for q in quotes:
    # A quote that says the speaker's own name gives the answer away.
    parts = [w for w in re.findall(r"[A-Za-z]{3,}", q["who"]) if w.lower() not in {"the", "sir", "jr", "sr", "mrs"}]
    if any(re.search(rf"\b{w}\b", q["q"], re.I) for w in parts):
        sys.exit(f"quote names its own speaker ({q['who']}): {q['q']}")
descriptions = [
    {"who": need_char(d["who"], "descriptions"), "job": d["job"], "d": d["d"], "book": chars[d["who"]]["book"]}
    for d in load("descriptions.source.json")
]
locations = load("locations.source.json")
for l in locations:
    if not (1 <= l["book"] <= 7):
        sys.exit(f"location {l['name']}: bad book")

data = {"spells": spells, "potions": potions, "quotes": quotes, "descriptions": descriptions, "locations": locations}
js = "// Generated by tools/build_modes.py — edit the tools/*.source.json files instead.\nwindow.MODES = " + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n"
(root / "modes-data.js").write_text(js)
print(f"spells {len(spells)} ({sum(s['famous'] for s in spells)} famous), potions {len(potions)} ({sum(p['famous'] for p in potions)} famous), "
      f"quotes {len(quotes)}, descriptions {len(descriptions)}, locations {len(locations)}")
