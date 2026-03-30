import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../firebase";
import { activateDevelopmentRole } from "../utils/session";

function SellerAccess() {
  const navigate = useNavigate();
  const [shops, setShops] = useState([]);
  const [search, setSearch] = useState("");
  const [openingId, setOpeningId] = useState("");

  useEffect(() => {
    const loadShops = async () => {
      try {
        const snapshot = await getDocs(collection(db, "sellers"));
        setShops(
          snapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data()
          }))
        );
      } catch (error) {
        console.error("Failed to load seller access list:", error);
        setShops([]);
      }
    };

    loadShops();
  }, []);

  const visibleShops = useMemo(() => {
    const keyword = search.trim().toLowerCase();

    if (!keyword) return shops;

    return shops.filter((shop) => {
      return (
        (shop.shopName || "").toLowerCase().includes(keyword) ||
        (shop.ownerName || "").toLowerCase().includes(keyword) ||
        (shop.city || "").toLowerCase().includes(keyword) ||
        (shop.ownerPhone || "").includes(keyword)
      );
    });
  }, [search, shops]);

  const handleOpenShop = (shop) => {
    setOpeningId(shop.id);

    activateDevelopmentRole("seller", {
      name: shop.ownerName || "Seller",
      phone: shop.ownerPhone || "",
      shopName: shop.shopName || "Shop",
      city: shop.city || "",
      categoryId: shop.categoryId || "",
      description: shop.description || "",
      shopId: shop.id
    });

    navigate("/seller/dashboard");
  };

  return (
    <div className="page-shell">
      <section className="account-hero">
        <div>
          <div className="eyebrow">Development seller access</div>
          <h1>Open any seller workspace</h1>
          <p className="muted-copy">
            During development you can jump into any existing shop as seller,
            inspect inbox, products, offers and settings without separate login.
          </p>
          <div className="account-actions">
            <Link className="header-link" to="/customer/account">
              Back to customer account
            </Link>
          </div>
        </div>
        <div className="auth-card">
          <label>
            Search shop
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Shop name, owner, city or phone"
            />
          </label>
          <div className="muted-copy">
            {visibleShops.length} seller workspaces available in this development view.
          </div>
        </div>
      </section>

      <section className="seller-product-grid">
        {visibleShops.map((shop) => (
          <div key={shop.id} className="soft-panel seller-product-card">
            <div className="seller-product-head">
              <h3>{shop.shopName || "Shop"}</h3>
              <span className="order-status-pill">seller</span>
            </div>
            <p className="muted-copy">
              Owner: {shop.ownerName || "Not set"}<br />
              Phone: {shop.ownerPhone || "Not set"}<br />
              City: {shop.city || "Not set"}
            </p>
            <button
              type="button"
              className="primary-button"
              disabled={openingId === shop.id}
              onClick={() => handleOpenShop(shop)}
            >
              {openingId === shop.id ? "Opening..." : "Open seller workspace"}
            </button>
          </div>
        ))}
      </section>
    </div>
  );
}

export default SellerAccess;
