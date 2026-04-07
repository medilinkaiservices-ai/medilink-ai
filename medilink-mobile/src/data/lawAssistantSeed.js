export const launcherApps = [
  {
    id: "cases",
    title: "Cases",
    subtitle: "Pick a matter and continue from one place."
  },
  {
    id: "copilot",
    title: "Copilot",
    subtitle: "Ask for draft changes, strategy, and legal help."
  },
  {
    id: "research",
    title: "Research",
    subtitle: "Judgments, citations, authorities, and arguments."
  },
  {
    id: "summary",
    title: "Final Summary",
    subtitle: "Validation, filing pack, and final reports."
  }
];

export const seededMatters = [
  {
    id: "m1",
    title: "Cheque Bounce Recovery",
    client: "Satheesh Kotha",
    stage: "Research & Draft",
    status: "Draft ready",
    profile: {
      phone: "+91 99999 99999",
      location: "Hyderabad",
      note: "Business owner seeking cheque amount recovery."
    },
    caseDetails: {
      type: "Cheque Bounce",
      court: "Judicial Magistrate",
      nextDate: "12 Apr 2026",
      facts: "Cheque dishonoured for insufficient funds. Statutory notice already issued within time.",
      documents: "Cheque copy, bank return memo, legal notice, postal receipt"
    },
    research: {
      issues: ["Notice compliance", "Limitation", "Vicarious liability of company signatory"],
      authorities: [
        {
          title: "Dashrath Rupsingh Rathod v. State of Maharashtra",
          court: "Supreme Court",
          judgmentDate: "2014-08-01",
          citation: "(2014) 9 SCC 129",
          proposition: "Territorial jurisdiction in Section 138 complaints depends on presentation and return mechanics, subject to later statutory amendments.",
          statutoryReferences: ["NI Act Section 138", "NI Act Section 142"],
          pinpointRef: "Paras 14-19",
          confidenceScore: 0.84,
          reviewPriority: "high",
          requiresReview: true,
          sourceUrl: "https://www.sci.gov.in",
          whyItMatters: "Useful for jurisdiction framing, but verify against later amendment-driven position."
        },
        {
          title: "NI Act Section 141 support",
          court: "Statutory Support",
          proposition: "Company signatory liability must be linked with clear averments about role and responsibility.",
          statutoryReferences: ["NI Act Section 141"],
          confidenceScore: 0.72,
          reviewPriority: "normal",
          whyItMatters: "Supports vicarious liability pleading for company cheque matters."
        }
      ],
      citations: [
        {
          title: "Primary cheque bounce citation",
          court: "Supreme Court",
          judgmentDate: "2014-08-01",
          citation: "(2014) 9 SCC 129",
          proposition: "Use only after checking post-amendment territorial jurisdiction position.",
          pinpointRef: "Para 18",
          confidenceScore: 0.81,
          reviewPriority: "high",
          requiresReview: true,
          sourceUrl: "https://www.sci.gov.in"
        },
        {
          title: "Latest cheque bounce update pack",
          court: "High Court / Supreme Court mix",
          proposition: "Verify latest parallel citations before insertion into complaint draft.",
          confidenceScore: 0.63,
          reviewPriority: "normal",
          sourceUrl: "https://main.sci.gov.in"
        }
      ],
      arguments: ["Presumption under NI Act favors complainant", "Dishonour memo and notice timeline are documented"]
    },
    finalSummary: {
      draftStatus: "Initial AI draft ready",
      validation: "2 improvements suggested",
      filingPack: "Notice annexures pending final review"
    }
  },
  {
    id: "m2",
    title: "Property Injunction Matter",
    client: "Anitha Devi",
    stage: "Intake",
    status: "Client facts pending",
    profile: {
      phone: "+91 88888 22222",
      location: "Vijayawada",
      note: "Family property possession dispute."
    },
    caseDetails: {
      type: "Property Injunction",
      court: "Senior Civil Judge",
      nextDate: "Not scheduled",
      facts: "Client alleges interference with peaceful possession of ancestral property.",
      documents: "Sale deeds, tax receipts, possession photos"
    },
    research: {
      issues: ["Possession proof", "Prima facie case", "Balance of convenience"],
      authorities: [
        {
          title: "Dalpat Kumar v. Prahlad Singh",
          court: "Supreme Court",
          judgmentDate: "1992-01-01",
          citation: "(1992) 1 SCC 719",
          proposition: "Temporary injunction requires prima facie case, balance of convenience, and irreparable injury.",
          statutoryReferences: ["Order XXXIX Rule 1 CPC", "Order XXXIX Rule 2 CPC"],
          pinpointRef: "Paras 4-5",
          confidenceScore: 0.93,
          reviewPriority: "normal",
          sourceUrl: "https://www.sci.gov.in",
          whyItMatters: "Core injunction test authority for interim relief."
        },
        {
          title: "Specific Relief Act Sections 37 and 38",
          court: "Statutory Support",
          proposition: "Permanent and temporary injunction relief should align with possession and threatened interference facts.",
          statutoryReferences: ["Specific Relief Act Section 37", "Specific Relief Act Section 38"],
          confidenceScore: 0.79,
          reviewPriority: "normal",
          whyItMatters: "Anchors relief clause and injunction framing."
        }
      ],
      citations: [
        {
          title: "Order XXXIX Rule 1 and 2 CPC",
          court: "Civil Procedure Code",
          proposition: "Supports immediate interim protection pending final adjudication.",
          statutoryReferences: ["Order XXXIX Rule 1 CPC", "Order XXXIX Rule 2 CPC"],
          confidenceScore: 0.9,
          reviewPriority: "normal",
          pinpointRef: "Interim injunction gateway"
        }
      ],
      arguments: ["Urgent interim protection required", "Irreparable loss if interference continues"]
    },
    finalSummary: {
      draftStatus: "Draft pending",
      validation: "Awaiting intake completion",
      filingPack: "No pack yet"
    }
  },
  {
    id: "m3",
    title: "Consumer Refund Notice",
    client: "Raghava Traders",
    stage: "Final Summary",
    status: "Validation required",
    profile: {
      phone: "+91 77777 11111",
      location: "Bengaluru",
      note: "Delayed supply and refund demand matter."
    },
    caseDetails: {
      type: "Consumer Refund",
      court: "Consumer Commission",
      nextDate: "16 Apr 2026",
      facts: "Advance paid but goods not supplied; repeated follow-ups ignored.",
      documents: "Invoices, payment proof, chat transcripts"
    },
    research: {
      issues: ["Deficiency in service", "Refund with interest", "Compensation"],
      authorities: [
        {
          title: "Consumer Protection Act, 2019",
          court: "Statutory Support",
          proposition: "Deficiency in service includes failure to supply after receiving consideration.",
          statutoryReferences: ["Consumer Protection Act, 2019"],
          confidenceScore: 0.76,
          reviewPriority: "normal",
          whyItMatters: "Primary statutory footing for refund and compensation demand."
        },
        {
          title: "Refund and compensation precedent line",
          court: "Consumer Commission",
          proposition: "Delay, non-supply, and hardship can justify refund with interest and compensation.",
          confidenceScore: 0.68,
          reviewPriority: "normal",
          sourceUrl: "https://confonet.nic.in"
        }
      ],
      citations: [
        {
          title: "Consumer forum refund support",
          court: "Consumer Commission",
          proposition: "Use a clean refund-with-interest citation set before final notice export.",
          confidenceScore: 0.66,
          reviewPriority: "normal",
          sourceUrl: "https://confonet.nic.in"
        }
      ],
      arguments: ["Repeated non-performance amounts to deficiency", "Compensation claim supported by delay and hardship"]
    },
    finalSummary: {
      draftStatus: "Demand notice revised",
      validation: "Ready with minor polishing",
      filingPack: "Export summary available"
    }
  }
];

export const caseShortcuts = [
  { id: "profile", label: "Profile" },
  { id: "case-details", label: "Case Details" },
  { id: "research", label: "Research" },
  { id: "final-summary", label: "Final Summary" }
];
