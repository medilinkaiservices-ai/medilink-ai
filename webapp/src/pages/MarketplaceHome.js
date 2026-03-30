import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { collection, getDocs } from "firebase/firestore";
import { getDistance } from "geolib";
import { db } from "../firebase";
import { getStoredAccount } from "../utils/session";

function MarketplaceHome() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [products, setProducts] = useState([]);
  const [shops, setShops] = useState([]);
  const [userLocation, setUserLocation] = useState(null);
  const [account, setAccount] = useState(null);

  useEffect(() => {
    const loadData = async () => {
      const productSnap = await getDocs(collection(db, "products"));
      const shopSnap = await getDocs(collection(db, "sellers"));

      setProducts(
        productSnap.docs.map((doc) => ({
          id: doc.id,
          ...doc.data()
        }))
      );

      setShops(
        shopSnap.docs.map((doc) => ({
          id: doc.id,
          ...doc.data()
        }))
      );
    };

    loadData();
    setAccount(getStoredAccount());
  }, []);

  useEffect(() => {
    if (!navigator.geolocation) return;

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setUserLocation({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude
        });
      },
      () => {
        setUserLocation(null);
      }
    );
  }, []);

  const getShopDistance = (shop) => {
    if (!userLocation || !shop?.latitude || !shop?.longitude) return "Distance unavailable";

    const distance = getDistance(userLocation, {
      latitude: shop.latitude,
      longitude: shop.longitude
    });

    return `${(distance / 1000).toFixed(1)} km away`;
  };

  const nearbyShops = useMemo(() => {
    if (!userLocation) return shops.slice(0, 3);

    return shops
      .filter((shop) => {
        if (!shop.latitude || !shop.longitude) return false;

        const distance = getDistance(userLocation, {
          latitude: shop.latitude,
          longitude: shop.longitude
        });

        return distance <= 7000;
      })
      .slice(0, 3);
  }, [shops, userLocation]);

  const nearbyProducts = useMemo(() => {
    const shopIds = new Set(nearbyShops.map((shop) => shop.id));
    return products.filter((product) => shopIds.has(product.shopId)).slice(0, 4);
  }, [products, nearbyShops]);

  const suggestions = useMemo(() => {
    const keyword = search.trim().toLowerCase();

    if (!keyword) return [];

    const shopMatches = shops
      .filter((shop) => {
        const shopName = (shop.shopName || "").toLowerCase();
        const ownerName = (shop.ownerName || "").toLowerCase();
        return shopName.includes(keyword) || ownerName.includes(keyword);
      })
      .slice(0, 3)
      .map((shop) => ({
        id: shop.id,
        label: shop.shopName,
        meta: shop.city || "Seller page",
        to: `/shop/${shop.id}`
      }));

    const productMatches = products
      .filter((product) =>
        (product.productName || "").toLowerCase().includes(keyword)
      )
      .slice(0, 3)
      .map((product) => ({
        id: product.id,
        label: product.productName,
        meta: "Product result",
        to: `/search?q=${encodeURIComponent(product.productName)}`
      }));

    return [...shopMatches, ...productMatches].slice(0, 6);
  }, [products, search, shops]);

  const handleSearchSubmit = (event) => {
    event.preventDefault();

    if (!search.trim()) return;

    navigate(`/search?q=${encodeURIComponent(search.trim())}`);
  };

  const nextCustomerRoute = account?.roles?.includes("customer")
    ? "/customer/account"
    : "/register/customer";
  const nextSellerRoute = account?.roles?.includes("seller")
    ? "/seller/dashboard"
    : "/register/seller";
  const nextHospitalRoute = account?.roles?.includes("hospital")
    ? "/hospital/dashboard"
    : "/register/hospital";

  return (
    <div className="page-shell home-shell">
      <section className="hero-panel">
        <div className="hero-copy">
          <div className="eyebrow">Search first experience</div>
          <h1>Search products like Google, then continue as customer or seller.</h1>
          <p className="muted-copy">
            Start with a clean search experience, keep customer and seller spaces
            separate, and let the same mobile number work across both roles.
          </p>
        </div>

        <div className="search-stage">
          <form className="search-modal" onSubmit={handleSearchSubmit}>
            <div className="search-badge">Search Medilink AI</div>
            <input
              className="hero-search-input"
              type="text"
              placeholder="Search medicines, shops, groceries, health products..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <div className="search-actions">
              <button type="submit" className="primary-button">
                Search
              </button>
              <Link className="ghost-button" to="/search">
                Advanced search
              </Link>
            </div>
            {suggestions.length > 0 && (
              <div className="suggestion-list">
                {suggestions.map((item) => (
                  <Link key={item.id} className="suggestion-item" to={item.to}>
                    <span>{item.label}</span>
                    <small>{item.meta}</small>
                  </Link>
                ))}
              </div>
            )}
          </form>
        </div>
      </section>

      <section className="card-grid">
        <Link className="role-card role-card-customer" to={nextCustomerRoute}>
          <div className="eyebrow">Customer side</div>
          <h2>Separate customer account page</h2>
          <p className="muted-copy">
            Registration, profile, orders, khatha, addresses and saved stores can
            all live here.
          </p>
          <span className="card-cta">
            {account?.roles?.includes("customer")
              ? "Open customer account"
              : "Register as customer"}
          </span>
        </Link>

        <Link className="role-card role-card-seller" to={nextSellerRoute}>
          <div className="eyebrow">Seller side</div>
          <h2>Separate seller dashboard</h2>
          <p className="muted-copy">
            Use the same number as customer and seller, but keep the seller tools
            in a dedicated workspace.
          </p>
          <span className="card-cta">
            {account?.roles?.includes("seller")
              ? "Open seller dashboard"
              : "Register as seller"}
          </span>
        </Link>

        <Link className="role-card role-card-hospital" to={nextHospitalRoute}>
          <div className="eyebrow">Hospital side</div>
          <h2>Separate hospital workspace</h2>
          <p className="muted-copy">
            Keep hospitals separate so we can build doctors, services,
            appointments and emergency flows properly.
          </p>
          <span className="card-cta">
            {account?.roles?.includes("hospital")
              ? "Open hospital dashboard"
              : "Register hospital"}
          </span>
        </Link>
      </section>

      <section className="discovery-layout">
        <div className="soft-panel">
          <div className="section-title">Nearby shops</div>
          {nearbyShops.length === 0 && (
            <p className="muted-copy">Nearby sellers will appear here after location access.</p>
          )}
          {nearbyShops.map((shop) => (
            <Link key={shop.id} className="list-row" to={`/shop/${shop.id}`}>
              <span>{shop.shopName}</span>
              <small>{getShopDistance(shop)}</small>
            </Link>
          ))}
        </div>

        <div className="soft-panel">
          <div className="section-title">Fast product discovery</div>
          {nearbyProducts.length === 0 && (
            <p className="muted-copy">Once products are added, top items will appear here.</p>
          )}
          {nearbyProducts.map((product) => (
            <Link
              key={product.id}
              className="list-row"
              to={`/search?q=${encodeURIComponent(product.productName || "")}`}
            >
              <span>{product.productName}</span>
              <small>Rs. {product.price}</small>
            </Link>
          ))}
        </div>

        <div className="soft-panel">
          <div className="section-title">Hospital care</div>
          <p className="muted-copy">
            Browse hospitals, departments and appointment-ready care pages from one place.
          </p>
          <div className="account-actions" style={{ marginTop: "16px" }}>
            <Link className="header-pill" to="/hospitals">
              Explore hospitals
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}

export default MarketplaceHome;
