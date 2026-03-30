import React, { useState, useEffect } from "react";
import { collection, addDoc, getDocs, serverTimestamp } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import SellerShell from "../components/SellerShell";
import { db, storage } from "../firebase";
import { getStoredProfile } from "../utils/session";

function ProductEntry() {
  const sellerProfile = getStoredProfile("seller");
  const [shops, setShops] = useState([]);
  const [shopId, setShopId] = useState(sellerProfile?.shopId || "");
  const [productName, setProductName] = useState("");
  const [costPrice, setCostPrice] = useState("");
  const [price, setPrice] = useState("");
  const [mrp, setMrp] = useState("");
  const [quantity, setQuantity] = useState("");
  const [category, setCategory] = useState("");
  const [imageFile, setImageFile] = useState(null);
  const [preview, setPreview] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const loadShops = async () => {
      const snapshot = await getDocs(collection(db, "sellers"));
      const list = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data()
      }));

      setShops(list);
    };

    loadShops();
  }, []);

  const handleImageChange = (event) => {
    const file = event.target.files[0];

    if (!file) return;

    setImageFile(file);
    setPreview(URL.createObjectURL(file));
  };

  const handleAddProduct = async (event) => {
    event.preventDefault();

    if (!shopId) {
      alert("Please select shop first.");
      return;
    }

    if (!productName || !costPrice || !price || !mrp || !category) {
      alert("Please fill all fields.");
      return;
    }

    try {
      setLoading(true);

      let imageUrl = "";

      if (imageFile) {
        const imageRef = ref(storage, `productImages/${Date.now()}_${imageFile.name}`);
        const uploadResult = await uploadBytes(imageRef, imageFile);
        imageUrl = await getDownloadURL(uploadResult.ref);
      }

      await addDoc(collection(db, "products"), {
        productName,
        costPrice: Number(costPrice),
        price: Number(price),
        mrp: Number(mrp),
        quantity: Number(quantity),
        category,
        shopId,
        image: imageUrl,
        createdAt: serverTimestamp()
      });

      alert("Product added successfully.");
      setProductName("");
      setCostPrice("");
      setPrice("");
      setMrp("");
      setQuantity("");
      setCategory("");
      setImageFile(null);
      setPreview("");
    } catch (error) {
      console.error(error);
      alert("Error adding product.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SellerShell
      title="Add product"
      subtitle="Create products for your seller catalog with images, pricing and stock."
    >
      <div className="seller-two-column">
        <form className="auth-card" onSubmit={handleAddProduct}>
          <label>
            Shop
            <select value={shopId} onChange={(event) => setShopId(event.target.value)}>
              <option value="">Select Shop</option>
              {shops.map((shop) => (
                <option key={shop.id} value={shop.id}>
                  {shop.shopName}
                </option>
              ))}
            </select>
          </label>

          <label>
            Category
            <select value={category} onChange={(event) => setCategory(event.target.value)}>
              <option value="">Select Category</option>
              <option value="Medicine">Medicines</option>
              <option value="Healthcare">Health Care</option>
              <option value="Groceries">Groceries</option>
              <option value="Vegetables">Vegetables</option>
              <option value="Fruits">Fruits</option>
              <option value="Snacks">Snacks & Foods</option>
              <option value="Seeds">Seeds</option>
              <option value="Fertilizers">Fertilizers</option>
              <option value="Livestock">Livestock</option>
              <option value="Electricals">Electricals</option>
              <option value="Hardware">Hardware</option>
              <option value="HomeNeeds">Home Needs</option>
              <option value="PersonalCare">Personal Care</option>
              <option value="BabyCare">Baby Care</option>
              <option value="Others">Others</option>
            </select>
          </label>

          <label>
            Product name
            <input
              type="text"
              placeholder="Product Name"
              value={productName}
              onChange={(event) => setProductName(event.target.value)}
              required
            />
          </label>

          <div className="seller-form-grid">
            <label>
              Price
              <input
                type="number"
                placeholder="Price"
                value={price}
                onChange={(event) => setPrice(event.target.value)}
                required
              />
            </label>
            <label>
              Cost price
              <input
                type="number"
                placeholder="Cost Price"
                value={costPrice}
                onChange={(event) => setCostPrice(event.target.value)}
              />
            </label>
            <label>
              MRP
              <input
                type="number"
                placeholder="MRP"
                value={mrp}
                onChange={(event) => setMrp(event.target.value)}
              />
            </label>
            <label>
              Quantity
              <input
                type="number"
                placeholder="Quantity"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
              />
            </label>
          </div>

          <label>
            Product image
            <input type="file" accept="image/*" onChange={handleImageChange} />
          </label>

          <button type="submit" disabled={loading} className="primary-button">
            {loading ? "Uploading..." : "Add Product"}
          </button>
        </form>

        <div className="seller-profile-preview">
          <div className="soft-panel">
            <div className="eyebrow">Live preview</div>
            {preview ? (
              <img className="seller-preview-image" src={preview} alt="preview" />
            ) : (
              <div className="seller-image-placeholder">Product image preview</div>
            )}
            <h3>{productName || "Product name"}</h3>
            <p className="muted-copy">
              Price: {price || "0"} | MRP: {mrp || "0"} | Qty: {quantity || "0"}
            </p>
          </div>
        </div>
      </div>
    </SellerShell>
  );
}

export default ProductEntry;
