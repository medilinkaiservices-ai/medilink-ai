import React, { useState } from "react";
import { db } from "./firebase";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";

function CustomerRegistration({ shopId }) {

  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");

  const registerCustomer = async () => {

    if (!shopId) {
      alert("Select a shop first ❌");
      return;
    }

    if (!name.trim()) {
      alert("Customer name is required ❌");
      return;
    }

    if (!/^[A-Za-z ]+$/.test(name.trim())) {
      alert("Customer name must contain only letters ❌");
      return;
    }

    if (!/^[0-9]{10}$/.test(mobile)) {
      alert("Valid 10 digit mobile number required ❌");
      return;
    }

    try {
      const customerRef = doc(
        db,
        "sellers",
        shopId,              // 🔥 IMPORTANT CHANGE
        "customers",
        mobile
      );

      const existing = await getDoc(customerRef);

      if (existing.exists()) {
        alert("Customer already registered ❌");
        return;
      }

      await setDoc(customerRef, {
        name: name.trim(),
        mobile,
        balance: 0,
        createdAt: serverTimestamp()
      });

      alert("Customer registered successfully ✅");

      setName("");
      setMobile("");

    } catch (error) {
      console.error(error);
      alert("Error registering customer ❌");
    }
  };

  return (
    <div className="card">
      <h2>Customer Registration</h2>

      <input
        placeholder="Customer Name"
        value={name}
        onChange={(e) =>
          setName(e.target.value.replace(/[^A-Za-z ]/g, ""))
        }
      />

      <input
        placeholder="Mobile Number"
        maxLength="10"
        value={mobile}
        onChange={(e) =>
          setMobile(e.target.value.replace(/[^0-9]/g, ""))
        }
      />

      <button onClick={registerCustomer}>
        Register
      </button>
    </div>
  );
}

export default CustomerRegistration;