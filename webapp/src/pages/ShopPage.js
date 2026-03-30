import React, { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { addDoc, collection, getDocs, query, serverTimestamp, where } from "firebase/firestore";
import Chatbot from "../components/Chatbot";
import ConnectModal from "../components/ConnectModal";
import ProductList from "../components/ProductList";
import ShopHeader from "../components/ShopHeader";
import { db } from "../firebase";

function ShopPage() {
  const { shopId } = useParams();
  const location = useLocation();
  const [products, setProducts] = useState([]);
  const [shop, setShop] = useState(null);
  const [isConnectOpen, setIsConnectOpen] = useState(false);
  const [cartCount, setCartCount] = useState(0);
  const [productQuery, setProductQuery] = useState("");

  const shopContext = {
    shopName: shop?.shopName || "this Shop",
    products: products.map(p => ({
      name: p.productName,
      price: p.price,
      availability: p.quantity > 0 ? "In Stock" : "Out of Stock"
    })),
    offers: shop?.offers || "N/A",
    availability: shop?.orderEnabled === false ? "Orders paused" : "Accepting orders"
    ,
    city: shop?.city || "",
    area: shop?.area || "",
    address: shop?.address || "",
    description: shop?.description || "",
  };

  useEffect(() => {
    if (shopId) {
      localStorage.setItem("shopId", shopId);
    }
  }, [shopId]);

  useEffect(() => {
    const syncCartCount = () => {
      const cart = JSON.parse(localStorage.getItem("cart")) || [];
      setCartCount(cart.reduce((sum, item) => sum + Number(item.qty || 0), 0));
    };

    syncCartCount();
    window.addEventListener("cartUpdated", syncCartCount);

    return () => {
      window.removeEventListener("cartUpdated", syncCartCount);
    };
  }, []);

  useEffect(() => {
    if (!shopId) return;

    const loadShopData = async () => {
      try {
        const shopSnapshot = await getDocs(query(collection(db, "sellers"), where("__name__", "==", shopId)));
        if (!shopSnapshot.empty) {
          setShop({ id: shopSnapshot.docs[0].id, ...shopSnapshot.docs[0].data() });
        }

        const productSnapshot = await getDocs(query(collection(db, "products"), where("shopId", "==", shopId)));
        setProducts(productSnapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })));
      } catch (error) {
        console.error("Shop load error:", error);
      }
    };

    loadShopData();
  }, [shopId]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const ref = params.get("ref");
    if (!ref) return;

    localStorage.setItem("affiliateRef", ref);

    if (!sessionStorage.getItem("clickTracked")) {
      addDoc(collection(db, "affiliateClicks"), {
        refUser: ref,
        shopId,
        createdAt: serverTimestamp()
      });
      sessionStorage.setItem("clickTracked", "true");
    }
  }, [location.search, shopId]);

  const shopStats = useMemo(() => ({
    status: shop?.orderEnabled === false ? "Orders paused" : "Ready for orders"
  }), [shop]);

  const filteredProducts = useMemo(() => {
    const queryText = productQuery.trim().toLowerCase();
    if (!queryText) return products;

    return products.filter((product) => {
      const name = String(product.productName || "").toLowerCase();
      const description = String(product.description || "").toLowerCase();
      const category = String(product.category || product.categoryName || "").toLowerCase();
      return name.includes(queryText) || description.includes(queryText) || category.includes(queryText);
    });
  }, [productQuery, products]);

  if (!shop) {
    return <div className="page-shell"><div className="soft-panel">Loading shop...</div></div>;
  }

  return (
    <div className="page-shell shop-page-shell">
      <div className="shop-page-main simple-shop-page-main">
        <div className="shop-page-kicker">
          <Link className="shop-back-link" to="/">
            Back to search
          </Link>
          <span className="shop-page-caption">Shop details</span>
        </div>

        <ShopHeader
          shop={shop}
          stats={[
            { label: "Status", value: shopStats.status },
            { label: "Location", value: shop.city || "Ask shop" }
          ]}
        />

        <div className="account-actions shop-header-actions">
          <button className="header-pill" onClick={() => setIsConnectOpen(true)}>
            Contact shop
          </button>
          <Link className="ghost-button" to="/cart">
            Open Cart ({cartCount})
          </Link>
          <button className="ghost-button" type="button" onClick={() => setIsConnectOpen(true)}>
            Offers
          </button>
        </div>

        <section className="soft-panel shop-section-panel">
          <div className="shop-section-head">
            <div>
              <div className="eyebrow">Catalog</div>
              <h2>Products</h2>
            </div>
            <label className="shop-product-search" aria-label="Search products">
              <input
                type="search"
                value={productQuery}
                onChange={(event) => setProductQuery(event.target.value)}
                placeholder="Search products"
              />
            </label>
          </div>
          <ProductList products={filteredProducts} isOwner={false} />
        </section>
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
      <Chatbot role="shop" contextData={shopContext} floating />
    </div>
  );
}

export default ShopPage;
