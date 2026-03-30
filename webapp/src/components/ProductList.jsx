import React from "react";
import ProductCard from "../components/ProductCard";
function ProductList({ products, isOwner }) {
  if (!products || products.length === 0) {
    return <p>ప్రస్తుతం products లేవు.</p>;
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
        gap: "20px",
        marginTop: "20px",
      }}
    >
      {products.map((p) => (
        <ProductCard key={p.id} product={p} isOwner={isOwner} />
      ))}
    </div>
  );
}

export default ProductList;
