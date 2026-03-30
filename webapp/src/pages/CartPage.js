import React, { useEffect, useState } from "react";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  serverTimestamp
} from "firebase/firestore";
import { db } from "../firebase";

function CartPage() {
  const [cart, setCart] = useState([]);

  const [address, setAddress] = useState({
    name: "",
    phone: "",
    village: "",
    city: "",
    district: "",
    state: "",
    pincode: "",
  });

  useEffect(() => {
    const savedCart = JSON.parse(localStorage.getItem("cart")) || [];
    setCart(savedCart);
  }, []);

  const removeItem = (id) => {
    const updated = cart.filter((item) => item.id !== id);
    setCart(updated);
    localStorage.setItem("cart", JSON.stringify(updated));
  };

  const changeQty = (id, type) => {
    const updated = cart.map((item) => {
      if (item.id === id) {
        if (type === "inc") item.qty += 1;
        if (type === "dec" && item.qty > 1) item.qty -= 1;
      }
      return item;
    });

    setCart(updated);
    localStorage.setItem("cart", JSON.stringify(updated));
  };

  const total = cart.reduce((sum, item) => sum + item.price * item.qty, 0);

  const handleAddress = (e) => {
    setAddress({
      ...address,
      [e.target.name]: e.target.value,
    });
  };

  const placeOrder = async () => {
    const { name, phone, village, city, district, state, pincode } = address;

    if (!name || !phone || !village || !city || !district || !state || !pincode) {
      alert("Please fill all address fields");
      return;
    }

    if (cart.length === 0) {
      alert("Cart is empty");
      return;
    }

    try {
      const shopId = cart[0].shopId;
      const sellerSnap = await getDoc(doc(db, "sellers", shopId));
      const seller = sellerSnap.exists() ? sellerSnap.data() : null;

      if (seller && seller.orderEnabled === false) {
        alert("This shop is not accepting orders right now.");
        return;
      }

      await addDoc(collection(db, "orders"), {
        items: cart,
        shopId: shopId,
        total: total,
        address: address,
        status: "pending",
        createdAt: serverTimestamp(),
      });

      /* WHATSAPP MESSAGE */

      let message = `🛒 *New Order*\n\n`;

      cart.forEach((item) => {
        message += `${item.name} - ₹${item.price} x ${item.qty}\n`;
      });

      message += `\nTotal: ₹${total}\n\n`;

      message += `Customer Details:\n`;
      message += `Name: ${name}\n`;
      message += `Phone: ${phone}\n`;
      message += `Address: ${village}, ${city}, ${district}, ${state} - ${pincode}`;

      const whatsappPhone = seller?.whatsappPhone || seller?.ownerPhone || "";
      const whatsappUrl = whatsappPhone
        ? `https://wa.me/91${whatsappPhone}?text=${encodeURIComponent(message)}`
        : `https://wa.me/?text=${encodeURIComponent(message)}`;

      window.open(whatsappUrl, "_blank");

      localStorage.removeItem("cart");
      alert("Order placed successfully ✅");
      window.location.reload();

    } catch (err) {
      console.error(err);
      alert("Order failed");
    }
  };

  return (
    <div style={{ maxWidth: "900px", margin: "40px auto" }}>
      <h2>🛒 Your Cart</h2>

      {cart.map((item) => (
        <div
          key={item.id}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "20px",
            border: "1px solid #ddd",
            padding: "15px",
            marginTop: "10px",
            borderRadius: "8px",
          }}
        >
          <img
            src={item.image}
            alt={item.name}
            style={{ width: "80px", height: "80px", objectFit: "cover" }}
          />

          <div style={{ flex: 1 }}>
            <h3>{item.name}</h3>
            <p>Price: ₹{item.price}</p>

            <div>
              <button onClick={() => changeQty(item.id, "dec")}>-</button>
              <span style={{ margin: "0 10px" }}>{item.qty}</span>
              <button onClick={() => changeQty(item.id, "inc")}>+</button>
            </div>
          </div>

          <button
            onClick={() => removeItem(item.id)}
            style={{
              background: "red",
              color: "#fff",
              border: "none",
              padding: "8px 12px",
              borderRadius: "6px",
            }}
          >
            Remove
          </button>
        </div>
      ))}

      {cart.length > 0 && (
        <div
          style={{
            marginTop: "30px",
            border: "1px solid #ddd",
            padding: "20px",
            borderRadius: "8px",
          }}
        >
          <h3>Total: ₹{total}</h3>

          <h3 style={{ marginTop: "20px" }}>Delivery Address</h3>

          <input name="name" placeholder="Full Name" onChange={handleAddress} />
          <input name="phone" placeholder="Phone Number" onChange={handleAddress} />
          <input name="village" placeholder="Village / Area" onChange={handleAddress} />
          <input name="city" placeholder="City / Town" onChange={handleAddress} />
          <input name="district" placeholder="District" onChange={handleAddress} />
          <input name="state" placeholder="State" onChange={handleAddress} />
          <input name="pincode" placeholder="Pincode" onChange={handleAddress} />

          <button
            onClick={placeOrder}
            style={{
              background: "green",
              color: "#fff",
              border: "none",
              padding: "12px 20px",
              borderRadius: "6px",
              marginTop: "15px",
            }}
          >
            Place Order
          </button>
        </div>
      )}
    </div>
  );
}

export default CartPage;
