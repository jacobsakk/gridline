// Schools that our sources spell several ways, shown ONE way everywhere:
// "Miami (OH)" and "UMass". Stored data keeps whatever spelling its source
// used (saved watch list / portal entries are keyed by it); this is applied
// when data is read or displayed.
const SPELLINGS = [
  {
    display: "UMass",
    keys: ["umass", "u mass", "massachusetts", "university of massachusetts", "umass amherst", "massachusetts amherst", "university of massachusetts amherst"],
  },
  {
    display: "Miami (OH)",
    keys: ["miami oh", "miami ohio", "miami university", "miami university oh", "miami university ohio", "miami of ohio", "miami university of ohio"],
  },
];

const BY_KEY = new Map(SPELLINGS.flatMap((s) => s.keys.map((k) => [k, s.display])));

// Exact-name matches only: "UMass Dartmouth", "Mass. Maritime" and Miami (FL)
// are different schools and pass through untouched.
export function canonicalSchool(name) {
  const key = (name || "").toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
  return BY_KEY.get(key) || name;
}

// Title-casing "MIAMI (OH)" / "UMASS" would give "Miami (Oh)" / "Umass".
export function fixBrandCase(text) {
  return (text || "").replace(/\bUmass\b/g, "UMass").replace(/\(([A-Za-z]{2})\)/g, (_, code) => `(${code.toUpperCase()})`);
}
