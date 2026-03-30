import React, { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { collection, getDocs } from "firebase/firestore";
import WorkspaceMenu from "../components/WorkspaceMenu";
import { db } from "../firebase";
import { fetchHospitals } from "../utils/hospitalApi";

function SearchWorkspacePage() {
  const location = useLocation();
  const navigate = useNavigate();
  const queryText = new URLSearchParams(location.search).get("q") || "";
  const [search, setSearch] = useState(queryText);
  const [results, setResults] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    setSearch(queryText);
  }, [queryText]);

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

        if (!keyword) {
          setResults([]);
          return;
        }

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
              city: shop?.city || shop?.area,
              description: product.description || "Product available on Medilink AI marketplace.",
              meta: [shop?.shopName, product.category, shop?.city || shop?.area].filter(Boolean)
            };
          });

        const shopResults = shops
          .filter((shop) => {
            const haystack = [shop.shopName, shop.ownerName, shop.city, shop.area].filter(Boolean).join(" ").toLowerCase();
            return haystack.includes(keyword);
          })
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
          .filter((hospital) => {
            const haystack = [hospital.hospitalName, hospital.city, hospital.about].filter(Boolean).join(" ").toLowerCase();
            return haystack.includes(keyword);
          })
          .map((hospital) => ({
            id: `hospital-${hospital.id}`,
            type: "hospital",
            title: hospital.hospitalName,
            path: `/hospitals/${encodeURIComponent(hospital.id)}`,
            kicker: "Hospital profile",
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

  const handleSearchSubmit = (event) => {
    event.preventDefault();
    const keyword = search.trim();
    navigate(keyword ? `/search?q=${encodeURIComponent(keyword)}` : "/");
  };

  return (
    <div className="search-home-shell">
      <WorkspaceMenu />

      <main className="search-workspace-main">
        <section className="search-top-bar">
          <form className="search-top-form" onSubmit={handleSearchSubmit}>
            <input
              className="search-top-input"
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search shops, services, medicines, diagnostics, hospitals..."
            />
            <button type="submit" className="search-home-button">
              Search
            </button>
          </form>
        </section>

        <section className="search-results-panel">
          <div className="search-results-head">
            <div>
              <div className="eyebrow">Search results</div>
              <h1>Results for "{queryText || "search"}"</h1>
            </div>
            <div className="search-counts">
              <span>{groupedCounts.product} products</span>
              <span>{groupedCounts.shop} shops</span>
              <span>{groupedCounts.hospital} hospitals</span>
            </div>
          </div>

          <div className="account-actions">
            <Link className="header-link" to="/">
              Back to search
            </Link>
          </div>

          {error ? (
            <div className="search-feedback-card">
              <div className="section-title">Search unavailable</div>
              <p className="muted-copy">{error}</p>
            </div>
          ) : null}

          {!error && !results.length ? (
            <div className="search-feedback-card">
              <div className="section-title">No matching results</div>
              <p className="muted-copy">Try another keyword like shop, service, medicine, diagnostics or hospital.</p>
            </div>
          ) : null}

          <div className="search-workspace-list">
            {results.map((result) => (
              <Link key={result.id} to={result.path} className={`search-workspace-card search-workspace-${result.type}`}>
                <div className="search-workspace-kicker">{result.kicker}</div>
                <div className="search-workspace-head">
                  <h2>{result.title}</h2>
                  {result.price !== undefined ? <strong>Rs. {result.price}</strong> : null}
                </div>
                <p className="muted-copy">{result.description}</p>
                <div className="search-workspace-meta">
                  {result.city ? <span>{result.city}</span> : null}
                  {result.meta?.map((item) => <span key={item}>{item}</span>)}
                </div>
              </Link>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

export default SearchWorkspacePage;
