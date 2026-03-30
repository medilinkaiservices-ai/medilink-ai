const LEGAL_SYSTEM_PROMPTS = {
  public: "You are a helpful Indian legal assistant for common people. Explain in simple terms. Prefer current Indian law references, including BNS, BNSS, and BSA where relevant. Provide safe guidance. Always include disclaimer.",
  lawyer: "You are an expert legal assistant for Indian lawyers. Prefer current Indian law references, including BNS, BNSS, and BSA where relevant. Provide detailed legal analysis, structured drafts, relevant sections, and citations."
};

const LEGAL_CORPUS = [
  {
    id: "bns-303",
    type: "statute",
    title: "BNS Section 303 - Theft",
    citation: "Bharatiya Nyaya Sanhita, 2023 - Section 303",
    body: "Defines theft around dishonest taking of movable property without consent. Use this as a current criminal-law reference for theft issues after the new criminal laws came into force.",
    keywords: ["theft", "stolen", "property", "dishonest", "bns", "criminal law", "ipc 379", "section 379"]
  },
  {
    id: "bns-cheating",
    type: "statute",
    title: "BNS - Cheating and dishonestly inducing delivery of property",
    citation: "Bharatiya Nyaya Sanhita, 2023 - Cheating provisions",
    body: "Use the Bharatiya Nyaya Sanhita framework for cheating and fraud analysis. Focus on deception, dishonest inducement, delivery of property, and whether fraudulent intention existed from the beginning of the transaction.",
    keywords: ["cheating", "fraud", "money", "scam", "bns", "ipc 420", "section 420"]
  },
  {
    id: "bnss-173",
    type: "statute",
    title: "BNSS Section 173 - Information in cognizable cases",
    citation: "Bharatiya Nagarik Suraksha Sanhita, 2023 - Section 173",
    body: "Covers recording of information about cognizable offences, including oral and electronic reporting. It is the current starting-point provision for FIR-style police reporting under the new criminal procedure law.",
    keywords: ["fir", "police", "cognizable", "complaint", "bnss", "e-fir", "crpc 154", "section 154"]
  },
  {
    id: "bnss-175",
    type: "statute",
    title: "BNSS Section 175 - Police officer's power to investigate cognizable case",
    citation: "Bharatiya Nagarik Suraksha Sanhita, 2023 - Section 175",
    body: "Police may investigate cognizable offences without a Magistrate's prior order in the usual course. It is the current procedural reference when explaining police investigation powers under the new code.",
    keywords: ["investigation", "police", "magistrate", "bnss", "cognizable", "crpc 156", "section 156", "156(3)"]
  },
  {
    id: "bnss-zero-fir",
    type: "statute",
    title: "BNSS - e-FIR and zero-FIR style access improvements",
    citation: "Bharatiya Nagarik Suraksha Sanhita, 2023 - FIR access reforms",
    body: "The new criminal procedure framework is designed to support easier reporting, including electronic modes and location-flexible complaint handling in appropriate cases. Lawyers should still verify the exact operational rule and local implementation.",
    keywords: ["zero fir", "e-fir", "online complaint", "bnss", "police complaint", "jurisdiction"]
  },
  {
    id: "constitution-21",
    type: "constitution",
    title: "Article 21 - Protection of life and personal liberty",
    citation: "Constitution of India - Article 21",
    body: "No person shall be deprived of life or personal liberty except according to procedure established by law. Jurisprudence has expanded Article 21 to fairness, dignity and due process safeguards.",
    keywords: ["article 21", "life", "liberty", "fundamental rights"]
  },
  {
    id: "constitution-14",
    type: "constitution",
    title: "Article 14 - Equality before law",
    citation: "Constitution of India - Article 14",
    body: "The State shall not deny equality before law or equal protection of laws. Any classification must satisfy intelligible differentia and rational nexus tests.",
    keywords: ["article 14", "equality", "discrimination"]
  },
  {
    id: "lalita-kumari",
    type: "caseLaw",
    title: "Lalita Kumari v. Government of Uttar Pradesh",
    citation: "(2014) 2 SCC 1",
    body: "The Supreme Court held that FIR registration is mandatory when information discloses a cognizable offence, subject to limited preliminary inquiry categories. The principle remains relevant, though procedural citations should now be cross-checked against BNSS.",
    keywords: ["fir mandatory", "lalita kumari", "bnss 173", "police complaint"]
  },
  {
    id: "dk-basu",
    type: "caseLaw",
    title: "D.K. Basu v. State of West Bengal",
    citation: "(1997) 1 SCC 416",
    body: "The Court laid down guidelines to prevent custodial abuse and protect detainee rights, including arrest memo, relative intimation and medical examination safeguards.",
    keywords: ["custodial violence", "arrest", "human rights", "article 21"]
  },
  {
    id: "maneka-gandhi",
    type: "caseLaw",
    title: "Maneka Gandhi v. Union of India",
    citation: "(1978) 1 SCC 248",
    body: "Procedure under Article 21 must be just, fair and reasonable. Articles 14, 19 and 21 are interconnected in constitutional adjudication.",
    keywords: ["due process", "article 21", "fair procedure"]
  },
  {
    id: "consumer-protection",
    type: "statute",
    title: "Consumer Protection Act, 2019 - Deficiency of service",
    citation: "Consumer Protection Act, 2019",
    body: "Consumers can seek redress for defective goods, unfair trade practice and deficiency in service before consumer commissions with compensation claims.",
    keywords: ["consumer", "deficiency", "service", "refund", "compensation"]
  },
  {
    id: "it-act-electronic-records",
    type: "statute",
    title: "Electronic records and digital evidence",
    citation: "Information Technology Act, 2000 and Bharatiya Sakshya Adhiniyam, 2023",
    body: "For digital chats, emails, screenshots, and device records, lawyers should assess both substantive admissibility and proof of authenticity. Electronic records need careful preservation, metadata handling, and chain-of-custody thinking.",
    keywords: ["electronic evidence", "whatsapp", "email", "screenshot", "digital evidence", "bsa", "it act"]
  },
  {
    id: "domestic-violence",
    type: "statute",
    title: "Protection of Women from Domestic Violence Act, 2005",
    citation: "Protection of Women from Domestic Violence Act, 2005",
    body: "Provides civil reliefs such as protection orders, residence orders, monetary relief, custody orders, and compensation. It often operates alongside criminal-law and maintenance remedies.",
    keywords: ["domestic violence", "residence order", "protection order", "maintenance", "women"]
  },
  {
    id: "ni-act-138",
    type: "statute",
    title: "Negotiable Instruments Act - cheque dishonour",
    citation: "Negotiable Instruments Act, 1881 - Section 138",
    body: "Cheque dishonour matters require close attention to timelines, statutory notice, proof of legally enforceable debt, and service details. This remains a common lawyer-workspace use case for notices and complaints.",
    keywords: ["cheque bounce", "section 138", "ni act", "legal notice", "dishonour"]
  },
  {
    id: "bsa-2023",
    type: "statute",
    title: "Bharatiya Sakshya Adhiniyam, 2023",
    citation: "Bharatiya Sakshya Adhiniyam, 2023",
    body: "This is the current central evidence law for criminal and other proceedings where evidentiary principles matter. Use it as the up-to-date reference instead of the repealed Indian Evidence Act where applicable.",
    keywords: ["evidence", "documents", "electronic evidence", "bsa", "proof", "indian evidence act"]
  },
  {
    id: "new-criminal-laws",
    type: "statute",
    title: "New criminal laws in force from 1 July 2024",
    citation: "BNS, BNSS and BSA in force from 1 July 2024",
    body: "The Bharatiya Nyaya Sanhita, Bharatiya Nagarik Suraksha Sanhita, and Bharatiya Sakshya Adhiniyam replaced the IPC, CrPC, and Indian Evidence Act framework from 1 July 2024. Older case law may still matter, but section references should be updated carefully.",
    keywords: ["1 july 2024", "bns", "bnss", "bsa", "ipc replaced", "crpc replaced"]
  }
];

module.exports = {
  LEGAL_SYSTEM_PROMPTS,
  LEGAL_CORPUS
};
