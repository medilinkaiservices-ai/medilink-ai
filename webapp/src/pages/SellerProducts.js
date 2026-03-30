import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  where
} from "firebase/firestore";
import SellerShell from "../components/SellerShell";
import { db } from "../firebase";
import { getStoredProfile } from "../utils/session";

function SellerProducts() {
  const sellerProfile = getStoredProfile("seller");
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    const loadProducts = async () => {
      try {
        const shopId = localStorage.getItem("shopId") || sellerProfile?.shopId;

        if (!shopId) {
          setProducts([]);
          return;
        }

        const snapshot = await getDocs(
          query(collection(db, "products"), where("shopId", "==", shopId))
        );

        setProducts(
          snapshot.docs.map((item) => ({
            id: item.id,
            ...item.data()
          }))
        );
      } catch (error) {
        console.error("Failed to load seller products:", error);
      } finally {
        setLoading(false);
      }
    };

    loadProducts();
  }, [sellerProfile?.shopId]);

  const filteredProducts = useMemo(() => {
    const keyword = search.trim().toLowerCase();

    if (!keyword) return products;

    return products.filter((product) =>
      (product.productName || "").toLowerCase().includes(keyword)
    );
  }, [products, search]);

  const handleDelete = async (productId) => {
    const confirmed = window.confirm("Delete this product?");

    if (!confirmed) return;

    try {
      await deleteDoc(doc(db, "products", productId));
      setProducts((current) => current.filter((product) => product.id !== productId));
    } catch (error) {
      console.error("Failed to delete product:", error);
      alert("Could not delete product.");
    }
  };

  return (
    <SellerShell
      title="Your products"
      subtitle="Browse, search and manage everything listed in your seller catalog."
      actions={
        <>
          <Link className="header-pill" to="/product-entry">
            Add new product
          </Link>
          <Link className="header-link" to="/product-update">
            Open update form
          </Link>
          <Link className="header-link" to="/seller/stock-inward">
            Stock inward
          </Link>
        </>
      }
    >
      <div className="seller-products-toolbar">
        <input
          type="text"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search product name"
        />
      </div>

      {loading && (
        <div className="soft-panel">
          <p className="muted-copy">Loading products...</p>
        </div>
      )}

      {!loading && filteredProducts.length === 0 && (
        <div className="soft-panel">
          <h3>No products found</h3>
          <p className="muted-copy">
            Add your first product or change the search term.
          </p>
        </div>
      )}

      <div className="seller-product-grid">
        {filteredProducts.map((product) => (
          <div key={product.id} className="soft-panel seller-product-card">
            {product.image ? (
              <img
                className="seller-product-image"
                src={product.image}
                alt={product.productName}
              />
            ) : (
              <div className="seller-image-placeholder seller-product-image">
                No image
              </div>
            )}
            <div className="seller-product-head">
              <h3>{product.productName}</h3>
              <span className="order-status-pill">{product.category || "General"}</span>
            </div>
            <p className="muted-copy">Price: Rs. {product.price || 0}</p>
            <p className="muted-copy">MRP: Rs. {product.mrp || 0}</p>
            <p className="muted-copy">Stock: {product.quantity || 0}</p>
            <div className="seller-inline-actions">
              <Link className="header-link" to="/product-update">
                Edit price/stock
              </Link>
              <button className="ghost-button seller-danger" onClick={() => handleDelete(product.id)}>
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </SellerShell>
  );
}

export default SellerProducts;
