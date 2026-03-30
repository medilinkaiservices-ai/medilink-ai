import React, { useEffect, useMemo, useState } from "react";
import { addDoc, collection, getDocs, query, serverTimestamp, updateDoc, where, doc } from "firebase/firestore";
import SellerShell from "../components/SellerShell";
import { db } from "../firebase";
import { importCatalogFromDocument } from "../utils/catalogApi";
import { getStoredProfile } from "../utils/session";
import { fetchWholesaleBillByNumber } from "../utils/wholesaleApi";

function normalizeImportedProduct(item = {}) {
  return {
    name: item.name || item.productName || "",
    productName: item.productName || item.name || "",
    barcode: item.barcode || "",
    category: item.category || "",
    brand: item.brand || "",
    unit: item.unit || "",
    description: item.description || "",
    costPrice: item.costPrice ?? "",
    price: item.price ?? item.mrp ?? item.costPrice ?? "",
    mrp: item.mrp ?? item.price ?? "",
    quantity: item.quantity ?? "",
    image: item.image || ""
  };
}

function SellerStockInward() {
  const sellerProfile = getStoredProfile("seller");
  const [shops, setShops] = useState([]);
  const [shopId, setShopId] = useState(sellerProfile?.shopId || "");
  const [products, setProducts] = useState([]);
  const [status, setStatus] = useState("");
  const [working, setWorking] = useState(false);
  const [importBillNumber, setImportBillNumber] = useState("");
  const [importedBill, setImportedBill] = useState(null);
  const [documentProducts, setDocumentProducts] = useState([]);
  const [matchedItems, setMatchedItems] = useState([]);
  const [unmatchedItems, setUnmatchedItems] = useState([]);

  useEffect(() => {
    const loadShops = async () => {
      const sellerQuery = sellerProfile?.shopId
        ? query(collection(db, "sellers"), where("__name__", "==", sellerProfile.shopId))
        : collection(db, "sellers");
      const snapshot = await getDocs(sellerQuery);
      setShops(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })));
    };

    loadShops().catch((error) => console.error("Failed to load shops for stock inward:", error));
  }, [sellerProfile?.shopId]);

  useEffect(() => {
    const loadProducts = async () => {
      if (!shopId) {
        setProducts([]);
        return;
      }

      const snapshot = await getDocs(query(collection(db, "products"), where("shopId", "==", shopId)));
      setProducts(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })));
    };

    loadProducts().catch((error) => console.error("Failed to load products for stock inward:", error));
  }, [shopId]);

  const analyzedSourceItems = useMemo(() => {
    if (documentProducts.length) return documentProducts;
    if (importedBill?.items?.length) return importedBill.items.map((item) => normalizeImportedProduct(item));
    return [];
  }, [documentProducts, importedBill]);

  const analyzeMatches = (items) => {
    const matched = [];
    const unmatched = [];

    items.forEach((rawItem) => {
      const item = normalizeImportedProduct(rawItem);
      const normalizedName = String(item.productName || item.name || "").trim().toLowerCase();
      const normalizedBarcode = String(item.barcode || "").trim();
      const match = products.find((product) => {
        const sameBarcode = normalizedBarcode && String(product.barcode || "").trim() === normalizedBarcode;
        const sameName = normalizedName && String(product.productName || "").trim().toLowerCase() === normalizedName;
        return sameBarcode || sameName;
      });

      if (match) {
        matched.push({ source: item, match });
      } else {
        unmatched.push(item);
      }
    });

    setMatchedItems(matched);
    setUnmatchedItems(unmatched);
  };

  const handleImportBill = async () => {
    if (!importBillNumber.trim()) {
      setStatus("Enter wholesale bill number first.");
      return;
    }

    try {
      setWorking(true);
      const result = await fetchWholesaleBillByNumber(importBillNumber.trim());
      if (!result) {
        setImportedBill(null);
        setMatchedItems([]);
        setUnmatchedItems([]);
        setStatus("No wholesale bill found.");
        return;
      }

      setImportedBill(result);
      setDocumentProducts([]);
      analyzeMatches(result.items || []);
      setStatus(`Fetched ${result.items?.length || 0} invoice items from wholesale bill ${result.billNumber}.`);
    } catch (error) {
      console.error("Failed to fetch wholesale bill for inward:", error);
      setStatus("Could not fetch wholesale bill.");
    } finally {
      setWorking(false);
    }
  };

  const handleDocumentImport = async (file) => {
    if (!file) return;

    try {
      setWorking(true);
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = String(reader.result || "");
          resolve(result.split(",")[1] || "");
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const result = await importCatalogFromDocument({
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        dataBase64: base64
      });

      const normalized = Array.isArray(result.products)
        ? result.products.map((item) => normalizeImportedProduct(item)).filter((item) => item.productName || item.name)
        : [];

      setImportedBill(null);
      setDocumentProducts(normalized);
      analyzeMatches(normalized);
      setStatus(`AI extracted ${normalized.length} stock item(s) from ${file.name}.`);
    } catch (error) {
      console.error("Failed to analyze invoice document:", error);
      setStatus("Could not analyze invoice image/PDF/Word file.");
    } finally {
      setWorking(false);
    }
  };

  const handleApplyMatchedStock = async () => {
    if (!matchedItems.length) {
      setStatus("No matched products available for stock update.");
      return;
    }

    try {
      setWorking(true);
      const refreshedProducts = [...products];

      for (const item of matchedItems) {
        const incomingQty = Number(item.source.quantity || 0);
        const nextQuantity = Number(item.match.quantity || 0) + incomingQty;
        const payload = {
          quantity: nextQuantity,
          costPrice: Number(item.source.costPrice ?? item.match.costPrice ?? 0),
          mrp: Number(item.source.mrp ?? item.match.mrp ?? 0),
          price: Number(item.source.price ?? item.match.price ?? 0),
          brand: item.source.brand || item.match.brand || "",
          unit: item.source.unit || item.match.unit || "",
          description: item.source.description || item.match.description || "",
          image: item.source.image || item.match.image || "",
          updatedAt: serverTimestamp(),
          lastInwardAt: serverTimestamp(),
          lastInwardQuantity: incomingQty
        };

        await updateDoc(doc(db, "products", item.match.id), payload);
        const index = refreshedProducts.findIndex((product) => product.id === item.match.id);
        if (index >= 0) {
          refreshedProducts[index] = { ...refreshedProducts[index], ...payload, id: item.match.id };
        }
      }

      await addDoc(collection(db, "stockInwardLogs"), {
        shopId,
        sourceType: importedBill ? "wholesaleBill" : "aiDocument",
        sourceBillNumber: importedBill?.billNumber || "",
        matchedCount: matchedItems.length,
        unmatchedCount: unmatchedItems.length,
        items: matchedItems.map((item) => ({
          productId: item.match.id,
          productName: item.match.productName,
          barcode: item.match.barcode || item.source.barcode || "",
          inwardQuantity: Number(item.source.quantity || 0),
          costPrice: Number(item.source.costPrice || 0),
          mrp: Number(item.source.mrp || 0)
        })),
        createdAt: serverTimestamp()
      });

      setProducts(refreshedProducts);
      setStatus(`Stock updated for ${matchedItems.length} matched product(s).`);
    } catch (error) {
      console.error("Failed to apply inward stock:", error);
      setStatus("Could not apply stock inward.");
    } finally {
      setWorking(false);
    }
  };

  const handleCreateUnmatched = async () => {
    if (!unmatchedItems.length) {
      setStatus("No unmatched items available.");
      return;
    }

    try {
      setWorking(true);
      const createdProducts = [];

      for (const item of unmatchedItems) {
        const payload = {
          productName: String(item.productName || item.name || "").trim(),
          barcode: String(item.barcode || "").trim(),
          category: item.category || "",
          brand: String(item.brand || "").trim(),
          unit: String(item.unit || "").trim(),
          description: String(item.description || "").trim(),
          costPrice: Number(item.costPrice || 0),
          price: Number(item.price || 0),
          mrp: Number(item.mrp || 0),
          quantity: Number(item.quantity || 0),
          shopId,
          image: item.image || "",
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          lastInwardAt: serverTimestamp(),
          lastInwardQuantity: Number(item.quantity || 0)
        };

        const created = await addDoc(collection(db, "products"), payload);
        createdProducts.push({ id: created.id, ...payload });
      }

      setProducts((current) => [...current, ...createdProducts]);
      setUnmatchedItems([]);
      setStatus(`Created ${createdProducts.length} new product(s) from invoice analysis.`);
    } catch (error) {
      console.error("Failed to create unmatched inward products:", error);
      setStatus("Could not create unmatched invoice products.");
    } finally {
      setWorking(false);
    }
  };

  return (
    <SellerShell
      title="Stock inward"
      subtitle="Invoice photo, PDF, Word, and wholesale bill nundi stock ni AI analyze chesi existing inventory ki inward cheyyandi."
    >
      <div className="seller-two-column">
        <div className="auth-card">
          <label>
            Shop
            <select value={shopId} onChange={(event) => setShopId(event.target.value)}>
              <option value="">Select Shop</option>
              {shops.map((shop) => (
                <option key={shop.id} value={shop.id}>
                  {shop.shopName}
                </option>
              ))}
            </select>
          </label>

          <div className="soft-panel" style={{ marginBottom: "12px" }}>
            <div className="section-title">Import wholesale bill</div>
            <div className="seller-inline-actions">
              <input
                type="text"
                value={importBillNumber}
                onChange={(event) => setImportBillNumber(event.target.value)}
                placeholder="Enter wholesale bill number"
              />
              <button type="button" className="header-link" onClick={handleImportBill} disabled={working}>
                {working ? "Checking..." : "Fetch invoice items"}
              </button>
            </div>
            {importedBill ? (
              <p className="muted-copy" style={{ marginTop: "10px" }}>
                Source: {importedBill.sourceShopName || "Wholesale shop"} | Bill: {importedBill.billNumber}
              </p>
            ) : null}
          </div>

          <div className="soft-panel" style={{ marginBottom: "12px" }}>
            <div className="section-title">AI invoice import</div>
            <p className="muted-copy">Supplier bill photo, PDF, Word, doc, or scanned invoice upload chesi stock inward ready items pondandi.</p>
            <label className="header-link" style={{ cursor: "pointer" }}>
              Upload invoice image / PDF / Word
              <input
                type="file"
                accept="image/*,.pdf,.doc,.docx,.txt"
                style={{ display: "none" }}
                onChange={(event) => handleDocumentImport(event.target.files?.[0])}
              />
            </label>
          </div>

          <div className="soft-panel">
            <div className="section-title">Inward actions</div>
            <div className="seller-inline-actions">
              <button type="button" className="primary-button" disabled={working || !matchedItems.length} onClick={handleApplyMatchedStock}>
                Add stock to matched products
              </button>
              <button type="button" className="header-link" disabled={working || !unmatchedItems.length} onClick={handleCreateUnmatched}>
                Create unmatched as new products
              </button>
            </div>
            {status ? <p className="muted-copy" style={{ marginTop: "10px" }}>{status}</p> : null}
          </div>
        </div>

        <div className="seller-profile-preview">
          <div className="soft-panel">
            <div className="section-title">AI inward summary</div>
            <p className="muted-copy">Analyzed items: {analyzedSourceItems.length}</p>
            <p className="muted-copy">Matched existing products: {matchedItems.length}</p>
            <p className="muted-copy">New products to create: {unmatchedItems.length}</p>
          </div>

          <div className="soft-panel">
            <div className="section-title">Matched stock items</div>
            {!matchedItems.length ? <p className="muted-copy">Invoice analyze chesaka matched products ikkada kanipistayi.</p> : null}
            {matchedItems.map((item, index) => (
              <div key={`matched-${index}`} className="soft-panel" style={{ marginTop: "10px" }}>
                <div className="section-title">{item.source.productName || item.source.name}</div>
                <div className="muted-copy">
                  Match: {item.match.productName} | Current {item.match.quantity || 0} -> New {Number(item.match.quantity || 0) + Number(item.source.quantity || 0)}
                </div>
                <div className="muted-copy">
                  Inward Qty {item.source.quantity || 0} | Cost {item.source.costPrice || 0} | MRP {item.source.mrp || 0}
                </div>
              </div>
            ))}

            {unmatchedItems.length ? <div className="section-title" style={{ marginTop: "14px" }}>Unmatched invoice items</div> : null}
            {unmatchedItems.map((item, index) => (
              <div key={`unmatched-${index}`} className="soft-panel" style={{ marginTop: "10px" }}>
                <div className="section-title">{item.productName || item.name}</div>
                <div className="muted-copy">
                  Barcode: {item.barcode || "Not found"} | Qty {item.quantity || 0} | Cost {item.costPrice || 0}
                </div>
                <div className="muted-copy">
                  AI could not match this invoice item with current catalog. New product ga create cheyyachu.
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </SellerShell>
  );
}

export default SellerStockInward;
