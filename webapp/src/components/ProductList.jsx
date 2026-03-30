import React from "react";
import ProductCard from "../components/ProductCard";

function ProductList({ products, isOwner }) {
  if (!products || products.length === 0) {
    return <div className="soft-panel"><p className="muted-copy">No matching products found for this search.</p></div>;
  }

  return (
    <div className="seller-product-grid shop-product-grid">
      {products.map((product) => (
        <ProductCard key={product.id} product={product} isOwner={isOwner} />
      ))}
    </div>
  );
}

export default ProductList;
