import React from "react";
import { getAuth } from "firebase/auth";

function ProductCard({ product }) {

  const auth = getAuth();
  const currentUser = auth.currentUser;

  if (!product) return null;

  /* SHARE PRODUCT */

  const shareProduct = (userId) => {

    if (!userId) {
      alert("Please login first");
      return;
    }

    const link = `${window.location.origin}/shop/${product.shopId}?ref=${userId}`;

    const text = `🔥 Check this product

${product.productName}

Buy here:
${link}

Earn money by sharing products!`;

    const url = `https://wa.me/?text=${encodeURIComponent(text)}`;

    window.open(url, "_blank");
  };

  /* ADD TO CART */

  const addToCart = () => {

    let cart = JSON.parse(localStorage.getItem("cart")) || [];

    const productId = product.id || product.productId;

    const existingProduct = cart.find(item => item.id === productId);

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

    // cart counter update
    window.dispatchEvent(new Event("cartUpdated"));
  };

  return (

    <div
      style={{
        border: "1px solid #ddd",
        borderRadius: "10px",
        padding: "15px",
        marginBottom: "20px",
        width: "220px",
        background: "#fff"
      }}
    >

      {product.image && (

        <img
          src={product.image}
          alt={product.productName}
          style={{
            width: "100%",
            height: "160px",
            objectFit: "cover",
            borderRadius: "8px",
            marginBottom: "10px"
          }}
        />

      )}

      <h3 style={{ fontSize: "16px", marginBottom: "6px" }}>
        {product.productName}
      </h3>

      <p style={{ color: "green", fontWeight: "bold" }}>
        ₹{product.price}
      </p>

      {/* ADD TO CART */}

      <button
        onClick={addToCart}
        style={{
          padding: "8px 14px",
          background: "#2563eb",
          color: "white",
          border: "none",
          borderRadius: "6px",
          cursor: "pointer",
          marginTop: "8px",
          width: "100%"
        }}
      >
        Add to Cart 🛒
      </button>

      {/* SHARE */}

      <button
        onClick={() => shareProduct(currentUser?.uid)}
        style={{
          padding: "8px 14px",
          background: "#25D366",
          color: "white",
          border: "none",
          borderRadius: "6px",
          cursor: "pointer",
          marginTop: "8px",
          width: "100%"
        }}
      >
        Share & Earn 💰
      </button>

    </div>

  );

}

export default ProductCard;