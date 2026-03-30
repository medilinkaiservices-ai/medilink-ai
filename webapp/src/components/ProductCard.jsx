import React from "react";
import { getAuth } from "firebase/auth";

function ProductCard({ product }) {
  const auth = getAuth();
  const currentUser = auth.currentUser;

  if (!product) return null;

  const shareProduct = (userId) => {
    if (!userId) {
      alert("Please login first");
      return;
    }

    const link = `${window.location.origin}/shop/${product.shopId}?ref=${userId}`;
    const text = `Check this product\n\n${product.productName}\n\nBuy here:\n${link}\n\nEarn money by sharing products.`;
    const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(url, "_blank");
  };

  const addToCart = () => {
    let cart = JSON.parse(localStorage.getItem("cart")) || [];
    const productId = product.id || product.productId;
    const existingProduct = cart.find((item) => item.id === productId);

    if (existingProduct) {
      existingProduct.qty += 1;
    } else {
      cart.push({
        id: productId,
        name: product.productName,
        price: product.price,
        image: product.image,
        qty: 1,
        shopId: product.shopId
      });
    }

    localStorage.setItem("cart", JSON.stringify(cart));
    window.dispatchEvent(new Event("cartUpdated"));
  };

  return (
    <article className="premium-product-card">
      <div className="premium-product-media">
        {product.image ? (
          <img src={product.image} alt={product.productName} className="premium-product-image" />
        ) : (
          <div className="premium-product-placeholder">Product preview</div>
        )}
        {product.category ? <span className="premium-product-tag">{product.category}</span> : null}
      </div>

      <div className="premium-product-body">
        <div className="premium-product-copy">
          <h3>{product.productName}</h3>
          <p className="premium-product-price">Rs.{product.price}</p>
          <p className="premium-product-note">Premium local catalog listing with quick order and sharing flow.</p>
        </div>

        <div className="premium-product-actions">
          <button onClick={addToCart} className="primary-button premium-product-button">
            Add to cart
          </button>
          <button onClick={() => shareProduct(currentUser?.uid)} className="ghost-button premium-product-button">
            Share & earn
          </button>
        </div>
      </div>
    </article>
  );
}

export default ProductCard;
