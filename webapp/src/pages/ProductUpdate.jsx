import React, { useState, useEffect } from "react";
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  updateDoc,
  serverTimestamp
} from "firebase/firestore";
import SellerShell from "../components/SellerShell";
import { db } from "../firebase";
import { getStoredProfile } from "../utils/session";

function ProductUpdate() {
  const sellerProfile = getStoredProfile("seller");
  const [shops, setShops] = useState([]);
  const [shopId, setShopId] = useState(sellerProfile?.shopId || "");
  const [products, setProducts] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [editCostPrice, setEditCostPrice] = useState("");
  const [editPrice, setEditPrice] = useState("");
  const [editMrp, setEditMrp] = useState("");
  const [editQuantity, setEditQuantity] = useState("");

  useEffect(() => {
    const loadShops = async () => {
      try {
        const snapshot = await getDocs(collection(db, "sellers"));
        const list = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data()
        }));

        setShops(list);
      } catch (error) {
        console.error("Failed to load shops for update:", error);
        setShops([]);
      }
    };

    loadShops();
  }, []);

  useEffect(() => {
    const loadProducts = async () => {
      if (!shopId) {
        setProducts([]);
        setSelectedId("");
        setEditCostPrice("");
        setEditPrice("");
        setEditMrp("");
        setEditQuantity("");
        return;
      }

      try {
        const snapshot = await getDocs(
          query(collection(db, "products"), where("shopId", "==", shopId))
        );

        const list = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data()
        }));

        setProducts(list);
      } catch (error) {
        console.error("Failed to load products for update:", error);
        setProducts([]);
      }
    };

    loadProducts();
  }, [shopId]);

  const handleSelect = (id) => {
    const product = products.find((item) => item.id === id);

    if (!product) return;

    setSelectedId(id);
    setEditCostPrice(product.costPrice || "");
    setEditPrice(product.price || "");
    setEditMrp(product.mrp || "");
    setEditQuantity(product.quantity || "");
  };

  const handleUpdate = async () => {
    if (!selectedId) {
      alert("Select product first.");
      return;
    }

    try {
      await updateDoc(doc(db, "products", selectedId), {
        costPrice: Number(editCostPrice),
        price: Number(editPrice),
        mrp: Number(editMrp),
        quantity: Number(editQuantity),
        updatedAt: serverTimestamp()
      });

      alert("Product updated successfully.");
      setProducts((prev) =>
        prev.map((product) =>
          product.id === selectedId
            ? {
                ...product,
                costPrice: Number(editCostPrice),
                price: Number(editPrice),
                mrp: Number(editMrp),
                quantity: Number(editQuantity)
              }
            : product
        )
      );
    } catch (error) {
      console.error(error);
      alert("Update failed.");
    }
  };

  return (
    <SellerShell
      title="Update products"
      subtitle="Fine tune pricing and stock for products already listed in your shop."
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

          {products.length > 0 && (
            <>
              <label>
                Product
                <select value={selectedId} onChange={(event) => handleSelect(event.target.value)}>
                  <option value="">Select Product</option>
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.productName}
                    </option>
                  ))}
                </select>
              </label>

              <div className="seller-form-grid">
                <label>
                  Cost price
                  <input
                    type="number"
                    value={editCostPrice}
                    onChange={(event) => setEditCostPrice(event.target.value)}
                  />
                </label>
                <label>
                  New price
                  <input
                    type="number"
                    value={editPrice}
                    onChange={(event) => setEditPrice(event.target.value)}
                  />
                </label>
                <label>
                  MRP
                  <input
                    type="number"
                    value={editMrp}
                    onChange={(event) => setEditMrp(event.target.value)}
                  />
                </label>
                <label>
                  Quantity
                  <input
                    type="number"
                    value={editQuantity}
                    onChange={(event) => setEditQuantity(event.target.value)}
                  />
                </label>
              </div>

              <button className="primary-button" onClick={handleUpdate}>
                Update Product
              </button>
            </>
          )}

          {shopId && products.length === 0 && (
            <p className="muted-copy">No products found for this shop.</p>
          )}
        </div>

        <div className="seller-profile-preview">
          <div className="soft-panel">
            <div className="eyebrow">Inventory note</div>
            <h3>Quick stock updates</h3>
            <p className="muted-copy">
              This page is now ready for future upgrades like status toggles, bulk edits
              and product search inside seller inventory.
            </p>
          </div>
        </div>
      </div>
    </SellerShell>
  );
}

export default ProductUpdate;
