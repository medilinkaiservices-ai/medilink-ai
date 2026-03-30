import React, { useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import ProductScannerModal from "../components/ProductScannerModal";
import SellerShell from "../components/SellerShell";
import { db, storage } from "../firebase";
import { fetchCatalogSuggestions, importCatalogFromDocument } from "../utils/catalogApi";
import { getStoredProfile } from "../utils/session";
import { fetchWholesaleBillByNumber } from "../utils/wholesaleApi";

const CATEGORY_OPTIONS = [
  "Medicine",
  "Healthcare",
  "Groceries",
  "Vegetables",
  "Fruits",
  "Snacks",
  "Seeds",
  "Fertilizers",
  "Livestock",
  "Electricals",
  "Hardware",
  "HomeNeeds",
  "PersonalCare",
  "BabyCare",
  "Others"
];

function isSameImage(currentPreview, candidateImage) {
  return Boolean(currentPreview && candidateImage && currentPreview === candidateImage);
}

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

function ProductUpdate() {
  const sellerProfile = getStoredProfile("seller");
  const [shops, setShops] = useState([]);
  const [shopId, setShopId] = useState(sellerProfile?.shopId || "");
  const [products, setProducts] = useState([]);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [form, setForm] = useState({
    productName: "",
    barcode: "",
    category: "",
    brand: "",
    unit: "",
    description: "",
    costPrice: "",
    price: "",
    mrp: "",
    quantity: "",
    image: ""
  });
  const [preview, setPreview] = useState("");
  const [imageFile, setImageFile] = useState(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [suggestions, setSuggestions] = useState({ localMatches: [], internetMatches: [], imageSuggestions: [], aiSuggestions: [] });
  const [status, setStatus] = useState("");
  const [updating, setUpdating] = useState(false);
  const [importBillNumber, setImportBillNumber] = useState("");
  const [importedBill, setImportedBill] = useState(null);
  const [importingBill, setImportingBill] = useState(false);
  const [documentImporting, setDocumentImporting] = useState(false);
  const [documentProducts, setDocumentProducts] = useState([]);
  const [unmatchedProducts, setUnmatchedProducts] = useState([]);

  useEffect(() => {
    const loadShops = async () => {
      const sellerQuery = sellerProfile?.shopId
        ? query(collection(db, "sellers"), where("__name__", "==", sellerProfile.shopId))
        : collection(db, "sellers");
      const snapshot = await getDocs(sellerQuery);
      const list = snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
      setShops(list);
    };

    loadShops().catch((error) => console.error("Failed to load shops for update:", error));
  }, [sellerProfile?.shopId]);

  useEffect(() => {
    const loadProducts = async () => {
      if (!shopId) {
        setProducts([]);
        return;
      }

      const snapshot = await getDocs(query(collection(db, "products"), where("shopId", "==", shopId)));
      const list = snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
      setProducts(list);
    };

    loadProducts().catch((error) => console.error("Failed to load products for update:", error));
  }, [shopId]);

  useEffect(() => {
    if (!selectedId) {
      setSuggestions({ localMatches: [], internetMatches: [], imageSuggestions: [], aiSuggestions: [] });
      return undefined;
    }

    const timer = window.setTimeout(async () => {
      if (form.productName.trim().length < 2 && form.barcode.trim().length < 4) {
        setSuggestions({ localMatches: [], internetMatches: [], imageSuggestions: [], aiSuggestions: [] });
        return;
      }

      try {
        setSuggestionsLoading(true);
        const result = await fetchCatalogSuggestions({
          query: form.productName.trim(),
          barcode: form.barcode.trim(),
          shopId,
          category: form.category
        });
        setSuggestions(result);
      } catch (error) {
        console.error("Failed to fetch update suggestions:", error);
      } finally {
        setSuggestionsLoading(false);
      }
    }, 450);

    return () => window.clearTimeout(timer);
  }, [selectedId, form.productName, form.barcode, form.category, shopId]);

  const filteredProducts = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return products;

    return products.filter((item) =>
      [item.productName, item.barcode, item.brand, item.category]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(keyword)
    );
  }, [products, search]);

  const handleFieldChange = (field, value) => {
    setForm((current) => ({
      ...current,
      [field]: ["costPrice", "price", "mrp", "quantity"].includes(field)
        ? value.replace(/[^0-9.]/g, "")
        : value
    }));
  };

  const applyProduct = (product) => {
    setSelectedId(product.id);
    setForm({
      productName: product.productName || "",
      barcode: product.barcode || "",
      category: product.category || "",
      brand: product.brand || "",
      unit: product.unit || "",
      description: product.description || "",
      costPrice: String(product.costPrice ?? ""),
      price: String(product.price ?? ""),
      mrp: String(product.mrp ?? ""),
      quantity: String(product.quantity ?? ""),
      image: product.image || ""
    });
    setPreview(product.image || "");
    setImageFile(null);
    setStatus(`Selected ${product.productName || "product"} for update.`);
  };

  const handleScanDetected = (code) => {
    setSearch(code);
    const exact = products.find((item) => String(item.barcode || "").trim() === String(code).trim());
    if (exact) {
      applyProduct(exact);
      return;
    }

    handleFieldChange("barcode", code);
  };

  const handleImageChange = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setImageFile(file);
    setPreview(URL.createObjectURL(file));
    setStatus(`Ready to use image ${file.name} for this product.`);
  };

  const applySuggestion = (item) => {
    setForm((current) => ({
      ...current,
      productName: item.name || current.productName,
      barcode: item.barcode || current.barcode,
      category: item.category || current.category,
      brand: item.brand || current.brand,
      unit: item.unit || current.unit,
      description: item.description || current.description,
      costPrice: item.costPrice !== undefined && item.costPrice !== "" ? String(item.costPrice) : current.costPrice,
      price: item.price !== undefined && item.price !== "" ? String(item.price) : current.price,
      mrp: item.mrp !== undefined && item.mrp !== "" ? String(item.mrp) : current.mrp,
      quantity: item.quantity !== undefined && item.quantity !== "" ? String(item.quantity) : current.quantity
    }));
    if (item.image) {
      setPreview(item.image);
      setImageFile(null);
    }
    setStatus(`Applied details from ${item.name || item.productName || "suggestion"}.`);
  };

  const applySuggestedImage = (item) => {
    if (!item?.image) {
      return;
    }

    setPreview(item.imageFull || item.image);
    setImageFile(null);
    setStatus(`Applied image from ${item.sourceLabel || "internet suggestion"}.`);
  };

  const handleImportBill = async () => {
    if (!importBillNumber.trim()) {
      setStatus("Enter wholesale bill number first.");
      return;
    }

    try {
      setImportingBill(true);
      const result = await fetchWholesaleBillByNumber(importBillNumber.trim());
      if (!result) {
        setImportedBill(null);
        setUnmatchedProducts([]);
        setStatus("No wholesale bill found for this number.");
        return;
      }

      setImportedBill(result);
      setStatus(`Fetched ${result.items?.length || 0} products from wholesale bill ${result.billNumber}.`);
    } catch (error) {
      console.error("Failed to fetch wholesale bill for update:", error);
      setStatus("Could not fetch wholesale bill.");
    } finally {
      setImportingBill(false);
    }
  };

  const handleDocumentImport = async (file) => {
    if (!file) return;

    try {
      setDocumentImporting(true);
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

      setDocumentProducts(normalized);
      setUnmatchedProducts([]);
      setStatus(`AI extracted ${normalized.length} product(s) from ${file.name}.`);
    } catch (error) {
      console.error("Failed to import document for update:", error);
      setStatus("Could not extract products from image/PDF/document.");
    } finally {
      setDocumentImporting(false);
    }
  };

  const createUpdatePayload = async (item = {}, existingImage = "") => {
    let imageUrl = item.image || preview || existingImage || form.image || "";
    if (imageFile) {
      const imageRef = ref(storage, `productImages/${Date.now()}_${imageFile.name}`);
      const uploadResult = await uploadBytes(imageRef, imageFile);
      imageUrl = await getDownloadURL(uploadResult.ref);
    }

    return {
      productName: String(item.productName || item.name || form.productName || "").trim(),
      barcode: String(item.barcode || form.barcode || "").trim(),
      category: item.category || form.category,
      brand: String(item.brand || form.brand || "").trim(),
      unit: String(item.unit || form.unit || "").trim(),
      description: String(item.description || form.description || "").trim(),
      costPrice: Number((item.costPrice ?? form.costPrice) || 0),
      price: Number((item.price ?? form.price) || 0),
      mrp: Number((item.mrp ?? form.mrp) || 0),
      quantity: Number((item.quantity ?? form.quantity) || 0),
      image: imageUrl,
      updatedAt: serverTimestamp()
    };
  };

  const createNewProductPayload = async (item = {}) => {
    const payload = await createUpdatePayload(item, "");
    return {
      ...payload,
      shopId,
      createdAt: serverTimestamp()
    };
  };

  const removeUnmatchedProduct = (targetItem) => {
    setUnmatchedProducts((current) =>
      current.filter((item, index) => {
        if (targetItem.id && item.id) {
          return item.id !== targetItem.id;
        }

        return !(
          index === current.findIndex((entry) =>
            String(entry.productName || entry.name || "").trim().toLowerCase() ===
              String(targetItem.productName || targetItem.name || "").trim().toLowerCase() &&
            String(entry.barcode || "").trim() === String(targetItem.barcode || "").trim()
          )
        );
      })
    );
  };

  const handleCreateNewProduct = async (item) => {
    if (!shopId) {
      setStatus("Please select shop first.");
      return;
    }

    try {
      setUpdating(true);
      const payload = await createNewProductPayload(normalizeImportedProduct(item));
      const created = await addDoc(collection(db, "products"), payload);
      setProducts((current) => [...current, { id: created.id, ...payload }]);
      removeUnmatchedProduct(item);
      setStatus(`Created new product ${payload.productName || "item"} from AI analysis.`);
    } catch (error) {
      console.error("Failed to create product from unmatched item:", error);
      setStatus("Could not create new product from unmatched item.");
    } finally {
      setUpdating(false);
    }
  };

  const handleCreateAllUnmatched = async () => {
    if (!shopId) {
      setStatus("Please select shop first.");
      return;
    }

    if (!unmatchedProducts.length) {
      setStatus("No unmatched products available.");
      return;
    }

    try {
      setUpdating(true);
      const createdProducts = [];
      for (const item of unmatchedProducts) {
        const payload = await createNewProductPayload(normalizeImportedProduct(item));
        const created = await addDoc(collection(db, "products"), payload);
        createdProducts.push({ id: created.id, ...payload });
      }

      setProducts((current) => [...current, ...createdProducts]);
      setUnmatchedProducts([]);
      setStatus(`Created ${createdProducts.length} new product(s) from unmatched AI items.`);
    } catch (error) {
      console.error("Failed to create unmatched products:", error);
      setStatus("Could not create unmatched products.");
    } finally {
      setUpdating(false);
    }
  };

  const handleBulkUpdateProducts = async (items, sourceLabel) => {
    if (!shopId) {
      setStatus("Please select shop first.");
      return;
    }

    if (!items?.length) {
      setStatus("No products available to update.");
      return;
    }

    try {
      setUpdating(true);
      let updatedCount = 0;
      const unmatchedItems = [];
      const refreshedProducts = [...products];

      for (const rawItem of items) {
        const item = normalizeImportedProduct(rawItem);
        const normalizedName = String(item.productName || item.name || "").trim().toLowerCase();
        const normalizedBarcode = String(item.barcode || "").trim();
        const match = refreshedProducts.find((product) => {
          const sameBarcode = normalizedBarcode && String(product.barcode || "").trim() === normalizedBarcode;
          const sameName = normalizedName && String(product.productName || "").trim().toLowerCase() === normalizedName;
          return sameBarcode || sameName;
        });

        if (!match) {
          unmatchedItems.push(item);
          continue;
        }

        const payload = await createUpdatePayload(item, match.image || "");
        await updateDoc(doc(db, "products", match.id), payload);
        updatedCount += 1;

        const index = refreshedProducts.findIndex((product) => product.id === match.id);
        if (index >= 0) {
          refreshedProducts[index] = { ...refreshedProducts[index], ...payload, id: match.id };
        }
      }

      setProducts(refreshedProducts);
      setUnmatchedProducts(unmatchedItems);
      setStatus(`Updated ${updatedCount} product(s) from ${sourceLabel}. ${unmatchedItems.length} unmatched item(s) ready to create as new products.`);
    } catch (error) {
      console.error("Bulk update failed:", error);
      setStatus("Bulk product update failed.");
    } finally {
      setUpdating(false);
    }
  };

  const handleUpdate = async () => {
    if (!selectedId) {
      alert("Select product first.");
      return;
    }

    try {
      setUpdating(true);
      const existingProduct = products.find((item) => item.id === selectedId);
      const payload = await createUpdatePayload({}, existingProduct?.image || "");

      await updateDoc(doc(db, "products", selectedId), payload);

      setProducts((current) =>
        current.map((item) => (item.id === selectedId ? { ...item, ...payload, image: payload.image } : item))
      );
      setForm((current) => ({ ...current, image: payload.image }));
      setPreview(payload.image || preview);
      setStatus("Product updated successfully.");
      alert("Product updated successfully.");
    } catch (error) {
      console.error("Update failed:", error);
      alert("Update failed.");
      setStatus("Product update failed.");
    } finally {
      setUpdating(false);
    }
  };

  return (
    <SellerShell
      title="Update products"
      subtitle="Search, scan, and update catalog entries faster with smart suggestions and image refresh."
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

          <div className="seller-inline-actions" style={{ marginBottom: "12px" }}>
            <button type="button" className="header-link" onClick={() => setScannerOpen(true)}>
              Scan QR / Barcode
            </button>
            <label className="header-link" style={{ cursor: "pointer" }}>
              Capture New Image
              <input type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={handleImageChange} />
            </label>
            <label className="header-link" style={{ cursor: "pointer" }}>
              Upload Image
              <input type="file" accept="image/*" style={{ display: "none" }} onChange={handleImageChange} />
            </label>
            <label className="header-link" style={{ cursor: "pointer" }}>
              AI Import Image / PDF / Doc
              <input
                type="file"
                accept="image/*,.pdf,.doc,.docx,.txt"
                style={{ display: "none" }}
                onChange={(event) => handleDocumentImport(event.target.files?.[0])}
              />
            </label>
          </div>

          <div className="soft-panel" style={{ marginBottom: "12px" }}>
            <div className="section-title">Update from wholesale bill</div>
            <div className="seller-inline-actions">
              <input
                type="text"
                value={importBillNumber}
                onChange={(event) => setImportBillNumber(event.target.value)}
                placeholder="Enter wholesale bill number"
              />
              <button type="button" className="header-link" onClick={handleImportBill} disabled={importingBill}>
                {importingBill ? "Fetching..." : "Fetch bill products"}
              </button>
            </div>
            {importedBill ? (
              <p className="muted-copy" style={{ marginTop: "10px" }}>
                Source: {importedBill.sourceShopName || "Wholesale shop"} | Bill: {importedBill.billNumber}
              </p>
            ) : null}
            {importedBill?.items?.length ? (
              <div className="seller-inline-actions" style={{ marginTop: "10px" }}>
                <button
                  type="button"
                  className="primary-button"
                  disabled={updating}
                  onClick={() =>
                    handleBulkUpdateProducts(
                      importedBill.items.map((item) => normalizeImportedProduct(item)),
                      `wholesale bill ${importedBill.billNumber}`
                    )
                  }
                >
                  AI match and update all
                </button>
              </div>
            ) : null}
          </div>

          <div className="soft-panel" style={{ marginBottom: "12px" }}>
            <div className="section-title">AI update from image / PDF / Word</div>
            <p className="muted-copy">
              Bill photo, catalog image, PDF, and best-effort Word document ni AI analyze chesi product details ni update-ready format lo istundi.
            </p>
            {documentImporting ? <p className="muted-copy">AI analyzing uploaded file for product updates...</p> : null}
            {documentProducts.length ? (
              <div className="seller-inline-actions">
                <button
                  type="button"
                  className="primary-button"
                  disabled={updating}
                  onClick={() => handleBulkUpdateProducts(documentProducts, "AI document analysis")}
                >
                  AI bulk update matched products
                </button>
                {unmatchedProducts.length ? (
                  <button
                    type="button"
                    className="header-link"
                    disabled={updating}
                    onClick={handleCreateAllUnmatched}
                  >
                    Create all unmatched as new
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>

          <label>
            Search product
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by name, barcode, or brand"
            />
          </label>

          <div style={{ maxHeight: "180px", overflowY: "auto", display: "grid", gap: "8px", marginBottom: "14px" }}>
            {filteredProducts.map((product) => (
              <button
                key={product.id}
                type="button"
                className="soft-panel"
                style={{ textAlign: "left", cursor: "pointer" }}
                onClick={() => applyProduct(product)}
              >
                <div className="section-title">{product.productName}</div>
                <div className="muted-copy">
                  {product.barcode || "No barcode"} | Rs. {product.price || 0} | Qty {product.quantity || 0}
                </div>
              </button>
            ))}
            {shopId && filteredProducts.length === 0 ? <p className="muted-copy">No products found for this search.</p> : null}
          </div>

          {selectedId ? (
            <>
              <div className="seller-form-grid">
                <label>
                  Product name
                  <input value={form.productName} onChange={(event) => handleFieldChange("productName", event.target.value)} />
                </label>
                <label>
                  Barcode
                  <input value={form.barcode} onChange={(event) => handleFieldChange("barcode", event.target.value)} />
                </label>
                <label>
                  Category
                  <select value={form.category} onChange={(event) => handleFieldChange("category", event.target.value)}>
                    <option value="">Select Category</option>
                    {CATEGORY_OPTIONS.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Brand
                  <input value={form.brand} onChange={(event) => handleFieldChange("brand", event.target.value)} />
                </label>
                <label>
                  Unit
                  <input value={form.unit} onChange={(event) => handleFieldChange("unit", event.target.value)} />
                </label>
                <label>
                  Quantity
                  <input value={form.quantity} onChange={(event) => handleFieldChange("quantity", event.target.value)} />
                </label>
                <label>
                  Cost price
                  <input value={form.costPrice} onChange={(event) => handleFieldChange("costPrice", event.target.value)} />
                </label>
                <label>
                  Selling price
                  <input value={form.price} onChange={(event) => handleFieldChange("price", event.target.value)} />
                </label>
                <label>
                  MRP
                  <input value={form.mrp} onChange={(event) => handleFieldChange("mrp", event.target.value)} />
                </label>
              </div>

              <label>
                Description
                <textarea
                  rows="3"
                  value={form.description}
                  onChange={(event) => handleFieldChange("description", event.target.value)}
                />
              </label>

              <button className="primary-button" onClick={handleUpdate}>
                {updating ? "Updating..." : "Update Product"}
              </button>
            </>
          ) : (
            <p className="muted-copy">Select a product from the list or scan its barcode to edit it.</p>
          )}

          {status ? <div className="muted-copy" style={{ marginTop: "12px" }}>{status}</div> : null}
        </div>

        <div className="seller-profile-preview">
          <div className="soft-panel">
            <div className="eyebrow">Current preview</div>
            {preview ? (
              <img className="seller-preview-image" src={preview} alt="preview" />
            ) : (
              <div className="seller-image-placeholder">Product preview</div>
            )}
            <h3>{form.productName || "Select a product"}</h3>
            <p className="muted-copy">
              {form.brand || "Brand"} {form.unit ? `• ${form.unit}` : ""}
            </p>
            <p className="muted-copy">
              Barcode: {form.barcode || "Not added"} | Price: {form.price || 0}
            </p>
          </div>

          <div className="soft-panel">
            <div className="section-title">Smart update suggestions</div>
            {suggestionsLoading ? <p className="muted-copy">Checking Firebase and AI suggestions...</p> : null}
            {!suggestionsLoading &&
            !suggestions.localMatches.length &&
            !suggestions.internetMatches.length &&
            !suggestions.imageSuggestions.length &&
            !suggestions.aiSuggestions.length ? (
              <p className="muted-copy">Select a product and change its name or barcode to get suggestions.</p>
            ) : null}

            {suggestions.localMatches.map((item) => (
              <button
                key={`local-${item.id}`}
                type="button"
                className="soft-panel"
                style={{ width: "100%", textAlign: "left", marginTop: "10px", cursor: "pointer" }}
                onClick={() => applySuggestion(item)}
              >
                <div className="section-title">{item.name}</div>
                <div className="muted-copy">Firebase match | {item.category || "No category"} | Rs. {item.price || 0}</div>
                <div className="catalog-suggestion-action">Use product details</div>
              </button>
            ))}

            {suggestions.aiSuggestions.map((item, index) => (
              <button
                key={`ai-${index}`}
                type="button"
                className="soft-panel"
                style={{ width: "100%", textAlign: "left", marginTop: "10px", cursor: "pointer" }}
                onClick={() => applySuggestion(item)}
              >
                <div className="section-title">{item.name}</div>
                <div className="muted-copy">AI suggestion | {item.category || "No category"} {item.unit ? `| ${item.unit}` : ""}</div>
                {item.reason ? <div className="muted-copy">{item.reason}</div> : null}
                <div className="catalog-suggestion-action">Apply AI suggestion</div>
              </button>
            ))}

            {suggestions.internetMatches.map((item, index) => (
              <button
                key={`internet-${index}`}
                type="button"
                className="soft-panel"
                style={{ width: "100%", textAlign: "left", marginTop: "10px", cursor: "pointer" }}
                onClick={() => applySuggestion(item)}
              >
                <div className="section-title">{item.name}</div>
                <div className="muted-copy">
                  Internet catalog | {item.sourceLabel || "Online source"} {item.brand ? `| ${item.brand}` : ""}
                </div>
                {item.image ? (
                  <img
                    src={item.image}
                    alt={item.name}
                    style={{ width: "100%", maxHeight: "140px", objectFit: "contain", borderRadius: "14px", marginTop: "10px", background: "#f8fafc" }}
                  />
                ) : null}
                <div className="catalog-suggestion-action">Use catalog + image</div>
              </button>
            ))}

            {suggestions.imageSuggestions.length ? <div className="section-title" style={{ marginTop: "14px" }}>Internet image suggestions</div> : null}
            {suggestions.imageSuggestions.map((item, index) => (
              <button
                key={`image-${index}`}
                type="button"
                className={`soft-panel ${isSameImage(preview, item.imageFull || item.image) ? "catalog-image-card-active" : ""}`}
                style={{ width: "100%", textAlign: "left", marginTop: "10px", cursor: "pointer" }}
                onClick={() => applySuggestedImage(item)}
              >
                {item.image ? (
                  <img
                    src={item.image}
                    alt={item.name}
                    style={{ width: "100%", maxHeight: "160px", objectFit: "cover", borderRadius: "14px", marginBottom: "10px" }}
                  />
                ) : null}
                <div className="section-title">{item.name || form.productName || "Suggested image"}</div>
                <div className="muted-copy">
                  {item.sourceLabel || "Internet"} {item.license ? `| ${item.license}` : ""}
                </div>
                {item.creator ? <div className="muted-copy">Creator: {item.creator}</div> : null}
                <div className="catalog-suggestion-action">
                  {isSameImage(preview, item.imageFull || item.image) ? "Selected as current preview" : "Use as product image"}
                </div>
              </button>
            ))}

            {importedBill?.items?.length ? <div className="section-title" style={{ marginTop: "14px" }}>Wholesale bill products</div> : null}
            {importedBill?.items?.map((item, index) => (
              <button
                key={`wholesale-${index}`}
                type="button"
                className="soft-panel"
                style={{ width: "100%", textAlign: "left", marginTop: "10px", cursor: "pointer" }}
                onClick={() => applySuggestion(normalizeImportedProduct(item))}
              >
                <div className="section-title">{item.productName || item.name}</div>
                <div className="muted-copy">
                  Wholesale bill import | Cost {item.costPrice ?? 0} | MRP {item.mrp ?? 0} | Qty {item.quantity ?? 0}
                </div>
                {item.image ? (
                  <img
                    src={item.image}
                    alt={item.productName || item.name}
                    style={{ width: "100%", maxHeight: "140px", objectFit: "contain", borderRadius: "14px", marginTop: "10px", background: "#f8fafc" }}
                  />
                ) : null}
                <div className="catalog-suggestion-action">Apply to current product</div>
              </button>
            ))}

            {documentProducts.length ? <div className="section-title" style={{ marginTop: "14px" }}>AI extracted document products</div> : null}
            {documentProducts.map((item, index) => (
              <button
                key={`document-${index}`}
                type="button"
                className="soft-panel"
                style={{ width: "100%", textAlign: "left", marginTop: "10px", cursor: "pointer" }}
                onClick={() => applySuggestion(item)}
              >
                <div className="section-title">{item.productName || item.name}</div>
                <div className="muted-copy">
                  AI document analysis | Cost {item.costPrice || 0} | MRP {item.mrp || 0} | Qty {item.quantity || 0}
                </div>
                <div className="catalog-suggestion-action">Apply extracted update</div>
              </button>
            ))}

            {unmatchedProducts.length ? <div className="section-title" style={{ marginTop: "14px" }}>Unmatched AI products</div> : null}
            {unmatchedProducts.map((item, index) => (
              <div
                key={`unmatched-${index}`}
                className="soft-panel"
                style={{ width: "100%", textAlign: "left", marginTop: "10px" }}
              >
                <div className="section-title">{item.productName || item.name}</div>
                <div className="muted-copy">
                  No catalog match found | Cost {item.costPrice || 0} | MRP {item.mrp || 0} | Qty {item.quantity || 0}
                </div>
                {item.image ? (
                  <img
                    src={item.image}
                    alt={item.productName || item.name}
                    style={{ width: "100%", maxHeight: "140px", objectFit: "contain", borderRadius: "14px", marginTop: "10px", background: "#f8fafc" }}
                  />
                ) : null}
                <div className="seller-inline-actions" style={{ marginTop: "10px" }}>
                  <button type="button" className="header-link" onClick={() => applySuggestion(item)}>
                    Review in form
                  </button>
                  <button type="button" className="primary-button" disabled={updating} onClick={() => handleCreateNewProduct(item)}>
                    Create as new product
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <ProductScannerModal
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onDetected={handleScanDetected}
      />
    </SellerShell>
  );
}

export default ProductUpdate;
