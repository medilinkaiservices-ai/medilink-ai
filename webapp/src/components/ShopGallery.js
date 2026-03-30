import React, { useState } from "react";
import { db, storage } from "../firebase";
import { doc, updateDoc } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";

function ShopGallery({ shop, setShop, shopId, isOwner }) {
  const [preview, setPreview] = useState(null);

  const uploadGallery = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // ✅ Show preview immediately
    const localPreview = URL.createObjectURL(file);
    setPreview(localPreview);

    const storageRef = ref(storage, `shopGallery/${shopId}/${file.name}`);
    await uploadBytes(storageRef, file);

    const url = await getDownloadURL(storageRef);

    // ✅ Safe gallery creation
    const updatedGallery = [...(shop?.gallery || []), url];

    const docRef = doc(db, "sellers", shopId);
    await updateDoc(docRef, { gallery: updatedGallery });

    // ✅ Safe state update
    setShop({
      ...(shop || {}),
      gallery: updatedGallery,
    });

    // Clear preview after upload
    setPreview(null);
  };

  return (
    <div style={{ marginTop: "30px" }}>
      <h3>📷 Shop Gallery</h3>

      {/* Upload Button */}
      {isOwner && (
        <input
          type="file"
          onChange={uploadGallery}
          style={{ marginBottom: "15px" }}
        />
      )}

      {/* Preview Image */}
      {preview && (
        <div style={{ marginBottom: "15px" }}>
          <p>Preview:</p>
          <img
            src={preview}
            alt="preview"
            style={{
              width: "120px",
              height: "120px",
              objectFit: "cover",
              borderRadius: "10px",
              border: "2px solid #ccc",
            }}
          />
        </div>
      )}

      {/* Gallery Images */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, 120px)",
          gap: "10px",
        }}
      >
        {shop?.gallery?.map((img, i) => (
          <img
            key={i}
            src={img}
            alt="gallery"
            style={{
              width: "120px",
              height: "120px",
              objectFit: "cover",
              borderRadius: "10px",
            }}
          />
        ))}
      </div>
    </div>
  );
}

export default ShopGallery;