import React, { useEffect, useMemo, useState } from "react";
import { addDoc, collection, getDocs, query, serverTimestamp, where } from "firebase/firestore";
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

const EMPTY_FORM = {
  productName: "",
  barcode: "",
  category: "",
  brand: "",
  unit: "",
  description: "",
  costPrice: "",
  price: "",
  mrp: "",
  quantity: ""
};

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

function ProductEntry() {
  const sellerProfile = getStoredProfile("seller");
  const [shops, setShops] = useState([]);
  const [existingProducts, setExistingProducts] = useState([]);
  const [shopId, setShopId] = useState(sellerProfile?.shopId || "");
  const [form, setForm] = useState({
    ...EMPTY_FORM,
    category: sellerProfile?.categoryId || ""
  });
  const [imageFile, setImageFile] = useState(null);
  const [preview, setPreview] = useState("");
  const [loading, setLoading] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [suggestions, setSuggestions] = useState({ localMatches: [], internetMatches: [], imageSuggestions: [], aiSuggestions: [] });
  const [status, setStatus] = useState("");
  const [importBillNumber, setImportBillNumber] = useState("");
  const [importedBill, setImportedBill] = useState(null);
  const [importingBill, setImportingBill] = useState(false);
  const [documentImporting, setDocumentImporting] = useState(false);
  const [documentProducts, setDocumentProducts] = useState([]);

  useEffect(() => {
    const loadShops = async () => {
      const sellerQuery = sellerProfile?.shopId
        ? query(collection(db, "sellers"), where("__name__", "==", sellerProfile.shopId))
        : collection(db, "sellers");
      const snapshot = await getDocs(sellerQuery);
      const list = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data()
      }));
      setShops(list);
    };

    loadShops().catch((error) => console.error("Failed to load shops:", error));
  }, [sellerProfile?.shopId]);

  useEffect(() => {
    const loadProducts = async () => {
      if (!shopId) {
        setExistingProducts([]);
        return;
      }

      const snapshot = await getDocs(query(collection(db, "products"), where("shopId", "==", shopId)));
      setExistingProducts(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    };

    loadProducts().catch((error) => console.error("Failed to load existing products:", error));
  }, [shopId]);

  useEffect(() => {
    const queryText = form.productName.trim();
    const barcodeText = form.barcode.trim();

    if (queryText.length < 2 && barcodeText.length < 4) {
      setSuggestions({ localMatches: [], internetMatches: [], imageSuggestions: [], aiSuggestions: [] });
      return undefined;
    }

    const timer = window.setTimeout(async () => {
      try {
        setSuggestionsLoading(true);
        const result = await fetchCatalogSuggestions({
          query: queryText,
          barcode: barcodeText,
          shopId,
          category: form.category
        });
        setSuggestions(result);
      } catch (error) {
        console.error("Failed to fetch product suggestions:", error);
      } finally {
        setSuggestionsLoading(false);
      }
    }, 450);

    return () => window.clearTimeout(timer);
  }, [form.productName, form.barcode, form.category, shopId]);

  const duplicateNotice = useMemo(() => {
    const normalizedName = form.productName.trim().toLowerCase();
    const normalizedBarcode = form.barcode.trim();
    return existingProducts.find((item) => {
      const sameName = normalizedName && (item.productName || "").trim().toLowerCase() === normalizedName;
      const sameBarcode = normalizedBarcode && String(item.barcode || "").trim() === normalizedBarcode;
      return sameName || sameBarcode;
    });
  }, [existingProducts, form.productName, form.barcode]);

  const handleFieldChange = (field, value) => {
    setForm((current) => ({
      ...current,
      [field]: ["costPrice", "price", "mrp", "quantity"].includes(field)
        ? value.replace(/[^0-9.]/g, "")
        : value
    }));
  };

  const handleImageChange = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setImageFile(file);
    setPreview(URL.createObjectURL(file));
  };

  const applySuggestion = (item) => {
    setForm((current) => ({
      ...current,
      productName: item.name || item.productName || current.productName,
      category: item.category || current.category,
      barcode: item.barcode || current.barcode,
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
    setStatus(`Applied suggestion for ${item.name || "product"}.`);
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
        setStatus("No wholesale bill found for this number.");
        return;
      }

      setImportedBill(result);
      setStatus(`Fetched ${result.items?.length || 0} products from wholesale bill ${result.billNumber}.`);
    } catch (error) {
      console.error("Failed to import wholesale bill:", error);
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
      setStatus(`AI extracted ${normalized.length} product(s) from ${file.name}.`);
    } catch (error) {
      console.error("Failed to import products from document:", error);
      setStatus("Could not extract products from image/PDF/document.");
    } finally {
      setDocumentImporting(false);
    }
  };

  const createProductPayload = async (item) => {
    let imageUrl = item.image || "";

    if (imageFile) {
      const imageRef = ref(storage, `productImages/${Date.now()}_${imageFile.name}`);
      const uploadResult = await uploadBytes(imageRef, imageFile);
      imageUrl = await getDownloadURL(uploadResult.ref);
    }

    return {
      productName: (item.productName || item.name || form.productName).trim(),
      barcode: String(item.barcode || form.barcode || "").trim(),
      category: item.category || form.category,
      brand: String(item.brand || form.brand || "").trim(),
      unit: String(item.unit || form.unit || "").trim(),
      description: String(item.description || form.description || "").trim(),
      costPrice: Number((item.costPrice ?? form.costPrice) || 0),
      price: Number((item.price ?? form.price) || 0),
      mrp: Number((item.mrp ?? form.mrp) || 0),
      quantity: Number((item.quantity ?? form.quantity) || 0),
      shopId,
      image: imageUrl,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };
  };

  const handleBulkImportProducts = async (items, sourceLabel) => {
    if (!shopId) {
      setStatus("Please select shop first.");
      return;
    }

    if (!items?.length) {
      setStatus("No products available to import.");
      return;
    }

    try {
      setLoading(true);
      for (const item of items) {
        const payload = await createProductPayload(item);
        await addDoc(collection(db, "products"), payload);
      }
      setStatus(`Imported ${items.length} products from ${sourceLabel}.`);
    } catch (error) {
      console.error("Bulk import failed:", error);
      setStatus("Bulk import failed.");
    } finally {
      setLoading(false);
    }
  };

  const applySuggestedImage = (item) => {
    if (!item?.image) {
      return;
    }

    setPreview(item.imageFull || item.image);
    setImageFile(null);
    setStatus(`Applied internet image suggestion from ${item.sourceLabel || "AI search"}.`);
  };

  const handleDetectedCode = (code) => {
    handleFieldChange("barcode", code);
    setStatus(`Scanned code: ${code}`);
  };

  const handleAddProduct = async (event) => {
    event.preventDefault();

    if (!shopId) {
      alert("Please select shop first.");
      return;
    }

    if (!form.productName.trim() || !form.category || !form.price) {
      alert("Fill product name, category, and selling price.");
      return;
    }

    try {
      setLoading(true);

      let imageUrl = preview && !imageFile ? preview : "";

      if (imageFile) {
        const imageRef = ref(storage, `productImages/${Date.now()}_${imageFile.name}`);
        const uploadResult = await uploadBytes(imageRef, imageFile);
        imageUrl = await getDownloadURL(uploadResult.ref);
      }

      await addDoc(collection(db, "products"), {
        productName: form.productName.trim(),
        barcode: form.barcode.trim(),
        category: form.category,
        brand: form.brand.trim(),
        unit: form.unit.trim(),
        description: form.description.trim(),
        costPrice: Number(form.costPrice || 0),
        price: Number(form.price || 0),
        mrp: Number(form.mrp || 0),
        quantity: Number(form.quantity || 0),
        shopId,
        image: imageUrl,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      alert("Product added successfully.");
      setForm({ ...EMPTY_FORM, category: sellerProfile?.categoryId || "" });
      setImageFile(null);
      setPreview("");
      setSuggestions({ localMatches: [], internetMatches: [], imageSuggestions: [], aiSuggestions: [] });
      setStatus("");
    } catch (error) {
      console.error("Error adding product:", error);
      alert("Error adding product.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SellerShell
      title="Add product"
      subtitle="Faster catalog entry with camera capture, QR or barcode scan, and AI backed product suggestions."
    >
      <div className="seller-two-column">
        <form className="auth-card" onSubmit={handleAddProduct}>
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
              Capture Product Image
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
            <div className="section-title">Import from wholesale bill</div>
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
                  disabled={loading}
                  onClick={() => handleBulkImportProducts(importedBill.items.map((item) => normalizeImportedProduct(item)), `wholesale bill ${importedBill.billNumber}`)}
                >
                  Import all bill products
                </button>
              </div>
            ) : null}
          </div>

          <div className="soft-panel" style={{ marginBottom: "12px" }}>
            <div className="section-title">AI bill/document import</div>
            <p className="muted-copy">
              Camera photo, image, PDF, and best-effort document upload nundi products extract chesi quick add cheyyachu.
            </p>
            {documentImporting ? <p className="muted-copy">AI extracting products from uploaded file...</p> : null}
            {documentProducts.length ? (
              <div className="seller-inline-actions">
                <button
                  type="button"
                  className="primary-button"
                  disabled={loading}
                  onClick={() => handleBulkImportProducts(documentProducts, "AI document import")}
                >
                  Import all extracted products
                </button>
              </div>
            ) : null}
          </div>

          <label>
            Product name
            <input
              type="text"
              placeholder="Enter product name"
              value={form.productName}
              onChange={(event) => handleFieldChange("productName", event.target.value)}
              required
            />
          </label>

          <div className="seller-form-grid">
            <label>
              Barcode / QR value
              <input
                type="text"
                placeholder="Scanned code or manual code"
                value={form.barcode}
                onChange={(event) => handleFieldChange("barcode", event.target.value)}
              />
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
              <input
                type="text"
                placeholder="Brand"
                value={form.brand}
                onChange={(event) => handleFieldChange("brand", event.target.value)}
              />
            </label>
            <label>
              Unit / pack
              <input
                type="text"
                placeholder="500 ml / 1 kg / strip"
                value={form.unit}
                onChange={(event) => handleFieldChange("unit", event.target.value)}
              />
            </label>
          </div>

          <label>
            Description
            <textarea
              rows="3"
              placeholder="Short product description"
              value={form.description}
              onChange={(event) => handleFieldChange("description", event.target.value)}
            />
          </label>

          <div className="seller-form-grid">
            <label>
              Selling price
              <input type="text" value={form.price} onChange={(event) => handleFieldChange("price", event.target.value)} required />
            </label>
            <label>
              Cost price
              <input type="text" value={form.costPrice} onChange={(event) => handleFieldChange("costPrice", event.target.value)} />
            </label>
            <label>
              MRP
              <input type="text" value={form.mrp} onChange={(event) => handleFieldChange("mrp", event.target.value)} />
            </label>
            <label>
              Quantity
              <input type="text" value={form.quantity} onChange={(event) => handleFieldChange("quantity", event.target.value)} />
            </label>
          </div>

          {duplicateNotice ? (
            <div className="soft-panel" style={{ border: "1px solid #f59e0b", background: "#fffbeb" }}>
              Similar product already exists: <strong>{duplicateNotice.productName}</strong>
              {duplicateNotice.barcode ? ` | Barcode: ${duplicateNotice.barcode}` : ""}
            </div>
          ) : null}

          {status ? <div className="muted-copy">{status}</div> : null}

          <button type="submit" disabled={loading} className="primary-button">
            {loading ? "Saving..." : "Add Product"}
          </button>
        </form>

        <div className="seller-profile-preview">
          <div className="soft-panel">
            <div className="eyebrow">Image preview</div>
            {preview ? (
              <img className="seller-preview-image" src={preview} alt="preview" />
            ) : (
              <div className="seller-image-placeholder">Capture or upload product image</div>
            )}
            <h3>{form.productName || "Product name"}</h3>
            <p className="muted-copy">
              {form.brand || "Brand"} {form.unit ? `• ${form.unit}` : ""}
            </p>
            <p className="muted-copy">
              Price: {form.price || "0"} | MRP: {form.mrp || "0"} | Qty: {form.quantity || "0"}
            </p>
          </div>

          <div className="soft-panel">
            <div className="section-title">Smart catalog suggestions</div>
            {suggestionsLoading ? <p className="muted-copy">Searching Firebase catalog and AI suggestions...</p> : null}
            {!suggestionsLoading &&
            !suggestions.localMatches.length &&
            !suggestions.internetMatches.length &&
            !suggestions.imageSuggestions.length &&
            !suggestions.aiSuggestions.length ? (
              <p className="muted-copy">Type a product name or scan a barcode to get suggestions.</p>
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
                <div className="muted-copy">
                  Firebase match | {item.category || "No category"} | Rs. {item.price || 0}
                </div>
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
                <div className="muted-copy">
                  AI suggestion | {item.category || "No category"} {item.unit ? `| ${item.unit}` : ""}
                </div>
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
                onClick={() => applySuggestion(item)}
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
                <div className="catalog-suggestion-action">Use wholesale bill product</div>
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
                  AI document import | Cost {item.costPrice || 0} | MRP {item.mrp || 0} | Qty {item.quantity || 0}
                </div>
                <div className="catalog-suggestion-action">Use extracted product</div>
              </button>
            ))}
          </div>
        </div>
      </div>

      <ProductScannerModal
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onDetected={handleDetectedCode}
      />
    </SellerShell>
  );
}

export default ProductEntry;
