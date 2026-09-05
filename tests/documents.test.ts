import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { extractByRules, findAmounts, findDates, findReference, sanitizeExtraction } from "@/lib/ai/documents";
import { addDocument, markDocumentReviewed, updateDocument } from "@/lib/commands";
import { getDocuments } from "@/lib/queries";
import type { Store } from "@/types";

import { seedStore } from "./helpers";

let cached: Store | null = null;
const seed = (): Store => (cached ??= seedStore());

describe("document extraction by rules", () => {
  it("reads dates, amounts and references out of names and text", () => {
    assert.deepEqual(findDates("Invoice_2026-08-12 due 30/09/2026 and 5 Sep 2026"), ["2026-08-12", "2026-09-30", "2026-09-05"]);
    assert.deepEqual(findAmounts("Total: 1,450.00 USD · deposit $900 · 600usd").sort((a, b) => a - b), [600, 900, 1450]);
    assert.equal(findReference("Schindler invoice INV-2041 for elevator"), "INV-2041");
  });

  it("recognises an invoice, its supplier, building, amount and reference from the file name", () => {
    const s = seed();
    const x = extractByRules(s, { fileName: "Invoice_Schindler_INV-2041_Marina-Residence_2026-08-12_600USD.pdf", title: "Invoice Schindler INV 2041", category: "other", mimeType: "application/pdf" });
    assert.equal(x.docType, "invoice");
    assert.ok(x.typeConfidence >= 0.8);
    const supplier = s.suppliers.find((z) => z.name.startsWith("Schindler"))!;
    assert.equal(x.links.supplierId, supplier.id);
    const marina = s.properties.find((p) => p.name.startsWith("Marina"))!;
    assert.equal(x.links.propertyId, marina.id);
    assert.equal(x.fields.find((f) => f.key === "amount")?.value, "600");
    assert.equal(x.fields.find((f) => f.key === "date")?.value, "2026-08-12");
    assert.equal(x.fields.find((f) => f.key === "invoiceNumber")?.value, "INV-2041");
    assert.equal(x.source, "rules");
    assert.ok(x.notes.some((n) => /file name/.test(n)), "says it only read the name");
  });

  it("links a lease to the tenant, their contract and unit, and reads terms from text", () => {
    const s = seed();
    const karim = s.tenants.find((t) => t.fullName.startsWith("Karim"))!;
    const text = `LEASE AGREEMENT\nTenant: ${karim.fullName}\nMonthly rent: $1,250\nSecurity deposit: $2,500\nTerm: 2026-10-01 to 2027-09-30\nPayments monthly. Rent increase 5% on renewal.`;
    const x = extractByRules(s, { fileName: `Lease ${karim.fullName}.txt`, title: `Lease ${karim.fullName}`, category: "other", mimeType: "text/plain" }, text);
    assert.equal(x.docType, "lease");
    assert.equal(x.links.tenantId, karim.id);
    assert.ok(x.links.contractId, "current contract resolved");
    assert.ok(x.links.unitId);
    assert.equal(x.fields.find((f) => f.key === "rent")?.value, "1250");
    assert.equal(x.fields.find((f) => f.key === "deposit")?.value, "2500");
    assert.equal(x.fields.find((f) => f.key === "startDate")?.value, "2026-10-01");
    assert.equal(x.fields.find((f) => f.key === "endDate")?.value, "2027-09-30");
    assert.equal(x.fields.find((f) => f.key === "paymentFrequency")?.value, "monthly");
    assert.ok(x.fields.find((f) => f.key === "increaseClause")?.value.includes("5%"));
  });

  it("treats a future date on a warranty or policy as the expiry and links the asset", () => {
    const s = seed();
    const generator = s.assets.find((a) => a.assetType === "generator")!;
    const x = extractByRules(s, { fileName: `Warranty ${generator.name} PowerGen 2027-06-30.pdf`, title: "Warranty generator", category: "other", mimeType: "application/pdf", propertyId: generator.propertyId });
    assert.equal(x.docType, "warranty");
    assert.equal(x.links.assetId, generator.id);
    assert.equal(x.fields.find((f) => f.key === "expiryDate")?.value, "2027-06-30");
  });

  it("drops unknown ids and fields coming back from the model", () => {
    const s = seed();
    const fallback = extractByRules(s, { fileName: "scan.jpg", title: "scan", category: "other", mimeType: "image/jpeg" });
    const x = sanitizeExtraction(s, { docType: "invoice", typeConfidence: 0.9, fields: [{ key: "amount", value: "420", confidence: 0.8 }, { key: "bogus", value: "x", confidence: 1 }, { key: "date", value: "", confidence: 1 }], links: { supplierId: "nope", tenantId: s.tenants[0].id }, linkConfidence: { tenantId: 0.9 }, notes: ["ok"] }, fallback);
    assert.equal(x.docType, "invoice");
    assert.equal(x.source, "model");
    assert.deepEqual(x.fields.map((f) => f.key), ["amount"]);
    assert.equal(x.links.supplierId, undefined);
    assert.equal(x.links.tenantId, s.tenants[0].id);
  });
});

describe("document filing", () => {
  it("files a document with links and dates, audited and undoable, and marks it reviewed", () => {
    const s0 = seed();
    const { store: s1, result: doc } = addDocument({ title: "policy", fileName: "policy.pdf", sizeKb: 40, category: "other", dataUrl: null, links: {} })(s0);
    assert.ok(getDocuments(s1, { needsReview: true }).some((d) => d.id === doc.id), "unfiled upload needs review");
    const p = s1.properties[0];
    const { store: s2, result: filed, undo } = updateDocument(doc.id, { category: "insurance", title: "Building policy 2027", propertyId: p.id, expiryDate: "2027-03-01" })(s1);
    assert.equal(filed.category, "insurance");
    assert.equal(filed.propertyId, p.id);
    assert.equal(filed.expiryDate, "2027-03-01");
    assert.ok(s2.audit.some((a) => a.entityType === "document" && a.entityId === doc.id), "audited");
    assert.throws(() => updateDocument(doc.id, { expiryDate: "2020-01-01", issuedDate: "2021-01-01" })(s2), /before/);
    const { store: s3 } = markDocumentReviewed(doc.id, { source: "rules", at: "2026-09-05", docType: "insurance", fields: [{ key: "expiryDate", value: "2027-03-01", confidence: 0.7 }] })(s2);
    const reviewed = s3.documents.find((d) => d.id === doc.id)!;
    assert.equal(reviewed.reviewedAt, "2026-09-05");
    assert.equal(reviewed.extraction?.source, "rules");
    assert.ok(!getDocuments(s3, { needsReview: true }).some((d) => d.id === doc.id));
    const back = undo!(s2);
    assert.equal(back.documents.find((d) => d.id === doc.id)?.category, "other");
  });

  it("filters the document centre by category, building and date", () => {
    const s = seed();
    const all = getDocuments(s);
    assert.ok(all.length > 0);
    assert.ok(all.every((d) => !d.deleted));
    const leases = getDocuments(s, { category: "lease" });
    assert.ok(leases.every((d) => d.category === "lease"));
    const p = s.properties[0];
    assert.ok(getDocuments(s, { propertyId: p.id }).every((d) => d.propertyId === p.id));
    assert.ok(getDocuments(s, { from: "2030-01-01" }).length === 0);
  });
});
