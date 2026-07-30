import type { Suggestion } from "./types";

// ── Local entity index ───────────────────────────────────────────────────────
// The typeahead's floor. A live lookup is better — it carries a real ticker and
// sector — but it is a network call against a metered, token-gated endpoint, and
// a suggestion list that arrives after the user has typed the next character has
// already failed at its job.
//
// So the box answers from this list INSTANTLY, every time, and the live results
// replace it a moment later when they arrive. That inversion is the whole fix:
// the network is now an enhancement rather than a dependency, and an expired
// token degrades the answer instead of stalling the field.
//
// Deliberately broad rather than exhaustive: the large listed names a governance
// pre-screen actually gets pointed at. Anything not here still runs — the field
// never blocks what was typed.

export const SEED_COMPANIES: string[] = [
  // Energy, resources, infrastructure
  "Reliance Industries", "Adani Enterprises", "Adani Ports and Special Economic Zone",
  "Adani Green Energy", "Adani Power", "Adani Total Gas", "Adani Energy Solutions",
  "Adani Wilmar", "Indian Oil Corporation", "Bharat Petroleum Corporation",
  "Hindustan Petroleum Corporation", "Oil and Natural Gas Corporation", "GAIL India",
  "NTPC", "Power Grid Corporation of India", "Tata Power", "JSW Energy", "Torrent Power",
  "Vedanta", "Hindalco Industries", "Hindustan Zinc", "Coal India", "NMDC",
  "Tata Steel", "JSW Steel", "Steel Authority of India", "Jindal Steel and Power",
  "Larsen & Toubro", "GMR Airports Infrastructure", "IRB Infrastructure Developers",
  "Container Corporation of India", "Indian Railway Catering and Tourism Corporation",

  // Technology
  "Tata Consultancy Services", "Infosys", "Wipro", "HCL Technologies", "Tech Mahindra",
  "LTIMindtree", "Mphasis", "Persistent Systems", "Coforge", "Oracle Financial Services Software",
  "Zoho Corporation", "Zomato", "Swiggy", "Paytm", "One97 Communications", "Nykaa",
  "PB Fintech", "Info Edge India", "IndiaMART InterMESH", "Delhivery", "Ola Electric Mobility",
  "Tata Elxsi", "KPIT Technologies", "Cyient", "Sonata Software", "Happiest Minds Technologies",

  // Banking & financial services
  "HDFC Bank", "ICICI Bank", "State Bank of India", "Axis Bank", "Kotak Mahindra Bank",
  "IndusInd Bank", "Yes Bank", "IDFC First Bank", "Bank of Baroda", "Punjab National Bank",
  "Canara Bank", "Union Bank of India", "Bank of India", "Federal Bank", "RBL Bank",
  "AU Small Finance Bank", "Bandhan Bank", "Bajaj Finance", "Bajaj Finserv",
  "Shriram Finance", "Cholamandalam Investment and Finance", "Muthoot Finance",
  "Power Finance Corporation", "REC", "LIC Housing Finance", "Life Insurance Corporation of India",
  "SBI Life Insurance", "HDFC Life Insurance", "ICICI Prudential Life Insurance",
  "ICICI Lombard General Insurance", "Jio Financial Services", "Indian Renewable Energy Development Agency",

  // Consumer, retail, pharma, auto, industrials
  "Hindustan Unilever", "ITC", "Nestle India", "Britannia Industries", "Dabur India",
  "Marico", "Godrej Consumer Products", "Tata Consumer Products", "Varun Beverages",
  "United Spirits", "Asian Paints", "Berger Paints India", "Pidilite Industries",
  "Avenue Supermarts", "Trent", "Titan Company", "Page Industries",
  "Sun Pharmaceutical Industries", "Dr Reddys Laboratories", "Cipla", "Divis Laboratories",
  "Lupin", "Aurobindo Pharma", "Torrent Pharmaceuticals", "Zydus Lifesciences",
  "Alkem Laboratories", "Mankind Pharma", "Apollo Hospitals Enterprise",
  "Max Healthcare Institute", "Fortis Healthcare",
  "Maruti Suzuki India", "Tata Motors", "Mahindra & Mahindra", "Bajaj Auto", "Hero MotoCorp",
  "Eicher Motors", "TVS Motor Company", "Ashok Leyland", "Bharat Forge", "Motherson Sumi Wiring India",
  "Bharti Airtel", "Vodafone Idea", "Indus Towers", "Bharti Hexacom",
  "UltraTech Cement", "Ambuja Cements", "ACC", "Shree Cement", "Dalmia Bharat", "JK Cement",
  "Grasim Industries", "Aditya Birla Fashion and Retail", "Siemens India", "ABB India",
  "Bharat Electronics", "Hindustan Aeronautics", "Bharat Dynamics", "Mazagon Dock Shipbuilders",
  "Cummins India", "Havells India", "Voltas", "Blue Star", "Polycab India", "KEI Industries",
  "InterGlobe Aviation", "SpiceJet", "DLF", "Godrej Properties", "Oberoi Realty",
  "Macrotech Developers", "Prestige Estates Projects", "Phoenix Mills",
  "UPL", "PI Industries", "Coromandel International", "Chambal Fertilisers and Chemicals",
  "SRF", "Deepak Nitrite", "Tata Chemicals", "Aarti Industries",
];

export const SEED_DIRECTORS: string[] = [
  "Mukesh Ambani", "Gautam Adani", "Anand Mahindra", "Uday Kotak", "Kumar Mangalam Birla",
  "Azim Premji", "N. R. Narayana Murthy", "Nandan Nilekani", "Ratan Tata", "Natarajan Chandrasekaran",
  "Sunil Bharti Mittal", "Anil Agarwal", "Shiv Nadar", "Radhakishan Damani", "Dilip Shanghvi",
  "Pawan Munjal", "Venu Srinivasan", "Sajjan Jindal", "Naveen Jindal", "Rajiv Bajaj",
  "Sanjiv Bajaj", "Abhay Soi", "Karan Adani", "Akash Ambani", "Isha Ambani",
  "Roshni Nadar Malhotra", "Falguni Nayar", "Byju Raveendran", "Ritesh Agarwal", "Bhavish Aggarwal",
  "Deepinder Goyal", "Vijay Shekhar Sharma", "Nithin Kamath", "Nikhil Kamath", "Harsh Mariwala",
  "Rishad Premji", "Salil Parekh", "Sandeep Bakhshi", "Sashidhar Jagdishan", "Amitabh Chaudhry",
];

/** Lower-cased, punctuation-flattened form for matching. */
function norm(s: string): string {
  return s.toLowerCase().replace(/[.,&'"()-]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Rank a local match. A name that STARTS with what was typed is what the user
 * meant far more often than one that merely contains it — "na" should offer
 * Nayar and Nadar before Bajaj Finance — and a word-start match sits between the
 * two. Shorter names break ties, so the plain company beats its subsidiary.
 */
function score(name: string, q: string): number {
  const n = norm(name);
  if (!n.includes(q)) return -1;
  if (n.startsWith(q)) return 100 - Math.min(name.length, 60);
  // Any word in the name starting with the query.
  if (n.split(" ").some((w) => w.startsWith(q))) return 60 - Math.min(name.length, 40);
  return 20 - Math.min(name.length, 15);
}

/** Ranked local matches for a typed fragment. Never throws, never blocks. */
export function matchLocal(pool: string[], query: string, limit = 6): Suggestion[] {
  const q = norm(query);
  if (!q) return [];
  return pool
    .map((name) => ({ name, s: score(name, q) }))
    .filter((r) => r.s >= 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((r) => ({ value: r.name, label: r.name }));
}
