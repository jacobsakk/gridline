// County-level US map data: the boundaries themselves (a static TopoJSON file, converted to GeoJSON on
// first use), plus the state lookup table needed to group counties by state and label them.
import { feature } from "topojson-client";

// The 50 states + DC, by their 2-digit Census FIPS code (the first two digits of every county's 5-digit
// FIPS id). Territories in the underlying map data (PR, GU, VI, AS, MP) are left out of this table on
// purpose -- they're filtered out wherever this table is used to decide what counts as a "state."
export const STATE_FIPS = {
  "01": { abbr: "AL", name: "Alabama" },
  "02": { abbr: "AK", name: "Alaska" },
  "04": { abbr: "AZ", name: "Arizona" },
  "05": { abbr: "AR", name: "Arkansas" },
  "06": { abbr: "CA", name: "California" },
  "08": { abbr: "CO", name: "Colorado" },
  "09": { abbr: "CT", name: "Connecticut" },
  "10": { abbr: "DE", name: "Delaware" },
  "11": { abbr: "DC", name: "District of Columbia" },
  "12": { abbr: "FL", name: "Florida" },
  "13": { abbr: "GA", name: "Georgia" },
  "15": { abbr: "HI", name: "Hawaii" },
  "16": { abbr: "ID", name: "Idaho" },
  "17": { abbr: "IL", name: "Illinois" },
  "18": { abbr: "IN", name: "Indiana" },
  "19": { abbr: "IA", name: "Iowa" },
  "20": { abbr: "KS", name: "Kansas" },
  "21": { abbr: "KY", name: "Kentucky" },
  "22": { abbr: "LA", name: "Louisiana" },
  "23": { abbr: "ME", name: "Maine" },
  "24": { abbr: "MD", name: "Maryland" },
  "25": { abbr: "MA", name: "Massachusetts" },
  "26": { abbr: "MI", name: "Michigan" },
  "27": { abbr: "MN", name: "Minnesota" },
  "28": { abbr: "MS", name: "Mississippi" },
  "29": { abbr: "MO", name: "Missouri" },
  "30": { abbr: "MT", name: "Montana" },
  "31": { abbr: "NE", name: "Nebraska" },
  "32": { abbr: "NV", name: "Nevada" },
  "33": { abbr: "NH", name: "New Hampshire" },
  "34": { abbr: "NJ", name: "New Jersey" },
  "35": { abbr: "NM", name: "New Mexico" },
  "36": { abbr: "NY", name: "New York" },
  "37": { abbr: "NC", name: "North Carolina" },
  "38": { abbr: "ND", name: "North Dakota" },
  "39": { abbr: "OH", name: "Ohio" },
  "40": { abbr: "OK", name: "Oklahoma" },
  "41": { abbr: "OR", name: "Oregon" },
  "42": { abbr: "PA", name: "Pennsylvania" },
  "44": { abbr: "RI", name: "Rhode Island" },
  "45": { abbr: "SC", name: "South Carolina" },
  "46": { abbr: "SD", name: "South Dakota" },
  "47": { abbr: "TN", name: "Tennessee" },
  "48": { abbr: "TX", name: "Texas" },
  "49": { abbr: "UT", name: "Utah" },
  "50": { abbr: "VT", name: "Vermont" },
  "51": { abbr: "VA", name: "Virginia" },
  "53": { abbr: "WA", name: "Washington" },
  "54": { abbr: "WV", name: "West Virginia" },
  "55": { abbr: "WI", name: "Wisconsin" },
  "56": { abbr: "WY", name: "Wyoming" },
};
export const STATE_LIST = Object.entries(STATE_FIPS)
  .map(([fips, s]) => ({ fips, ...s }))
  .sort((a, b) => a.name.localeCompare(b.name));
export const ABBR_TO_FIPS = Object.fromEntries(Object.entries(STATE_FIPS).map(([fips, s]) => [s.abbr, fips]));

let loading = null;
// Loads the county/state boundaries once and converts them from TopoJSON to plain GeoJSON. Counties outside
// the 50 states + DC (Puerto Rico and the other territories) are dropped -- this app's coaches don't cover
// them, and the state sidebar has nothing to group them under.
export function loadCountyMap() {
  loading ||= import("./data/us-counties-10m.json").then((m) => {
    const topo = m.default;
    const counties = feature(topo, topo.objects.counties).features.filter((f) => STATE_FIPS[f.id.slice(0, 2)]);
    const states = feature(topo, topo.objects.states).features.filter((f) => STATE_FIPS[f.id]);
    counties.forEach((f) => {
      f.properties.stateFips = f.id.slice(0, 2);
      f.properties.stateAbbr = STATE_FIPS[f.properties.stateFips]?.abbr || "";
    });
    const byState = {};
    counties.forEach((f) => {
      (byState[f.properties.stateFips] ||= []).push(f);
    });
    Object.values(byState).forEach((list) => list.sort((a, b) => a.properties.name.localeCompare(b.properties.name)));
    return { counties, states, byState };
  });
  return loading;
}
