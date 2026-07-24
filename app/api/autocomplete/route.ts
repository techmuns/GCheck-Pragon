import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// GET /api/autocomplete?q=&kind=company|promoter
// Phase 1: a small illustrative seed list. Phase 2 wires this to a real
// company/entity source so suggestions are source-backed.

const COMPANIES = [
  "Reliance Industries",
  "Tata Consultancy Services",
  "Adani Enterprises",
  "Infosys",
  "HDFC Bank",
  "Bharti Airtel",
  "Larsen & Toubro",
  "Bajaj Finance",
  "Wipro",
  "Mahindra & Mahindra",
];

const PROMOTERS = [
  "Mukesh Ambani",
  "Gautam Adani",
  "Anand Mahindra",
  "Uday Kotak",
  "Kumar Mangalam Birla",
  "Rahul Bajaj",
  "Azim Premji",
  "N. R. Narayana Murthy",
];

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().toLowerCase();
  const kind = req.nextUrl.searchParams.get("kind") === "promoter" ? "promoter" : "company";
  const pool = kind === "promoter" ? PROMOTERS : COMPANIES;

  if (!q) return NextResponse.json({ suggestions: [] });

  const suggestions = pool.filter((n) => n.toLowerCase().includes(q)).slice(0, 6);
  return NextResponse.json({ suggestions });
}
