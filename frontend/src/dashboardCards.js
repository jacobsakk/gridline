import { ClipboardList, ClipboardCheck, FileSpreadsheet, FlaskConical, GraduationCap, LayoutGrid, Trophy, Users } from "lucide-react";

// The main hub -- everything else is a card here rather than its own standalone page. This is the default
// order; each coach can rearrange it from Settings (see dashboardOrder.js).
export const CARDS = [
  {
    key: "tracker",
    label: "Pre-Portal Tracker",
    description: "Weekly stats across NAIA, JUCO, D3, D2, FCS and FBS",
    icon: ClipboardList,
  },
  {
    key: "offers",
    label: "Offer Tracker",
    description: "Offers by class year, conference and team, with position/area trends",
    icon: FileSpreadsheet,
  },
  {
    key: "colleges",
    label: "Colleges",
    description: "Every FBS and FCS team: standings, schedules, recruiting, rosters and depth charts",
    icon: GraduationCap,
  },
  {
    key: "hs",
    label: "Game Update",
    description: "Commits and targets: weekly results, records, area coach and game summaries (high school and JUCO)",
    icon: Trophy,
  },
  {
    key: "roster",
    label: "Roster Management",
    description: "Depth chart by years left, projections for future seasons, and the full roster spreadsheet",
    icon: Users,
  },
  {
    key: "studies",
    label: "Studies",
    description: "Ask for a data study on anything already in the site; the result shows up here as a spreadsheet",
    icon: FlaskConical,
  },
  {
    key: "bigboard",
    label: "Big Board",
    description: "Upload the staff's big board by class year (JUCO too) as a clean, editable, printable board, plus the credit evaluation",
    icon: LayoutGrid,
  },
  {
    key: "reports",
    label: "Reports",
    description: "Upload a picture of the evaluation list and see how many were assigned and completed by position, ready to print",
    icon: ClipboardCheck,
  },
];
