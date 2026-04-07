const assert = require("node:assert/strict");

const {
  LEGACY_REFERENCE_RULES,
  classifyCaseNature,
  normalizeSearchText,
  retrieveLegalContext,
  getLegacyReferenceMatches,
  getLegacyLawNotice
} = require("./legalUtils");
const {
  parseSupremeCourtHtml,
  parseTableHtml
} = require("./legalJudgmentParsers");
const {
  buildCanonicalCaseId,
  buildCaseRelationDocsFromJudgment
} = require("./relationService");
const { computeCaseValidity } = require("./validityEngine");
const { buildArgumentSet } = require("./argumentEngine");
const { analyzeCaseStrength } = require("./strengthEngine");
const { analyzeDocument, buildDocumentAnalysisMemo } = require("./documentAnalyzerEngine");
const { analyzeDraftValidation } = require("./draftValidationEngine");
const { predictCaseOutcome } = require("./predictionEngine");
const { buildTraceability, normalizePinpoint } = require("./traceabilityService");
const { analyzeFilingReadiness } = require("./readinessEngine");
const { evaluateAuthorityGuardrails } = require("./authorityGuardrailService");

const tests = [];

function runTest(name, fn) {
  tests.push({ name, fn });
}

runTest("normalizeSearchText removes punctuation and short tokens", () => {
  assert.deepEqual(
    normalizeSearchText("IPC 379 theft, FIR @ police!"),
    ["ipc", "379", "theft", "fir", "police"]
  );
});

runTest("retrieveLegalContext maps legacy theft query to current BNS reference", () => {
  const results = retrieveLegalContext("Need help for IPC 379 theft complaint", 5);
  assert.ok(results.some((item) => item.citation.includes("Bharatiya Nyaya Sanhita, 2023 - Section 303")));
});

runTest("retrieveLegalContext maps legacy FIR query to current BNSS reference", () => {
  const results = retrieveLegalContext("Police refused FIR under CrPC 154", 5);
  assert.ok(results.some((item) => item.citation.includes("Bharatiya Nagarik Suraksha Sanhita, 2023 - Section 173")));
});

runTest("retrieveLegalContext prioritizes NI Act for cheque dishonour research", () => {
  const results = retrieveLegalContext("Cheque issued on 1 March and dishonoured on 5 March for insufficient funds", 4);
  assert.equal(results[0].citation, "Negotiable Instruments Act, 1881 - Section 138");
  assert.ok(!results.some((item) => item.citation.includes("Constitution of India - Article 14")));
});

runTest("retrieveLegalContext excludes unrelated criminal and consumer authorities for cheque dishonour", () => {
  const results = retrieveLegalContext("Cheque dishonour under Section 138 after bank memo and statutory notice", 8);
  const citations = results.map((item) => item.citation);
  assert.ok(citations.includes("Negotiable Instruments Act, 1881 - Section 138"));
  assert.ok(!citations.includes("Bharatiya Nyaya Sanhita, 2023 - Section 303"));
  assert.ok(!citations.includes("Bharatiya Nyaya Sanhita, 2023 - Cheating provisions"));
  assert.ok(!citations.includes("Consumer Protection Act, 2019"));
});

runTest("classifyCaseNature distinguishes civil recovery from criminal complaints", () => {
  assert.equal(classifyCaseNature("Tenant failed to return security deposit after lease ended"), "civil");
  assert.equal(classifyCaseNature("Police refused FIR after theft of bike"), "criminal");
});

runTest("getLegacyReferenceMatches finds multiple legacy markers", () => {
  const matches = getLegacyReferenceMatches("IPC 420 and CrPC 154 are both mentioned here");
  assert.ok(matches.some((item) => item.id === "ipc-420"));
  assert.ok(matches.some((item) => item.id === "crpc-154"));
});

runTest("getLegacyLawNotice includes mapped current references", () => {
  const notice = getLegacyLawNotice("Draft based on IPC 379 and Indian Evidence Act");
  assert.match(notice, /BNS, BNSS, and BSA/);
  assert.match(notice, /Bharatiya Nyaya Sanhita, 2023 - Section 303/);
  assert.match(notice, /Bharatiya Sakshya Adhiniyam, 2023/);
});

runTest("legacy rules stay populated for lawyer mapping support", () => {
  assert.ok(LEGACY_REFERENCE_RULES.length >= 5);
});

runTest("parseSupremeCourtHtml extracts official judgment anchors", () => {
  const sampleHtml = `
    <div class="judgments">
      <a href="/judgments/demo-1.pdf">
        SANDEEP YADAV VS. SATISH - Crl.A. No. 1617/2026 - Diary Number 20806 / 2025 - 25-Mar-2026 (Uploaded On 25-03-2026 20:31:18)
      </a>
    </div>
  `;
  const records = parseSupremeCourtHtml(sampleHtml, {
    endpoint: "https://www.sci.gov.in/",
    court: "Supreme Court",
    name: "Supreme Court Feed"
  });

  assert.equal(records.length, 1);
  assert.match(records[0].title, /SANDEEP YADAV VS\. SATISH/);
  assert.equal(records[0].court, "Supreme Court");
  assert.ok(records[0].sourceUrl.includes("sci.gov.in"));
});

runTest("parseTableHtml extracts court table row judgments", () => {
  const sampleHtml = `
    <table>
      <tr>
        <td>1</td>
        <td>25/03/2026</td>
        <td>Cheque Dishonour Notice Compliance and Complaint Timing</td>
        <td><a href="/docs/demo-2.pdf">View PDF</a></td>
      </tr>
    </table>
  `;
  const records = parseTableHtml(sampleHtml, {
    endpoint: "https://www.bombayhighcourt.nic.in/recentorderjudgment.php",
    court: "Bombay High Court",
    name: "Bombay High Court Feed"
  });

  assert.equal(records.length, 1);
  assert.match(records[0].title, /Cheque Dishonour/);
  assert.equal(records[0].court, "Bombay High Court");
  assert.ok(records[0].sourceUrl.includes("bombayhighcourt"));
});

runTest("buildCanonicalCaseId prefers citation-based canonical form", () => {
  const canonical = buildCanonicalCaseId({
    title: "Maneka Gandhi v. Union of India",
    citation: "(1978) 1 SCC 248",
    court: "Supreme Court"
  });

  assert.equal(canonical, "case-1978-1-scc-248");
});

runTest("buildCaseRelationDocsFromJudgment extracts normalized case relations", () => {
  const docs = buildCaseRelationDocsFromJudgment({
    title: "Test Case",
    citation: "(2026) 1 SCC 10",
    court: "Supreme Court",
    judgmentDate: "2026-01-10",
    followedBy: ["Later Bench v. State"],
    overruledBy: ["Partly overruled in Example v. Union"]
  });

  assert.equal(docs.length, 2);
  assert.equal(docs[0].relationType, "followed");
  assert.equal(docs[1].relationType, "overruled");
  assert.equal(docs[1].reasonCode, "partial_overrule");
});

runTest("computeCaseValidity returns BAD LAW for strong overruling", async () => {
  const caseRelations = [
    {
      id: "r1",
      sourceCaseId: "case-2025-1-scc-10",
      targetCaseId: "case-1978-1-scc-248",
      relationType: "overruled",
      court: "Supreme Court",
      date: "2025-02-10",
      strengthScore: 4
    }
  ];

  const adminMock = {
    firestore() {
      return {
        collection(name) {
          if (name === "canonicalCases") {
            return {
              doc() {
                return { get: async () => ({ exists: false }) };
              },
              where() {
                return { limit() { return { get: async () => ({ empty: true, docs: [] }) }; } };
              }
            };
          }
          if (name === "caseRelations") {
            return {
              where(field) {
                return {
                  limit() {
                    return {
                      get: async () => ({
                        docs: caseRelations
                          .filter((item) => item[field] === "case-1978-1-scc-248")
                          .map((item) => ({ id: item.id, data: () => item }))
                      })
                    };
                  }
                };
              }
            };
          }
          if (name === "caseValidityCache") {
            return {
              doc() {
                return {
                  get: async () => ({ exists: false }),
                  set: async () => ({})
                };
              }
            };
          }
          if (name === "legalJudgments") {
            return {
              where() {
                return { limit() { return { get: async () => ({ empty: true, docs: [] }) }; } };
              }
            };
          }
          throw new Error(`Unexpected collection ${name}`);
        }
      };
    }
  };

  const result = await computeCaseValidity(adminMock, {
    canonicalCaseId: "case-1978-1-scc-248"
  });

  assert.equal(result.status, "BAD LAW");
  assert.equal(result.riskLevel, "HIGH");
});

runTest("buildArgumentSet excludes bad-law authorities from usable arguments", async () => {
  function firestoreMock() {
    return {
      collection(name) {
        if (name === "canonicalCases") {
          return {
            doc() {
              return { get: async () => ({ exists: false }) };
            },
            where() {
              return { limit() { return { get: async () => ({ empty: true, docs: [] }) }; } };
            }
          };
        }
        if (name === "caseRelations") {
          return {
            where(field, op, value) {
              return {
                limit() {
                  return {
                    get: async () => ({
                      docs: field === "targetCaseId" && value === "case-bad"
                        ? [{
                            id: "r-bad-1",
                            data: () => ({
                              sourceCaseId: "case-later-overrule",
                              targetCaseId: "case-bad",
                              relationType: "overruled",
                              court: "Supreme Court",
                              date: "2025-02-10",
                              strengthScore: 4
                            })
                          }]
                        : []
                    })
                  };
                }
              };
            }
          };
        }
        if (name === "caseValidityCache") {
          return {
            doc() {
              return {
                get: async () => ({ exists: false }),
                set: async () => ({})
              };
            }
          };
        }
        if (name === "legalJudgments") {
          return {
            where(field, op, value) {
              return {
                limit() {
                  return {
                    get: async () => {
                      if (value === "case-bad") {
                        return {
                          empty: false,
                          docs: [{
                            id: "bad",
                            data: () => ({
                              canonicalCaseId: "case-bad",
                              title: "Bad Case",
                              citation: "(2001) 1 SCC 1"
                            })
                          }]
                        };
                      }
                      return { empty: true, docs: [] };
                    }
                  };
                }
              };
            }
          };
        }
        throw new Error(`Unexpected collection ${name}`);
      }
    };
  }
  firestoreMock.FieldValue = {
    serverTimestamp() {
      return "server-timestamp";
    }
  };
  const adminMock = {
    firestore: firestoreMock
  };

  const result = await buildArgumentSet(adminMock, {
    facts: "Contract terminated without notice.",
    issues: ["Termination validity"],
    jurisdiction: "Delhi High Court",
    selectedCases: [
      { canonicalCaseId: "case-good", title: "Good Case", citation: "(2024) 1 SCC 10", ratioNote: "Supports notice fairness." },
      { canonicalCaseId: "case-bad", title: "Bad Case", citation: "(2001) 1 SCC 1", ratioNote: "No longer reliable." }
    ]
  });

  assert.ok(result.warnings.length >= 1);
  assert.equal(result.petitionerArguments[0].arguments[0].caseReferences.some((item) => item.caseId === "case-bad"), false);
});

runTest("analyzeCaseStrength returns weak score when documents and cases are missing", async () => {
  function firestoreMock() {
    return {
      collection(name) {
        if (name === "canonicalCases") {
          return {
            doc() {
              return { get: async () => ({ exists: false }) };
            },
            where() {
              return { limit() { return { get: async () => ({ empty: true, docs: [] }) }; } };
            }
          };
        }
        if (name === "caseRelations") {
          return {
            where() {
              return {
                limit() {
                  return { get: async () => ({ docs: [] }) };
                }
              };
            }
          };
        }
        if (name === "caseValidityCache") {
          return {
            doc() {
              return {
                get: async () => ({ exists: false }),
                set: async () => ({})
              };
            }
          };
        }
        if (name === "legalJudgments") {
          return {
            where() {
              return {
                limit() {
                  return { get: async () => ({ empty: true, docs: [] }) };
                }
              };
            }
          };
        }
        throw new Error(`Unexpected collection ${name}`);
      }
    };
  }
  firestoreMock.FieldValue = {
    serverTimestamp() {
      return "server-timestamp";
    }
  };

  const result = await analyzeCaseStrength({ firestore: firestoreMock }, {
    matterId: "matter-1",
    facts: "Oral property understanding but no written record.",
    issues: ["Injunction", "Jurisdiction"],
    documents: [],
    selectedCases: [],
    jurisdiction: "Civil Court"
  });

  assert.equal(result.strengthLevel, "WEAK");
  assert.ok(result.missingEvidence.length >= 1);
  assert.ok(result.riskAnalysis.length >= 1);
});

runTest("analyzeDocument returns structured lawyer-ready fields", () => {
  const result = analyzeDocument({
    documentText: `LEGAL NOTICE\nCheque issued on 2026-03-01.\nCheque dishonoured on 2026-03-05.\nPayment not made within 15 days.\nSignature pending.`,
    caseFacts: "Cheque dishonoured on 2026-03-05."
  });

  assert.equal(result.documentType, "notice");
  assert.ok(Array.isArray(result.keyFacts));
  assert.ok(Array.isArray(result.risks));
  assert.ok(Array.isArray(result.suggestedArguments));
  assert.ok(Array.isArray(result.legalEntities));
  assert.ok(Array.isArray(result.obligations));
  assert.ok(Array.isArray(result.legalIssues));
});

runTest("buildDocumentAnalysisMemo returns professional memo text", () => {
  const analysis = analyzeDocument({
    documentText: `LEGAL NOTICE\nCheque issued on 2026-03-01.\nCheque dishonoured on 2026-03-05.\nPayment not made within 15 days.\nSignature pending.`,
    caseFacts: "Cheque dishonoured on 2026-03-05."
  });

  const memo = buildDocumentAnalysisMemo(analysis, {
    clientLabel: "Demo Client",
    matterLabel: "Cheque Dishonour Matter"
  });

  assert.match(memo, /DOCUMENT ANALYSIS MEMO/);
  assert.match(memo, /CLIENT \/ MATTER/);
  assert.match(memo, /SUMMARY/);
  assert.match(memo, /SUGGESTED LEGAL STRATEGY/);
});

runTest("analyzeDocument does not flag precise dates missing when exact dates are present", () => {
  const result = analyzeDocument({
    documentText: `LEGAL NOTICE\nCheque issued on 1 March 2026.\nCheque dishonoured on 5 March 2026.\nPayment not made within 15 days.\nSignature pending.`
  });

  assert.ok(!result.missingPoints.includes("Precise dates"));
});

runTest("analyzeDraftValidation recognizes visible legal notice sections", () => {
  const result = analyzeDraftValidation({
    draftType: "notice",
    courtType: "general",
    draftText: `LEGAL NOTICE\n\nFROM:\nCOUNSEL FOR THE CLAIMANT / COMPLAINANT\n\nTO:\nTHE NOTICEE / OPPOSITE PARTY\n\nSUBJECT:\nNotice calling upon you to discharge your legal liability\n\nUNDER INSTRUCTIONS from and on behalf of my client, I hereby state as follows:\n\nFACTS\n1. Cheque issued on 1 March 2026, dishonoured on 5 March 2026 for insufficient funds, notice sent on 10 March 2026, no payment received within 15 days.\n\nLEGAL BASIS\n1. Section 138 of the Negotiable Instruments Act, 1881.\n\nDEMAND / PRAYER\nYou are hereby finally called upon to comply within the legally permissible period, failing which appropriate proceedings shall be initiated at your cost and risk.\n\nPLACE:\nDATE:\n\nCOUNSEL FOR THE NOTICE ISSUER\n[SIGNATURE BLOCK]`
  });

  const failed = result.checks.filter((item) => !item.passed).map((item) => item.key);
  assert.ok(!failed.includes("subject"));
  assert.ok(!failed.includes("facts"));
  assert.ok(!failed.includes("signature"));
  assert.ok(!failed.includes("demand"));
  assert.ok(result.validationScore > 0);
});

runTest("analyzeDraftValidation infers notice template when draft type is mismatched", () => {
  const result = analyzeDraftValidation({
    draftType: "petition",
    courtType: "general",
    draftText: `LEGAL NOTICE

FROM:
COUNSEL FOR THE CLAIMANT

TO:
THE NOTICEE

SUBJECT:
Demand notice under Section 138

UNDER INSTRUCTIONS from my client, I hereby state as follows:

FACTS
Cheque dishonoured and payment not made.

LEGAL BASIS
Section 138 of the Negotiable Instruments Act, 1881.

DEMAND / PRAYER
You are hereby called upon to comply within the statutory period, failing which proceedings shall follow.

COUNSEL FOR THE NOTICE ISSUER
[SIGNATURE BLOCK]`
  });

  assert.equal(result.draftType, "notice");
  assert.ok(!result.missingSections.includes("Subject line present"));
  assert.ok(!result.missingSections.includes("Demand / compliance clause present"));
});

runTest("analyzeDraftValidation tolerates alternate notice phrasing for subject and signature", () => {
  const result = analyzeDraftValidation({
    draftType: "notice",
    draftText: `LEGAL NOTICE

FROM:
Advocate for the claimant

TO:
Borrower

RE: Demand for payment after cheque dishonour

Background:
Cheque dated 1 March 2026 was returned unpaid on 5 March 2026. Despite notice, the amount remains unpaid and the claimant seeks compliance.

The demand is made under Section 138 of the Negotiable Instruments Act, 1881.

You are called upon to make payment within 15 days, failing which proceedings will be initiated.

Yours faithfully,
Counsel for claimant`
  });

  assert.ok(!result.missingSections.includes("Subject line present"));
  assert.ok(!result.missingSections.includes("Signature block present"));
  assert.ok(!result.missingSections.includes("Demand / compliance clause present"));
  assert.ok(!result.missingSections.includes("Legal basis present"));
});

runTest("copilot-style fallback notice passes structural validation", () => {
  const { validateDocument } = require("./copilot/validationService");
  const result = validateDocument({
    documentType: "notice",
    documentText: `LEGAL NOTICE

FROM
Demo Client

TO
Demo Respondent

SUBJECT
Cheque dishonour notice

FACTUAL BACKGROUND
Cheque issued on 1 March 2026 and dishonoured on 5 March 2026. Notice sent and payment not made.

LEGAL RESPONSE
Negotiable Instruments Act, 1881 - Section 138

RESERVATION OF RIGHTS
All rights and remedies are reserved.`,
    contextPacket: {
      sections: [{ label: "Negotiable Instruments Act, 1881 - Section 138" }]
    }
  });

  assert.equal(result.status, "passed");
  assert.equal(result.missingSections.length, 0);
});

runTest("copilot-style fallback affidavit passes structural validation", () => {
  const { validateDocument } = require("./copilot/validationService");
  const result = validateDocument({
    documentType: "affidavit",
    documentText: `AFFIDAVIT

DEPONENT DETAILS
Demo Client

STATEMENTS ON OATH
I solemnly affirm and state as follows:
The facts stated here are true to my knowledge.

VERIFICATION
Verified that the contents are true to knowledge and belief.`,
    contextPacket: {}
  });

  assert.equal(result.status, "passed");
  assert.equal(result.missingSections.length, 0);
});

runTest("predictCaseOutcome returns weighted explainable output", async () => {
  function firestoreMock() {
    return {
      collection(name) {
        if (name === "canonicalCases") {
          return {
            doc() {
              return { get: async () => ({ exists: false }) };
            },
            where() {
              return { limit() { return { get: async () => ({ empty: true, docs: [] }) }; } };
            }
          };
        }
        if (name === "caseRelations") {
          return {
            where() {
              return {
                limit() {
                  return { get: async () => ({ docs: [] }) };
                }
              };
            }
          };
        }
        if (name === "caseValidityCache") {
          return {
            doc() {
              return {
                get: async () => ({ exists: false }),
                set: async () => ({})
              };
            }
          };
        }
        if (name === "legalJudgments") {
          return {
            where() {
              return {
                limit() {
                  return { get: async () => ({ empty: true, docs: [] }) };
                }
              };
            }
          };
        }
        throw new Error(`Unexpected collection ${name}`);
      }
    };
  }
  firestoreMock.FieldValue = {
    serverTimestamp() {
      return "server-timestamp";
    }
  };

  const result = await predictCaseOutcome({ firestore: firestoreMock }, {
    facts: "Cheque issued toward repayment. Bank memo confirms dishonour. Statutory notice sent within time.",
    issues: ["Section 138 NI Act compliance"],
    documentAnalysis: {
      keyFacts: ["Cheque dishonoured on record."],
      obligations: ["Noticee was required to pay within the statutory window."],
      missingPoints: [],
      risks: [],
      contradictionsWithCase: []
    },
    caseStrength: {
      strengths: ["Strong documentary record."],
      weaknesses: [],
      suggestions: [],
      riskAnalysis: [],
      scoreBreakdown: {
        evidenceStrength: 82,
        authorityFit: 75,
        consistency: 78
      },
      authorityReview: [
        {
          caseId: "case-1",
          title: "Reliable Authority",
          citation: "(2024) 1 SCC 10",
          status: "GOOD LAW",
          riskLevel: "LOW",
          confidenceScore: 86
        }
      ]
    },
    authorities: [
      {
        caseId: "case-1",
        title: "Reliable Authority",
        citation: "(2024) 1 SCC 10",
        status: "GOOD LAW",
        riskLevel: "LOW",
        confidenceScore: 86
      }
    ]
  });

  assert.equal(typeof result.winProbability, "number");
  assert.ok(result.winProbability >= 0 && result.winProbability <= 100);
  assert.ok(Array.isArray(result.keyFactors));
  assert.ok(Array.isArray(result.improvementSuggestions));
  assert.ok(["LOW", "MEDIUM", "HIGH"].includes(result.riskLevel));
});

runTest("buildTraceability normalizes facts, documents, and authorities", () => {
  const result = buildTraceability({
    facts: "Fact one\nFact two",
    documents: [{ title: "Agreement", content: "Payment clause and termination clause." }],
    authorities: [{ title: "Test Case", citation: "(2024) 1 SCC 10", whyItMatters: "Supports maintainability.", pinpointRef: "Para 12" }],
    scoreBreakdown: { evidenceStrength: 70 },
    keyFactors: ["Strong document support."],
    notes: ["Verify exact proposition."]
  });

  assert.equal(result.factsUsed.length, 2);
  assert.equal(result.documentsReviewed.length, 1);
  assert.equal(result.authoritiesRelied.length, 1);
  assert.equal(result.keyFactors.length, 1);
  assert.equal(result.authoritiesRelied[0].exactReference, "Para 12");
});

runTest("normalizePinpoint detects paragraph and page references", () => {
  const pinpoint = normalizePinpoint({}, "See Para 56 on page 12. Basic structure cannot be altered.");
  assert.equal(pinpoint.paragraphNumber, 56);
  assert.equal(pinpoint.pageNumber, 12);
  assert.match(pinpoint.excerpt, /Basic structure/);
});

runTest("analyzeFilingReadiness returns missing checklist items clearly", async () => {
  function firestoreMock() {
    return {
      collection(name) {
        if (name === "canonicalCases") {
          return {
            doc() {
              return { get: async () => ({ exists: false }) };
            },
            where() {
              return { limit() { return { get: async () => ({ empty: true, docs: [] }) }; } };
            }
          };
        }
        if (name === "caseRelations") {
          return {
            where() {
              return {
                limit() {
                  return { get: async () => ({ docs: [] }) };
                }
              };
            }
          };
        }
        if (name === "caseValidityCache") {
          return {
            doc() {
              return {
                get: async () => ({ exists: false }),
                set: async () => ({})
              };
            }
          };
        }
        if (name === "legalJudgments") {
          return {
            where() {
              return {
                limit() {
                  return { get: async () => ({ empty: true, docs: [] }) };
                }
              };
            }
          };
        }
        throw new Error(`Unexpected collection ${name}`);
      }
    };
  }
  firestoreMock.FieldValue = {
    serverTimestamp() {
      return "server-timestamp";
    }
  };

  const result = await analyzeFilingReadiness({ firestore: firestoreMock }, {
    facts: "Oral loan arrangement without any dated record.",
    issues: ["Recovery"],
    documents: [],
    draftText: "",
    draftType: "petition",
    selectedCases: []
  });

  assert.ok(result.readinessScore >= 0 && result.readinessScore <= 100);
  assert.ok(["READY", "PARTIAL", "NOT READY"].includes(result.readinessLevel));
  assert.ok(Array.isArray(result.checklist));
  assert.ok(result.missingItems.length >= 1);
});

runTest("evaluateAuthorityGuardrails blocks bad-law authorities", async () => {
  function firestoreMock() {
    return {
      collection(name) {
        if (name === "canonicalCases") {
          return {
            doc() {
              return { get: async () => ({ exists: false }) };
            },
            where() {
              return { limit() { return { get: async () => ({ empty: true, docs: [] }) }; } };
            }
          };
        }
        if (name === "caseRelations") {
          return {
            where(field, op, value) {
              return {
                limit() {
                  return {
                    get: async () => ({
                      docs: value === "case-bad"
                        ? [{
                            id: "r1",
                            data: () => ({
                              sourceCaseId: "case-later",
                              targetCaseId: "case-bad",
                              relationType: "overruled",
                              court: "Supreme Court",
                              date: "2025-01-01",
                              strengthScore: 5
                            })
                          }]
                        : []
                    })
                  };
                }
              };
            }
          };
        }
        if (name === "caseValidityCache") {
          return {
            doc() {
              return {
                get: async () => ({ exists: false }),
                set: async () => ({})
              };
            }
          };
        }
        if (name === "legalJudgments") {
          return {
            where() {
              return {
                limit() {
                  return { get: async () => ({ empty: true, docs: [] }) };
                }
              };
            }
          };
        }
        throw new Error(`Unexpected collection ${name}`);
      }
    };
  }
  firestoreMock.FieldValue = {
    serverTimestamp() {
      return "server-timestamp";
    }
  };

  const result = await evaluateAuthorityGuardrails({ firestore: firestoreMock }, [{
    canonicalCaseId: "case-bad",
    title: "Bad Case",
    citation: "(2001) 1 SCC 1",
    court: "Supreme Court"
  }]);

  assert.equal(result.status, "BLOCK");
  assert.ok(result.blockingWarnings.length >= 1);
});

(async () => {
  for (const test of tests) {
    try {
      await test.fn();
      console.log(`PASS ${test.name}`);
    } catch (error) {
      console.error(`FAIL ${test.name}`);
      throw error;
    }
  }

  console.log("All legal utility tests passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
