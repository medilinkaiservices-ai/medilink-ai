import React from "react";

function ShopHeader({ shop, stats = [] }) {
  if (!shop) {
    return <div className="soft-panel">Loading shop profile...</div>;
  }

  const shortDescription = shop.description
    ? shop.description.length > 180
      ? `${shop.description.slice(0, 177).trim()}...`
      : shop.description
    : "Browse available products and contact the shop directly when needed.";

  const locationLabel = shop.area && shop.city ? `${shop.area}, ${shop.city}` : shop.city || shop.area || "";

  return (
    <section className="soft-panel simple-shop-header">
      <div className="simple-shop-header-glow" aria-hidden="true" />
      <div className="simple-shop-header-main">
        <div className="simple-shop-header-brand">
          <div className="simple-shop-logo-shell">
            {shop.logo ? (
              <img src={shop.logo} alt={shop.shopName || "Shop"} className="simple-shop-logo" />
            ) : (
              <div className="simple-shop-logo simple-shop-logo-fallback">
                {(shop.shopName || "S").slice(0, 1).toUpperCase()}
              </div>
            )}
          </div>
          <div className="simple-shop-copy">
            <div className="simple-shop-topline">
              <div className="eyebrow">Trusted shop</div>
              {locationLabel ? <span className="simple-shop-location-badge">{locationLabel}</span> : null}
            </div>
            <h1>{shop.shopName || "Shop name"}</h1>
            <p className="muted-copy">{shortDescription}</p>
          </div>
        </div>

        {stats.length ? (
          <div className="simple-shop-stats">
            {stats.map((item) => (
              <div className="simple-shop-stat" key={item.label}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}

export default ShopHeader;
