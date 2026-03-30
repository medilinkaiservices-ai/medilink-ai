import React, { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../firebase";
import { fetchHospitals } from "../utils/hospitalApi";

function SearchPage() {
  const location = useLocation();
  const queryText = new URLSearchParams(location.search).get("q") || "";
  const [results, setResults] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    const loadSearch = async () => {
      try {
        setError("");
        const [productSnap, shopSnap, hospitals] = await Promise.all([
          getDocs(collection(db, "products")),
          getDocs(collection(db, "sellers")),
          fetchHospitals()
        ]);

        const products = productSnap.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
        const shops = shopSnap.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
        const keyword = queryText.trim().toLowerCase();

        const productResults = products
          .filter((product) => product.productName?.toLowerCase().includes(keyword))
          .map((product) => {
            const shop = shops.find((item) => item.id === product.shopId);
            return {
              id: `product-${product.id}`,
              type: "product",
              title: product.productName,
              path: `/shop/${product.shopId}`,
              kicker: shop?.shopName || "Seller listing",
              price: product.price,
              discount: product.discount || 0,
              distance: shop?.distance,
              city: shop?.city || shop?.area,
              description: product.description || "Product available on Medilink AI marketplace.",
              meta: [shop?.shopName, product.category, shop?.city || shop?.area].filter(Boolean)
            };
          });

        const shopResults = shops
          .filter((shop) => shop.shopName?.toLowerCase().includes(keyword))
          .map((shop) => ({
            id: `shop-${shop.id}`,
            type: "shop",
            title: shop.shopName,
            path: `/shop/${shop.id}`,
            kicker: "Seller storefront",
            city: shop.city || shop.area,
            description: shop.description || "Browse this seller's products, gallery, offers and contact options.",
            meta: [shop.categoryId, shop.city || shop.area, shop.ownerName].filter(Boolean)
          }));

        const hospitalResults = hospitals
          .filter((hospital) => hospital.hospitalName?.toLowerCase().includes(keyword) || (hospital.city || "").toLowerCase().includes(keyword))
          .map((hospital) => ({
            id: `hospital-${hospital.id}`,
            type: "hospital",
            title: hospital.hospitalName,
            path: `/hospitals/${encodeURIComponent(hospital.id)}`,
            kicker: "Hospital workspace",
            city: hospital.city,
            description: hospital.about || "Hospital profile with services, doctors and appointment support.",
            meta: [hospital.city, hospital.departments?.slice?.(0, 2)?.join(" • ")].filter(Boolean)
          }));

        setResults([...productResults, ...shopResults, ...hospitalResults]);
      } catch (loadError) {
        console.error("Search load failed:", loadError);
        setResults([]);
        setError("Search is temporarily unavailable. Please retry after Firestore access stabilizes.");
      }
    };

    loadSearch();
  }, [queryText]);

  const groupedCounts = useMemo(() => {
    return results.reduce((acc, item) => {
      acc[item.type] += 1;
      return acc;
    }, { product: 0, shop: 0, hospital: 0 });
  }, [results]);

  return (
    <div className="page-shell search-results-shell">
      <div className="search-results-hero soft-panel">
        <div>
          <div className="eyebrow">Premium search</div>
          <h1>Results for “{queryText || "all"}”</h1>
          <p className="muted-copy">Explore products, trusted sellers, and hospital profiles from one focused search surface.</p>
        </div>
        <div className="search-summary-grid">
          <div className="search-summary-card"><span>Products</span><strong>{groupedCounts.product}</strong></div>
          <div className="search-summary-card"><span>Shops</span><strong>{groupedCounts.shop}</strong></div>
          <div className="search-summary-card"><span>Hospitals</span><strong>{groupedCounts.hospital}</strong></div>
        </div>
      </div>

      {error && <div className="soft-panel search-feedback-card"><div className="section-title">Search unavailable</div><p className="muted-copy">{error}</p></div>}
      {!error && results.length === 0 && <div className="soft-panel search-feedback-card"><div className="section-title">No matching results</div><p className="muted-copy">Try another keyword like medicine, hospital, diagnostics, seller, pharmacy or a shop name.</p></div>}

      <div className="search-result-stack">
        {results.map((result) => (
          <Link key={result.id} to={result.path} className={`search-result-card search-result-${result.type}`}>
            <div className="search-result-badge">{result.kicker}</div>
            <div className="search-result-head">
              <h2>{result.title}</h2>
              {result.price !== undefined && <div className="search-result-price">Rs.{result.price}</div>}
            </div>
            <p className="muted-copy">{result.description}</p>
            <div className="search-result-meta-row">
              {result.discount ? <span>{result.discount}% OFF</span> : null}
              {result.city ? <span>{result.city}</span> : null}
              {result.distance ? <span>{result.distance} km away</span> : null}
              {result.meta?.map((item) => <span key={item}>{item}</span>)}
            </div>
            <div className="search-result-link">Open result</div>
          </Link>
        ))}
      </div>
    </div>
  );
}

export default SearchPage;
