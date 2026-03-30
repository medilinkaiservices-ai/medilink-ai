import React, { useState, useEffect } from "react";
import { useParams, useLocation } from "react-router-dom";
import ShopHeader from "../components/ShopHeader";
import QuickActions from "../components/QuickActions";
import OfferCard from "../components/OfferCard";
import ProductList from "../components/ProductList";
import ShopGallery from "../components/ShopGallery";
import ConnectModal from "../components/ConnectModal";

import {
  collection,
  query,
  where,
  getDocs,
  addDoc,
  serverTimestamp,
} from "firebase/firestore";

import { db } from "../firebase";

function ShopPage() {
  const { shopId } = useParams();
  const location = useLocation();

  const [isOwner, setIsOwner] = useState(false);
  const [products, setProducts] = useState([]);
  const [shop, setShop] = useState(null);
  const [isConnectOpen, setIsConnectOpen] = useState(false);

  /* SAVE SHOP ID FOR SELLER ORDERS */
  useEffect(() => {
    if (shopId) {
      localStorage.setItem("shopId", shopId);
    }
  }, [shopId]);

  /* LOAD SHOP + PRODUCTS */
  useEffect(() => {
    if (!shopId) return;

    const loadShopData = async () => {
      try {
        const shopQuery = query(
          collection(db, "sellers"),
          where("__name__", "==", shopId)
        );

        const shopSnap = await getDocs(shopQuery);

        if (!shopSnap.empty) {
          const shopData = {
            id: shopSnap.docs[0].id,
            ...shopSnap.docs[0].data(),
          };

          setShop(shopData);
        }

        const productQuery = query(
          collection(db, "products"),
          where("shopId", "==", shopId)
        );

        const productSnap = await getDocs(productQuery);

        const productList = productSnap.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));

        setProducts(productList);
      } catch (err) {
        console.error("Shop load error:", err);
      }
    };

    loadShopData();
  }, [shopId]);

  /* AFFILIATE REF + CLICK TRACKING */
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const ref = params.get("ref");

    if (!ref) return;

    localStorage.setItem("affiliateRef", ref);

    if (!sessionStorage.getItem("clickTracked")) {
      addDoc(collection(db, "affiliateClicks"), {
        refUser: ref,
        shopId: shopId,
        createdAt: serverTimestamp(),
      });

      sessionStorage.setItem("clickTracked", "true");
    }
  }, [location.search, shopId]);

  if (!shop) {
    return (
      <div style={{ padding: "40px", fontSize: "18px" }}>
        Loading shop...
      </div>
    );
  }

  return (
    <div>
     

      <div style={{ display: "flex" }}>
        <QuickActions isOwner={isOwner} setIsOwner={setIsOwner} />

        <div style={{ flex: 1, padding: "40px" }}>
          {!isOwner && (
            <div className="account-actions" style={{ marginBottom: "20px" }}>
              <button className="header-pill" onClick={() => setIsConnectOpen(true)}>
                Connect to Shop
              </button>
            </div>
          )}
          <ShopHeader shopId={shopId} shop={shop} isOwner={isOwner} />

          <ShopGallery
            shop={shop}
            setShop={setShop}
            shopId={shopId}
            isOwner={isOwner}
          />

          <h2>🔥 Special Offers</h2>
          <OfferCard isOwner={isOwner} products={products} />

          <h2>🛒 Products</h2>
          <ProductList products={products} isOwner={isOwner} />
        </div>
      </div>

      <ConnectModal
        isOpen={isConnectOpen}
        onClose={() => setIsConnectOpen(false)}
        entityName={shop.shopName || "Shop"}
        targetId={shopId}
        phone={shop.ownerPhone}
        whatsappPhone={shop.whatsappPhone || shop.ownerPhone}
        mode="shop"
        shareTitle={shop.shopName || "Shop"}
        defaultMessage={`Hello ${shop.shopName || "shop"}, I want to know more about your products.`}
      />
    </div>
  );
}

export default ShopPage;
